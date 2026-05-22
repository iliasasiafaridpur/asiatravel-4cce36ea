ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.bmet_cards
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.saudi_visas
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.kuwait_visas
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.agency_ledger
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0;

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
  v_service text;
  v_date date;
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

  IF v_agency IS NULL OR length(trim(v_agency)) = 0 THEN
    IF TG_OP = 'UPDATE' THEN
      DELETE FROM public.agency_ledger WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.agency_ledger WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id) THEN
    UPDATE public.agency_ledger SET
      entry_date = v_date,
      agent_name = v_agency,
      passenger_name = v_passenger,
      service_type = v_service,
      country_route = COALESCE(v_country_route, country_route),
      total_bill = v_sold,
      received_amount = v_recv,
      discount_amount = v_discount,
      passport = NEW.passport,
      mobile = NEW.mobile,
      profit = v_sold - v_discount - v_cost,
      received_by = NEW.received_by,
      created_by = COALESCE(created_by, NEW.created_by),
      updated_at = now()
    WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id;
  ELSE
    v_new_id := public.next_module_id('AGL', 'agency_ledger', 'ledger_id');
    INSERT INTO public.agency_ledger
      (ledger_id, entry_date, agent_name, passenger_name, service_type,
       country_route, total_bill, received_amount, discount_amount, passport, mobile, profit,
       source_table, source_id, created_by, received_by)
    VALUES
      (v_new_id, v_date, v_agency, v_passenger, v_service,
       v_country_route, v_sold, v_recv, v_discount, NEW.passport, NEW.mobile, v_sold - v_discount - v_cost,
       TG_TABLE_NAME, NEW.id, NEW.created_by, NEW.received_by);
  END IF;

  RETURN NEW;
END;
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
      COALESCE(SUM(advance_applied) FILTER (WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','OPENING','PAYMENT')),0) AS advance_used,
      COALESCE(SUM(total_bill) FILTER (WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','OPENING','PAYMENT')),0) AS bill,
      COALESCE(SUM(received_amount) FILTER (WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','OPENING','PAYMENT')),0) AS cash_received,
      COALESCE(SUM(discount_amount) FILTER (WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','OPENING','PAYMENT')),0) AS discount_given
    FROM public.agency_ledger
    WHERE agent_name = _agent_name
  )
  SELECT GREATEST(advance_in - advance_used, 0),
         GREATEST(bill - cash_received - discount_given - advance_used, 0)
  FROM x;
$function$;

CREATE OR REPLACE FUNCTION public.get_agent_balances()
 RETURNS TABLE(agent_name text, total_bill numeric, total_received numeric, balance_due numeric, advance_balance numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH bills AS (
    SELECT agent_name,
           COALESCE(SUM(total_bill),0) AS bill,
           COALESCE(SUM(received_amount),0) AS cash_received,
           COALESCE(SUM(discount_amount),0) AS discount_given,
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
         GREATEST(COALESCE(b.bill,0) - COALESCE(b.cash_received,0) - COALESCE(b.discount_given,0) - COALESCE(b.advance_used,0), 0) AS balance_due,
         GREATEST(COALESCE(a.advance_in,0) - COALESCE(b.advance_used,0), 0) AS advance_balance
    FROM names n
    LEFT JOIN bills b ON b.agent_name = n.agent_name
    LEFT JOIN adv a ON a.agent_name = n.agent_name;
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
     AND UPPER(COALESCE(service_type, '')) NOT IN ('ADVANCE', 'OPENING', 'PAYMENT')
     AND COALESCE(advance_applied, 0) <> 0;

  FOR v_bill IN
    SELECT id, total_bill, received_amount, discount_amount
      FROM public.agency_ledger
     WHERE agent_name = _agent_name
       AND UPPER(COALESCE(service_type, '')) NOT IN ('ADVANCE', 'OPENING', 'PAYMENT')
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

CREATE OR REPLACE FUNCTION public.auto_apply_agent_advance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_advance numeric;
  v_due numeric;
  v_take numeric;
  v_applied numeric := 0;
  v_adv record;
  v_remaining numeric;
BEGIN
  IF UPPER(COALESCE(NEW.service_type, '')) IN ('ADVANCE','PAYMENT','OPENING') THEN
    RETURN NEW;
  END IF;

  v_due := COALESCE(NEW.total_bill,0) - COALESCE(NEW.received_amount,0) - COALESCE(NEW.discount_amount,0);
  IF v_due <= 0 THEN RETURN NEW; END IF;

  SELECT GREATEST(COALESCE(SUM(received_amount),0) - COALESCE(SUM(total_bill),0), 0)
    INTO v_advance
  FROM public.agency_ledger
  WHERE agent_name = NEW.agent_name
    AND id <> NEW.id;

  IF v_advance <= 0 THEN RETURN NEW; END IF;

  v_take := LEAST(v_advance, v_due);
  v_remaining := v_take;

  FOR v_adv IN
    SELECT id, total_bill, received_amount,
           (COALESCE(received_amount,0) - COALESCE(total_bill,0)) AS credit
    FROM public.agency_ledger
    WHERE agent_name = NEW.agent_name
      AND id <> NEW.id
      AND COALESCE(received_amount,0) > COALESCE(total_bill,0)
    ORDER BY entry_date ASC, created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    DECLARE
      v_chunk numeric := LEAST(v_adv.credit, v_remaining);
    BEGIN
      UPDATE public.agency_ledger
        SET received_amount = COALESCE(received_amount,0) - v_chunk,
            updated_at = now()
      WHERE id = v_adv.id;
      v_remaining := v_remaining - v_chunk;
    END;
  END LOOP;

  v_applied := v_take - v_remaining;
  IF v_applied > 0 THEN
    UPDATE public.agency_ledger
      SET advance_applied = COALESCE(advance_applied,0) + v_applied,
          remarks = COALESCE(remarks || ' · ', '') || 'Auto-adjusted from advance: ৳' || v_applied::text,
          updated_at = now()
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;