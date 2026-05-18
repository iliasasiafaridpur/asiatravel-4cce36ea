ALTER TABLE public.vendor_ledger
  ADD COLUMN IF NOT EXISTS advance_applied numeric NOT NULL DEFAULT 0;

ALTER TABLE public.agency_ledger
  ADD COLUMN IF NOT EXISTS advance_applied numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.recalculate_vendor_advance(_vendor_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_remaining numeric;
  v_bill record;
  v_due numeric;
  v_take numeric;
BEGIN
  IF _vendor_name IS NULL OR length(trim(_vendor_name)) = 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(paid_amount), 0)
    INTO v_remaining
  FROM public.vendor_ledger
  WHERE vendor_name = _vendor_name
    AND UPPER(COALESCE(service_type, '')) = 'ADVANCE';

  UPDATE public.vendor_ledger
     SET advance_applied = 0,
         updated_at = now()
   WHERE vendor_name = _vendor_name
     AND UPPER(COALESCE(service_type, '')) NOT IN ('ADVANCE', 'OPENING', 'PAYMENT')
     AND COALESCE(advance_applied, 0) <> 0;

  FOR v_bill IN
    SELECT id, total_payable, paid_amount
      FROM public.vendor_ledger
     WHERE vendor_name = _vendor_name
       AND UPPER(COALESCE(service_type, '')) NOT IN ('ADVANCE', 'OPENING', 'PAYMENT')
     ORDER BY entry_date ASC, created_at ASC, id ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_due := GREATEST(COALESCE(v_bill.total_payable, 0) - COALESCE(v_bill.paid_amount, 0), 0);
    IF v_due <= 0 THEN
      CONTINUE;
    END IF;

    v_take := LEAST(v_remaining, v_due);
    UPDATE public.vendor_ledger
       SET advance_applied = v_take,
           updated_at = now()
     WHERE id = v_bill.id;
    v_remaining := v_remaining - v_take;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_agent_advance(_agent_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
     AND UPPER(COALESCE(service_type, '')) NOT IN ('ADVANCE', 'OPENING', 'PAYMENT')
     AND COALESCE(advance_applied, 0) <> 0;

  FOR v_bill IN
    SELECT id, total_bill, received_amount
      FROM public.agency_ledger
     WHERE agent_name = _agent_name
       AND UPPER(COALESCE(service_type, '')) NOT IN ('ADVANCE', 'OPENING', 'PAYMENT')
     ORDER BY entry_date ASC, created_at ASC, id ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_due := GREATEST(COALESCE(v_bill.total_bill, 0) - COALESCE(v_bill.received_amount, 0), 0);
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
$$;

CREATE OR REPLACE FUNCTION public.trg_recalculate_vendor_advance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_vendor_advance(OLD.vendor_name);
    RETURN OLD;
  END IF;

  PERFORM public.recalculate_vendor_advance(NEW.vendor_name);
  IF TG_OP = 'UPDATE' AND OLD.vendor_name IS DISTINCT FROM NEW.vendor_name THEN
    PERFORM public.recalculate_vendor_advance(OLD.vendor_name);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_recalculate_agent_advance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_agent_advance(OLD.agent_name);
    RETURN OLD;
  END IF;

  PERFORM public.recalculate_agent_advance(NEW.agent_name);
  IF TG_OP = 'UPDATE' AND OLD.agent_name IS DISTINCT FROM NEW.agent_name THEN
    PERFORM public.recalculate_agent_advance(OLD.agent_name);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalculate_vendor_advance ON public.vendor_ledger;
CREATE TRIGGER trg_recalculate_vendor_advance
AFTER INSERT OR DELETE OR UPDATE OF vendor_name, service_type, total_payable, paid_amount
ON public.vendor_ledger
FOR EACH ROW
EXECUTE FUNCTION public.trg_recalculate_vendor_advance();

DROP TRIGGER IF EXISTS trg_recalculate_agent_advance ON public.agency_ledger;
CREATE TRIGGER trg_recalculate_agent_advance
AFTER INSERT OR DELETE OR UPDATE OF agent_name, service_type, total_bill, received_amount
ON public.agency_ledger
FOR EACH ROW
EXECUTE FUNCTION public.trg_recalculate_agent_advance();

CREATE OR REPLACE FUNCTION public.get_vendor_wallet(_vendor_name text)
RETURNS TABLE(advance_balance numeric, payable_due numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH x AS (
    SELECT
      COALESCE(SUM(paid_amount) FILTER (WHERE UPPER(COALESCE(service_type,'')) = 'ADVANCE'),0) AS advance_in,
      COALESCE(SUM(advance_applied) FILTER (WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','OPENING','PAYMENT')),0) AS advance_used,
      COALESCE(SUM(total_payable) FILTER (WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','OPENING','PAYMENT')),0) AS bill,
      COALESCE(SUM(paid_amount) FILTER (WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','OPENING','PAYMENT')),0) AS cash_paid
    FROM public.vendor_ledger
    WHERE vendor_name = _vendor_name
  )
  SELECT GREATEST(advance_in - advance_used, 0),
         GREATEST(bill - cash_paid - advance_used, 0)
  FROM x;
$$;

CREATE OR REPLACE FUNCTION public.get_agent_wallet(_agent_name text)
RETURNS TABLE(advance_balance numeric, current_due numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH x AS (
    SELECT
      COALESCE(SUM(received_amount) FILTER (WHERE UPPER(COALESCE(service_type,'')) = 'ADVANCE'),0) AS advance_in,
      COALESCE(SUM(advance_applied) FILTER (WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','OPENING','PAYMENT')),0) AS advance_used,
      COALESCE(SUM(total_bill) FILTER (WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','OPENING','PAYMENT')),0) AS bill,
      COALESCE(SUM(received_amount) FILTER (WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','OPENING','PAYMENT')),0) AS cash_received
    FROM public.agency_ledger
    WHERE agent_name = _agent_name
  )
  SELECT GREATEST(advance_in - advance_used, 0),
         GREATEST(bill - cash_received - advance_used, 0)
  FROM x;
$$;

CREATE OR REPLACE FUNCTION public.get_vendor_balances()
RETURNS TABLE(vendor_name text, total_payable numeric, total_paid numeric, balance_due numeric, advance_balance numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH bills AS (
    SELECT vendor_name,
           COALESCE(SUM(total_payable),0) AS bill,
           COALESCE(SUM(paid_amount),0) AS cash_paid,
           COALESCE(SUM(advance_applied),0) AS advance_used
      FROM public.vendor_ledger
     WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','OPENING','PAYMENT')
     GROUP BY vendor_name
  ), adv AS (
    SELECT vendor_name,
           COALESCE(SUM(paid_amount),0) AS advance_in
      FROM public.vendor_ledger
     WHERE UPPER(COALESCE(service_type,'')) = 'ADVANCE'
     GROUP BY vendor_name
  ), names AS (
    SELECT vendor_name FROM bills UNION SELECT vendor_name FROM adv
  )
  SELECT n.vendor_name,
         COALESCE(b.bill,0) AS total_payable,
         COALESCE(b.cash_paid,0) + COALESCE(b.advance_used,0) AS total_paid,
         GREATEST(COALESCE(b.bill,0) - COALESCE(b.cash_paid,0) - COALESCE(b.advance_used,0), 0) AS balance_due,
         GREATEST(COALESCE(a.advance_in,0) - COALESCE(b.advance_used,0), 0) AS advance_balance
    FROM names n
    LEFT JOIN bills b ON b.vendor_name = n.vendor_name
    LEFT JOIN adv a ON a.vendor_name = n.vendor_name;
$$;

CREATE OR REPLACE FUNCTION public.get_agent_balances()
RETURNS TABLE(agent_name text, total_bill numeric, total_received numeric, balance_due numeric, advance_balance numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH bills AS (
    SELECT agent_name,
           COALESCE(SUM(total_bill),0) AS bill,
           COALESCE(SUM(received_amount),0) AS cash_received,
           COALESCE(SUM(advance_applied),0) AS advance_used
      FROM public.agency_ledger
     WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','OPENING','PAYMENT')
     GROUP BY agent_name
  ), adv AS (
    SELECT agent_name,
           COALESCE(SUM(received_amount),0) AS advance_in
      FROM public.agency_ledger
     WHERE UPPER(COALESCE(service_type,'')) = 'ADVANCE'
     GROUP BY agent_name
  ), names AS (
    SELECT agent_name FROM bills UNION SELECT agent_name FROM adv
  )
  SELECT n.agent_name,
         COALESCE(b.bill,0) AS total_bill,
         COALESCE(b.cash_received,0) + COALESCE(b.advance_used,0) AS total_received,
         GREATEST(COALESCE(b.bill,0) - COALESCE(b.cash_received,0) - COALESCE(b.advance_used,0), 0) AS balance_due,
         GREATEST(COALESCE(a.advance_in,0) - COALESCE(b.advance_used,0), 0) AS advance_balance
    FROM names n
    LEFT JOIN bills b ON b.agent_name = n.agent_name
    LEFT JOIN adv a ON a.agent_name = n.agent_name;
$$;

CREATE OR REPLACE FUNCTION public.sync_vendor_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vendor text;
  v_passenger text;
  v_cost numeric;
  v_paid numeric;
  v_sold numeric;
  v_service text;
  v_date date;
  v_new_id text;
  v_country_route text;
BEGIN
  v_vendor    := NEW.vendor_bought;
  v_passenger := NEW.passenger_name;
  v_cost      := COALESCE(NEW.cost_price, 0);
  v_sold      := COALESCE(NEW.sold_price, 0);

  IF TG_TABLE_NAME = 'saudi_visas' THEN
    v_paid := COALESCE(NEW.received_vendor, 0);
  ELSE
    v_paid := 0;
  END IF;

  v_date    := COALESCE(NEW.entry_date, CURRENT_DATE);
  v_service := TG_TABLE_NAME;
  v_country_route := NULL;

  IF TG_TABLE_NAME = 'tickets' THEN
    v_country_route := NEW.trip_road;
  ELSIF TG_TABLE_NAME = 'bmet_cards' THEN
    v_country_route := NEW.country_name;
  ELSIF TG_TABLE_NAME = 'kuwait_visas' THEN
    v_country_route := 'Kuwait';
  ELSIF TG_TABLE_NAME = 'saudi_visas' THEN
    v_country_route := 'Saudi Arabia';
  END IF;

  IF v_vendor IS NULL OR length(trim(v_vendor)) = 0 THEN
    IF TG_OP = 'UPDATE' THEN
      DELETE FROM public.vendor_ledger WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.vendor_ledger WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id) THEN
    UPDATE public.vendor_ledger SET
      entry_date = v_date,
      vendor_name = v_vendor,
      passenger_name = v_passenger,
      service_type = v_service,
      country_route = COALESCE(v_country_route, country_route),
      total_payable = v_cost,
      paid_amount = CASE WHEN TG_TABLE_NAME = 'saudi_visas' THEN v_paid ELSE paid_amount END,
      passport = NEW.passport,
      mobile = NEW.mobile,
      profit = v_sold - v_cost,
      created_by = COALESCE(created_by, NEW.created_by),
      updated_at = now()
    WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id;
  ELSE
    v_new_id := public.next_module_id('VDL', 'vendor_ledger', 'ledger_id');
    INSERT INTO public.vendor_ledger
      (ledger_id, entry_date, vendor_name, passenger_name, service_type,
       country_route, total_payable, paid_amount, passport, mobile, profit,
       source_table, source_id, created_by)
    VALUES
      (v_new_id, v_date, v_vendor, v_passenger, v_service,
       v_country_route, v_cost, v_paid, NEW.passport, NEW.mobile, v_sold - v_cost,
       TG_TABLE_NAME, NEW.id, NEW.created_by);
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN SELECT DISTINCT vendor_name FROM public.vendor_ledger LOOP
    PERFORM public.recalculate_vendor_advance(v_name);
  END LOOP;

  FOR v_name IN SELECT DISTINCT agent_name FROM public.agency_ledger LOOP
    PERFORM public.recalculate_agent_advance(v_name);
  END LOOP;
END $$;