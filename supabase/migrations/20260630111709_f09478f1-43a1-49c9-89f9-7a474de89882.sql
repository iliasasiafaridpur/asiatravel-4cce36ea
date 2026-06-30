ALTER TABLE public.extra_services ADD COLUMN IF NOT EXISTS payment_date date;

CREATE OR REPLACE FUNCTION public.sync_service_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  amt numeric;
  ref text;
  pname text;
  svc text;
  receiver uuid;
  receiver_name text;
  rid text;
  pay_date date;
BEGIN
  IF TG_TABLE_NAME = 'tickets' THEN
    amt := COALESCE(NEW.received, 0); ref := NEW.ticket_id; svc := 'AIR TICKET';
  ELSIF TG_TABLE_NAME = 'bmet_cards' THEN
    amt := COALESCE(NEW.received_amount, 0); ref := NEW.bmet_id; svc := 'BMET';
  ELSIF TG_TABLE_NAME = 'saudi_visas' THEN
    amt := COALESCE(NEW.received_amount, 0); ref := NEW.saudi_id; svc := 'Saudi Visa';
  ELSIF TG_TABLE_NAME = 'kuwait_visas' THEN
    amt := COALESCE(NEW.received, 0); ref := NEW.kuwait_id; svc := 'Kuwait Visa';
  ELSIF TG_TABLE_NAME = 'others' THEN
    amt := COALESCE(NEW.received_amount, 0); ref := NEW.other_id; svc := 'Other';
  ELSE
    RETURN NEW;
  END IF;

  pname := NEW.passenger_name;
  receiver := COALESCE(NEW.received_by, NEW.created_by);
  pay_date := COALESCE(NEW.payment_date, NEW.entry_date, CURRENT_DATE);

  IF TG_OP = 'UPDATE' THEN
    UPDATE public.payment_receipts
       SET service_type = svc,
           ref_id = ref,
           passenger_name = COALESCE(pname, ''),
           entry_date = CASE WHEN source = 'service_form' THEN COALESCE(entry_date, pay_date) ELSE entry_date END,
           updated_at = now()
     WHERE service_table = TG_TABLE_NAME
       AND service_row_id = NEW.id
       AND source = 'service_form';
    RETURN NEW;
  END IF;

  IF receiver IS NULL OR amt <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO receiver_name FROM public.profiles WHERE user_id = receiver;
  rid := 'RCV-' || to_char(pay_date, 'YYYYMM') || '-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 8));

  INSERT INTO public.payment_receipts (
    receipt_id, entry_date, service_type, service_table, service_row_id, ref_id,
    passenger_name, received_by, received_by_name, amount, method, source, created_by
  ) VALUES (
    rid, pay_date, svc, TG_TABLE_NAME, NEW.id, ref,
    COALESCE(pname, ''), receiver, receiver_name, amt, 'Cash', 'service_form', NEW.created_by
  )
  ON CONFLICT (service_table, service_row_id) WHERE source = 'service_form'
  DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_agency_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_agency text;
  v_passenger text;
  v_sold numeric;
  v_recv numeric;
  v_discount numeric;
  v_cost numeric;
  v_profit numeric;
  v_service text;
  v_date date;
  v_pay_date date;
  v_new_id text;
  v_country_route text;
BEGIN
  v_agency    := NEW.agency_sold;
  v_passenger := NEW.passenger_name;
  v_sold      := COALESCE(NEW.sold_price, 0);
  v_discount  := COALESCE(NEW.discount_amount, 0);
  v_cost      := COALESCE(NEW.cost_price, 0);

  IF TG_TABLE_NAME IN ('tickets','kuwait_visas') THEN
    v_recv := COALESCE(NEW.received, 0);
  ELSE
    v_recv := COALESCE(NEW.received_amount, 0);
  END IF;

  v_profit := v_sold - v_discount - v_cost;
  v_date := COALESCE(NEW.entry_date, CURRENT_DATE);
  v_pay_date := NEW.payment_date;
  v_service := TG_TABLE_NAME;
  v_country_route := NULL;

  IF TG_TABLE_NAME = 'tickets' THEN
    v_country_route := NEW.trip_road;
    IF COALESCE(NEW.cancelled, false) THEN
      v_sold := COALESCE(NEW.office_refund_fee, 0);
      v_recv := COALESCE(NEW.office_refund_fee, 0);
      v_discount := 0;
      v_profit := COALESCE(NEW.office_refund_fee, 0) - COALESCE(NEW.vendor_refund_fee, 0);
    END IF;
  ELSIF TG_TABLE_NAME = 'bmet_cards' THEN
    v_country_route := NEW.country_name;
  ELSIF TG_TABLE_NAME = 'kuwait_visas' THEN
    v_country_route := 'Kuwait';
  ELSIF TG_TABLE_NAME = 'saudi_visas' THEN
    v_country_route := 'Saudi Arabia';
  ELSIF TG_TABLE_NAME = 'others' THEN
    v_country_route := NEW.service_name;
  END IF;

  IF v_agency IS NULL OR length(trim(v_agency)) = 0 THEN
    IF TG_OP = 'UPDATE' THEN
      DELETE FROM public.agency_ledger WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.agency_ledger WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id) THEN
    UPDATE public.agency_ledger SET
      entry_date = v_date,
      payment_date = v_pay_date,
      agent_name = v_agency,
      passenger_name = v_passenger,
      service_type = v_service,
      country_route = COALESCE(v_country_route, country_route),
      total_bill = v_sold,
      received_amount = v_recv,
      discount_amount = v_discount,
      passport = NEW.passport,
      mobile = NEW.mobile,
      profit = v_profit,
      received_by = NEW.received_by,
      created_by = COALESCE(created_by, NEW.created_by),
      updated_at = now()
    WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id;
  ELSE
    v_new_id := public.next_module_id('AGL', 'agency_ledger', 'ledger_id');
    INSERT INTO public.agency_ledger
      (ledger_id, entry_date, payment_date, agent_name, passenger_name, service_type,
       country_route, total_bill, received_amount, discount_amount, passport, mobile, profit,
       source_table, source_id, created_by, received_by)
    VALUES
      (v_new_id, v_date, v_pay_date, v_agency, v_passenger, v_service,
       v_country_route, v_sold, v_recv, v_discount, NEW.passport, NEW.mobile, v_profit,
       TG_TABLE_NAME, NEW.id, NEW.created_by, NEW.received_by);
  END IF;

  RETURN NEW;
END;
$function$;

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
      entry_date = v_date, payment_date = v_pay_date, agent_name = v_agency,
      passenger_name = v_passenger, service_type = v_svc, country_route = v_svc,
      total_bill = v_price, received_amount = v_recv, discount_amount = v_disc,
      passport = NEW.passport, mobile = NEW.mobile, profit = v_price - v_cost,
      remarks = v_notes, created_by = COALESCE(created_by, NEW.created_by), updated_at = now()
    WHERE source_table = 'extra_services' AND source_id = NEW.id;
  ELSE
    v_new_id := public.next_module_id('AGL', 'agency_ledger', 'ledger_id');
    INSERT INTO public.agency_ledger
      (ledger_id, entry_date, payment_date, agent_name, passenger_name, service_type,
       country_route, total_bill, received_amount, discount_amount, passport, mobile, profit,
       remarks, source_table, source_id, created_by)
    VALUES
      (v_new_id, v_date, v_pay_date, v_agency, v_passenger, v_svc,
       v_svc, v_price, v_recv, v_disc, NEW.passport, NEW.mobile, v_price - v_cost,
       v_notes, 'extra_services', NEW.id, NEW.created_by);
  END IF;

  RETURN NEW;
END;
$function$;

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

  INSERT INTO public.payment_receipts (
    receipt_id, entry_date, service_type, service_table, service_row_id, ref_id,
    passenger_name, received_by, received_by_name, amount, method, source, remarks, created_by
  ) VALUES (
    v_receipt_id, v_date,
    CASE WHEN v_source = 'agency_ledger_payment' THEN 'Service Receipt: ' || COALESCE(NEW.agent_name, '')
         ELSE 'Agent Receipt: ' || COALESCE(NEW.agent_name, '') END,
    'agency_ledger', NEW.id, NEW.ledger_id,
    COALESCE(NEW.passenger_name, NEW.agent_name, ''),
    v_user, v_user_name, v_unlocked,
    COALESCE(NULLIF(NEW.payment_method, ''), 'Cash'), v_source,
    concat_ws(' · ',
      CASE WHEN v_source = 'agency_ledger_payment' THEN 'সার্ভিস/কাস্টমার পেমেন্ট রিসিভ'
           ELSE 'Customer/Sub-Agent payment received' END,
      NULLIF(NEW.remarks, '')
    ),
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

  RETURN NEW;
END;
$function$;

UPDATE public.agency_ledger al
   SET payment_date = COALESCE(src.payment_date, al.payment_date)
  FROM (
    SELECT 'tickets'::text t, id, payment_date FROM public.tickets
    UNION ALL SELECT 'bmet_cards', id, payment_date FROM public.bmet_cards
    UNION ALL SELECT 'saudi_visas', id, payment_date FROM public.saudi_visas
    UNION ALL SELECT 'kuwait_visas', id, payment_date FROM public.kuwait_visas
    UNION ALL SELECT 'others', id, payment_date FROM public.others
    UNION ALL SELECT 'extra_services', id, payment_date FROM public.extra_services
  ) src
 WHERE al.source_table = src.t
   AND al.source_id = src.id
   AND al.payment_date IS NULL
   AND src.payment_date IS NOT NULL;

UPDATE public.agency_ledger
   SET received_amount = received_amount
 WHERE source_table IS NOT NULL
   AND length(source_table) > 0
   AND COALESCE(received_amount, 0) > 0;