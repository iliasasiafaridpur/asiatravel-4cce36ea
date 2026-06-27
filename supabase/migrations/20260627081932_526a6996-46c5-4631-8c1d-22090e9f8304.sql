-- 1) Air Ticket cancel & refund columns
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS cancelled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancel_date date,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS vendor_refund numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vendor_refund_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS passenger_refund numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS passenger_refund_mode text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS office_refund_fee numeric NOT NULL DEFAULT 0;

-- 2) Vendor ledger sync: when an Air Ticket is cancelled, the vendor only keeps
--    the refund fee; the rest becomes office advance with that vendor.
CREATE OR REPLACE FUNCTION public.sync_vendor_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vendor text;
  v_passenger text;
  v_cost numeric;
  v_paid numeric;
  v_sold numeric;
  v_profit numeric;
  v_service text;
  v_date date;
  v_new_id text;
  v_country_route text;
  v_is_ticket_book boolean := false;
BEGIN
  v_vendor    := NEW.vendor_bought;
  v_passenger := NEW.passenger_name;
  v_cost      := COALESCE(NEW.cost_price, 0);
  v_sold      := COALESCE(NEW.sold_price, 0);
  v_profit    := v_sold - v_cost;

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
    IF UPPER(COALESCE(NEW.status, '')) = 'BOOK' THEN
      v_is_ticket_book := true;
    END IF;
    -- Cancelled & refunded ticket: vendor keeps only the refund fee.
    IF COALESCE(NEW.cancelled, false) THEN
      v_cost   := COALESCE(NEW.vendor_refund_fee, 0);
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

  IF v_is_ticket_book OR v_vendor IS NULL OR length(trim(v_vendor)) = 0 THEN
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
      profit = v_profit,
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
       v_country_route, v_cost, v_paid, NEW.passport, NEW.mobile, v_profit,
       TG_TABLE_NAME, NEW.id, NEW.created_by);
  END IF;

  RETURN NEW;
END;
$function$;

-- 3) Agency ledger sync: when an Air Ticket is cancelled, the passenger booking
--    nets to the office refund fee (service charge office keeps).
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

  v_date    := COALESCE(NEW.entry_date, CURRENT_DATE);
  v_service := TG_TABLE_NAME;
  v_country_route := NULL;

  IF TG_TABLE_NAME = 'tickets' THEN
    v_country_route := NEW.trip_road;
    -- Cancelled & refunded ticket: booking nets to the office refund fee.
    IF COALESCE(NEW.cancelled, false) THEN
      v_sold     := COALESCE(NEW.office_refund_fee, 0);
      v_recv     := COALESCE(NEW.office_refund_fee, 0);
      v_discount := 0;
      v_profit   := COALESCE(NEW.office_refund_fee, 0) - COALESCE(NEW.vendor_refund_fee, 0);
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
      (ledger_id, entry_date, agent_name, passenger_name, service_type,
       country_route, total_bill, received_amount, discount_amount, passport, mobile, profit,
       source_table, source_id, created_by, received_by)
    VALUES
      (v_new_id, v_date, v_agency, v_passenger, v_service,
       v_country_route, v_sold, v_recv, v_discount, NEW.passport, NEW.mobile, v_profit,
       TG_TABLE_NAME, NEW.id, NEW.created_by, NEW.received_by);
  END IF;

  RETURN NEW;
END;
$function$;

-- 4) On ticket delete, also clean up refund advance rows and linked refund expense.
CREATE OR REPLACE FUNCTION public.cleanup_ledgers_on_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.agency_ledger WHERE source_table = TG_TABLE_NAME AND source_id = OLD.id;
  DELETE FROM public.vendor_ledger WHERE source_table = TG_TABLE_NAME AND source_id = OLD.id;
  DELETE FROM public.agency_ledger WHERE source_table = 'ticket_refund_advance' AND source_id = OLD.id;
  DELETE FROM public.cash_expenses WHERE linked_source_table = 'ticket_refund' AND linked_source_id = OLD.id;
  RETURN OLD;
END;
$function$;