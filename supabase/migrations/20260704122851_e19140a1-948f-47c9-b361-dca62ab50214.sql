ALTER TABLE public.extra_services
  ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'Cash';

CREATE OR REPLACE FUNCTION public.get_agent_balances()
 RETURNS TABLE(agent_name text, total_bill numeric, total_received numeric, balance_due numeric, advance_balance numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH party_names AS (
    SELECT name AS agent_name
      FROM public.agents
     WHERE NULLIF(btrim(name), '') IS NOT NULL
  ), bills AS (
    SELECT agent_name,
           COALESCE(SUM(total_bill),0) AS bill,
           COALESCE(SUM(received_amount),0) AS cash_received,
           COALESCE(SUM(discount_amount),0) AS discount_given,
           COALESCE(SUM(advance_applied),0) AS advance_used
      FROM public.agency_ledger
     WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','PAYMENT')
       AND NULLIF(btrim(agent_name), '') IS NOT NULL
     GROUP BY agent_name
  ), adv AS (
    SELECT agent_name,
           COALESCE(SUM(received_amount),0) AS advance_in
      FROM public.agency_ledger
     WHERE UPPER(COALESCE(service_type,'')) = 'ADVANCE'
       AND NULLIF(btrim(agent_name), '') IS NOT NULL
     GROUP BY agent_name
  ), names AS (
    SELECT agent_name FROM party_names
    UNION
    SELECT agent_name FROM bills
    UNION
    SELECT agent_name FROM adv
  )
  SELECT n.agent_name,
         COALESCE(b.bill,0) AS total_bill,
         COALESCE(b.cash_received,0) + COALESCE(b.advance_used,0) + COALESCE(b.discount_given,0) AS total_received,
         GREATEST(COALESCE(b.bill,0) - COALESCE(b.cash_received,0) - COALESCE(b.discount_given,0) - COALESCE(b.advance_used,0), 0) AS balance_due,
         GREATEST(COALESCE(a.advance_in,0) - COALESCE(b.advance_used,0), 0) AS advance_balance
    FROM names n
    LEFT JOIN bills b ON b.agent_name = n.agent_name
    LEFT JOIN adv a ON a.agent_name = n.agent_name;
$function$;

CREATE OR REPLACE FUNCTION public.get_agent_wallet(_agent_name text)
 RETURNS TABLE(advance_balance numeric, current_due numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH x AS (
    SELECT
      COALESCE(SUM(received_amount) FILTER (WHERE UPPER(COALESCE(service_type,'')) = 'ADVANCE'),0) AS advance_in,
      COALESCE(SUM(advance_applied) FILTER (WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','PAYMENT')),0) AS advance_used,
      COALESCE(SUM(total_bill) FILTER (WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','PAYMENT')),0) AS bill,
      COALESCE(SUM(received_amount) FILTER (WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','PAYMENT')),0) AS cash_received,
      COALESCE(SUM(discount_amount) FILTER (WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','PAYMENT')),0) AS discount_given
    FROM public.agency_ledger
    WHERE agent_name = _agent_name
  )
  SELECT GREATEST(advance_in - advance_used, 0),
         GREATEST(bill - cash_received - discount_given - advance_used, 0)
  FROM x;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_agent_advance(_agent_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_remaining numeric;
  v_bill record;
  v_due numeric;
  v_take numeric;
BEGIN
  IF _agent_name IS NULL OR length(trim(_agent_name)) = 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(received_amount), 0)
    INTO v_remaining
  FROM public.agency_ledger
  WHERE agent_name = _agent_name
    AND UPPER(COALESCE(service_type, '')) = 'ADVANCE';

  UPDATE public.agency_ledger
     SET advance_applied = 0,
         updated_at = now()
   WHERE agent_name = _agent_name
     AND UPPER(COALESCE(service_type, '')) NOT IN ('ADVANCE', 'PAYMENT')
     AND COALESCE(advance_applied, 0) <> 0;

  FOR v_bill IN
    SELECT id, total_bill, received_amount, discount_amount
      FROM public.agency_ledger
     WHERE agent_name = _agent_name
       AND UPPER(COALESCE(service_type, '')) NOT IN ('ADVANCE', 'PAYMENT')
     ORDER BY entry_date ASC, created_at ASC, id ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_due := GREATEST(COALESCE(v_bill.total_bill, 0) - COALESCE(v_bill.received_amount, 0) - COALESCE(v_bill.discount_amount, 0), 0);
    IF v_due <= 0 THEN
      CONTINUE;
    END IF;

    v_take := LEAST(v_remaining, v_due);
    UPDATE public.agency_ledger
       SET advance_applied = v_take,
           updated_at = now()
     WHERE id = v_bill.id;
    v_remaining := v_remaining - v_take;
  END LOOP;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recalculate_agent_advance ON public.agency_ledger;
CREATE TRIGGER trg_recalculate_agent_advance
AFTER INSERT OR DELETE OR UPDATE OF agent_name, service_type, total_bill, received_amount, discount_amount
ON public.agency_ledger
FOR EACH ROW EXECUTE FUNCTION public.trg_recalculate_agent_advance();

CREATE OR REPLACE FUNCTION public.sync_extra_service()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vendor text;
  v_agency text;
  v_passenger text;
  v_price numeric;
  v_cost numeric;
  v_recv numeric;
  v_disc numeric;
  v_date date;
  v_pay_date date;
  v_pay_method text;
  v_svc text;
  v_notes text;
  v_new_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.vendor_ledger WHERE source_table = 'extra_services' AND source_id = OLD.id;
    DELETE FROM public.agency_ledger WHERE source_table = 'extra_services' AND source_id = OLD.id;
    RETURN OLD;
  END IF;

  v_vendor := NEW.vendor_name;
  v_agency := NEW.agency_sold;
  v_passenger := NEW.passenger_name;
  v_price := COALESCE(NEW.service_price, 0);
  v_cost := COALESCE(NEW.vendor_cost, 0);
  v_recv := COALESCE(NEW.received_amount, 0);
  v_disc := COALESCE(NEW.discount_amount, 0);
  v_date := COALESCE(NEW.entry_date, CURRENT_DATE);
  v_pay_date := NEW.payment_date;
  v_pay_method := COALESCE(NULLIF(NEW.payment_method, ''), 'Cash');
  v_svc := COALESCE(NEW.service_name, 'Extra Service');
  v_notes := NULLIF(trim(COALESCE(NEW.notes, '')), '');

  IF v_vendor IS NULL OR length(trim(v_vendor)) = 0 OR v_cost = 0 THEN
    DELETE FROM public.vendor_ledger WHERE source_table = 'extra_services' AND source_id = NEW.id;
  ELSIF EXISTS (SELECT 1 FROM public.vendor_ledger WHERE source_table = 'extra_services' AND source_id = NEW.id) THEN
    UPDATE public.vendor_ledger SET
      entry_date = v_date, vendor_name = v_vendor, passenger_name = v_passenger,
      service_type = v_svc, country_route = v_svc, total_payable = v_cost,
      passport = NEW.passport, mobile = NEW.mobile, profit = v_price - v_cost,
      remarks = v_notes, created_by = COALESCE(created_by, NEW.created_by), updated_at = now()
    WHERE source_table = 'extra_services' AND source_id = NEW.id;
  ELSE
    v_new_id := public.next_module_id('VDL', 'vendor_ledger', 'ledger_id');
    INSERT INTO public.vendor_ledger
      (ledger_id, entry_date, vendor_name, passenger_name, service_type, country_route,
       total_payable, paid_amount, passport, mobile, profit, remarks, source_table, source_id, created_by)
    VALUES
      (v_new_id, v_date, v_vendor, v_passenger, v_svc, v_svc,
       v_cost, 0, NEW.passport, NEW.mobile, v_price - v_cost, v_notes, 'extra_services', NEW.id, NEW.created_by);
  END IF;

  IF v_agency IS NULL OR length(trim(v_agency)) = 0 OR v_price = 0 THEN
    DELETE FROM public.agency_ledger WHERE source_table = 'extra_services' AND source_id = NEW.id;
  ELSIF EXISTS (SELECT 1 FROM public.agency_ledger WHERE source_table = 'extra_services' AND source_id = NEW.id) THEN
    UPDATE public.agency_ledger SET
      entry_date = v_date, payment_date = v_pay_date, payment_method = v_pay_method, agent_name = v_agency,
      passenger_name = v_passenger, service_type = v_svc, country_route = v_svc,
      total_bill = v_price, received_amount = v_recv, discount_amount = v_disc,
      passport = NEW.passport, mobile = NEW.mobile, profit = v_price - v_cost,
      remarks = v_notes, created_by = COALESCE(created_by, NEW.created_by), received_by = COALESCE(NEW.received_by, received_by), updated_at = now()
    WHERE source_table = 'extra_services' AND source_id = NEW.id;
  ELSE
    v_new_id := public.next_module_id('AGL', 'agency_ledger', 'ledger_id');
    INSERT INTO public.agency_ledger
      (ledger_id, entry_date, payment_date, payment_method, agent_name, passenger_name, service_type,
       country_route, total_bill, received_amount, discount_amount, passport, mobile, profit,
       remarks, source_table, source_id, created_by, received_by)
    VALUES
      (v_new_id, v_date, v_pay_date, v_pay_method, v_agency, v_passenger, v_svc,
       v_svc, v_price, v_recv, v_disc, NEW.passport, NEW.mobile, v_price - v_cost,
       v_notes, 'extra_services', NEW.id, NEW.created_by, NEW.received_by);
  END IF;

  RETURN NEW;
END;
$function$;

DROP INDEX IF EXISTS public.uniq_payment_receipts_agency_ledger;
CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_agency_ledger_direct_unlocked_unique
  ON public.payment_receipts (service_table, service_row_id)
  WHERE source = 'agency_ledger' AND handover_id IS NULL;

CREATE OR REPLACE FUNCTION public.sync_agent_receipt_to_cash()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid;
  v_user_name text;
  v_receipt_id text;
  v_amt numeric;
  v_date date;
  v_source text;
  v_direct_total numeric := 0;
  v_locked_total numeric := 0;
  v_unlocked numeric := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.payment_receipts
     WHERE service_table = 'agency_ledger'
       AND service_row_id = OLD.id
       AND source IN ('agency_ledger', 'agency_ledger_payment')
       AND handover_id IS NULL;
    RETURN OLD;
  END IF;

  v_amt := COALESCE(NEW.received_amount, 0);
  v_user := COALESCE(NEW.received_by, NEW.created_by);
  v_date := COALESCE(NEW.payment_date, NEW.entry_date, CURRENT_DATE);
  v_source := CASE
    WHEN NEW.source_table IS NOT NULL AND length(NEW.source_table) > 0 THEN 'agency_ledger_payment'
    ELSE 'agency_ledger'
  END;

  IF v_source = 'agency_ledger_payment' THEN
    SELECT COALESCE(SUM(pr.amount), 0) INTO v_direct_total
      FROM public.payment_receipts pr
     WHERE pr.service_table = NEW.source_table
       AND pr.service_row_id = NEW.source_id
       AND pr.source NOT IN ('discount', 'agency_ledger_payment', 'agency_ledger',
                             'status_event', 'status_change', 'status-delivery')
       AND lower(COALESCE(pr.method, '')) NOT IN ('discount', 'status')
       AND COALESCE(pr.amount, 0) > 0;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_locked_total
    FROM public.payment_receipts
   WHERE service_table = 'agency_ledger'
     AND service_row_id = NEW.id
     AND source IN ('agency_ledger', 'agency_ledger_payment')
     AND handover_id IS NOT NULL;

  v_unlocked := GREATEST(v_amt - v_direct_total - v_locked_total, 0);

  IF v_user IS NULL OR v_unlocked <= 0 THEN
    DELETE FROM public.payment_receipts
     WHERE service_table = 'agency_ledger'
       AND service_row_id = NEW.id
       AND source IN ('agency_ledger', 'agency_ledger_payment')
       AND handover_id IS NULL;
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_user_name FROM public.profiles WHERE user_id = v_user;
  v_receipt_id := 'AGL-' || to_char(v_date, 'YYYYMM') || '-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 8));

  IF v_source = 'agency_ledger' THEN
    INSERT INTO public.payment_receipts (
      receipt_id, entry_date, service_type, service_table, service_row_id, ref_id,
      passenger_name, received_by, received_by_name, amount, method, source, remarks, created_by
    ) VALUES (
      v_receipt_id, v_date, 'Agent Receipt: ' || COALESCE(NEW.agent_name, ''),
      'agency_ledger', NEW.id, NEW.ledger_id,
      COALESCE(NEW.passenger_name, NEW.agent_name, ''),
      v_user, v_user_name, v_unlocked,
      COALESCE(NULLIF(NEW.payment_method, ''), 'Cash'), v_source,
      concat_ws(' · ', 'Customer/Sub-Agent payment received', NULLIF(NEW.remarks, '')),
      COALESCE(NEW.created_by, v_user)
    )
    ON CONFLICT (service_table, service_row_id) WHERE source = 'agency_ledger' AND handover_id IS NULL
    DO UPDATE SET
      receipt_id = EXCLUDED.receipt_id,
      entry_date = EXCLUDED.entry_date,
      service_type = EXCLUDED.service_type,
      ref_id = EXCLUDED.ref_id,
      passenger_name = EXCLUDED.passenger_name,
      received_by = EXCLUDED.received_by,
      received_by_name = EXCLUDED.received_by_name,
      amount = EXCLUDED.amount,
      method = EXCLUDED.method,
      source = EXCLUDED.source,
      remarks = EXCLUDED.remarks,
      created_by = EXCLUDED.created_by,
      updated_at = now();
  ELSE
    INSERT INTO public.payment_receipts (
      receipt_id, entry_date, service_type, service_table, service_row_id, ref_id,
      passenger_name, received_by, received_by_name, amount, method, source, remarks, created_by
    ) VALUES (
      v_receipt_id, v_date, 'Service Receipt: ' || COALESCE(NEW.agent_name, ''),
      'agency_ledger', NEW.id, NEW.ledger_id,
      COALESCE(NEW.passenger_name, NEW.agent_name, ''),
      v_user, v_user_name, v_unlocked,
      COALESCE(NULLIF(NEW.payment_method, ''), 'Cash'), v_source,
      concat_ws(' · ', 'সার্ভিস/কাস্টমার পেমেন্ট রিসিভ', NULLIF(NEW.remarks, '')),
      COALESCE(NEW.created_by, v_user)
    )
    ON CONFLICT (service_table, service_row_id) WHERE source = 'agency_ledger_payment' AND handover_id IS NULL
    DO UPDATE SET
      receipt_id = EXCLUDED.receipt_id,
      entry_date = EXCLUDED.entry_date,
      service_type = EXCLUDED.service_type,
      ref_id = EXCLUDED.ref_id,
      passenger_name = EXCLUDED.passenger_name,
      received_by = EXCLUDED.received_by,
      received_by_name = EXCLUDED.received_by_name,
      amount = EXCLUDED.amount,
      method = EXCLUDED.method,
      source = EXCLUDED.source,
      remarks = EXCLUDED.remarks,
      created_by = EXCLUDED.created_by,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$function$;