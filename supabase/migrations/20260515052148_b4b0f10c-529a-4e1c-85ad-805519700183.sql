ALTER TABLE public.agency_ledger
  ADD COLUMN IF NOT EXISTS passport text,
  ADD COLUMN IF NOT EXISTS mobile text,
  ADD COLUMN IF NOT EXISTS profit numeric DEFAULT 0;

ALTER TABLE public.vendor_ledger
  ADD COLUMN IF NOT EXISTS passport text,
  ADD COLUMN IF NOT EXISTS mobile text,
  ADD COLUMN IF NOT EXISTS profit numeric DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_agency_ledger_passport ON public.agency_ledger (passport);
CREATE INDEX IF NOT EXISTS idx_vendor_ledger_passport ON public.vendor_ledger (passport);

CREATE OR REPLACE FUNCTION public.sync_agency_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency text;
  v_passenger text;
  v_sold numeric;
  v_recv numeric;
  v_cost numeric;
  v_service text;
  v_date date;
  v_new_id text;
  v_country_route text;
BEGIN
  v_agency    := NEW.agency_sold;
  v_passenger := NEW.passenger_name;
  v_sold      := COALESCE(NEW.sold_price, 0);
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
      passport = NEW.passport,
      mobile = NEW.mobile,
      profit = v_sold - v_cost,
      received_by = NEW.received_by,
      created_by = COALESCE(created_by, NEW.created_by),
      updated_at = now()
    WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id;
  ELSE
    v_new_id := public.next_module_id('AGL', 'agency_ledger', 'ledger_id');
    INSERT INTO public.agency_ledger
      (ledger_id, entry_date, agent_name, passenger_name, service_type,
       country_route, total_bill, received_amount, passport, mobile, profit,
       source_table, source_id, created_by, received_by)
    VALUES
      (v_new_id, v_date, v_agency, v_passenger, v_service,
       v_country_route, v_sold, v_recv, NEW.passport, NEW.mobile, v_sold - v_cost,
       TG_TABLE_NAME, NEW.id, NEW.created_by, NEW.received_by);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_vendor_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
      paid_amount = v_paid,
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

UPDATE public.agency_ledger l
SET
  passport = s.passport,
  mobile = s.mobile,
  profit = COALESCE(s.sold_price, 0) - COALESCE(s.cost_price, 0),
  country_route = COALESCE(l.country_route, s.country_route)
FROM (
  SELECT id, passport, mobile, sold_price, cost_price, trip_road AS country_route FROM public.tickets
  UNION ALL
  SELECT id, passport, mobile, sold_price, cost_price, country_name AS country_route FROM public.bmet_cards
  UNION ALL
  SELECT id, passport, mobile, sold_price, cost_price, 'Kuwait'::text AS country_route FROM public.kuwait_visas
  UNION ALL
  SELECT id, passport, mobile, sold_price, cost_price, 'Saudi Arabia'::text AS country_route FROM public.saudi_visas
) s
WHERE l.source_id = s.id;

UPDATE public.vendor_ledger l
SET
  passport = s.passport,
  mobile = s.mobile,
  profit = COALESCE(s.sold_price, 0) - COALESCE(s.cost_price, 0),
  country_route = COALESCE(l.country_route, s.country_route)
FROM (
  SELECT id, passport, mobile, sold_price, cost_price, trip_road AS country_route FROM public.tickets
  UNION ALL
  SELECT id, passport, mobile, sold_price, cost_price, country_name AS country_route FROM public.bmet_cards
  UNION ALL
  SELECT id, passport, mobile, sold_price, cost_price, 'Kuwait'::text AS country_route FROM public.kuwait_visas
  UNION ALL
  SELECT id, passport, mobile, sold_price, cost_price, 'Saudi Arabia'::text AS country_route FROM public.saudi_visas
) s
WHERE l.source_id = s.id;