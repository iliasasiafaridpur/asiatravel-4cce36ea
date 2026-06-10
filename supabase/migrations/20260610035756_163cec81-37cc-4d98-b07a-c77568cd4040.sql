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
  v_date date;
  v_svc text;
  v_notes text;
  v_new_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.vendor_ledger WHERE source_table = 'extra_services' AND source_id = OLD.id;
    DELETE FROM public.agency_ledger WHERE source_table = 'extra_services' AND source_id = OLD.id;
    RETURN OLD;
  END IF;

  v_vendor    := NEW.vendor_name;
  v_agency    := NEW.agency_sold;
  v_passenger := NEW.passenger_name;
  v_price     := COALESCE(NEW.service_price, 0);
  v_cost      := COALESCE(NEW.vendor_cost, 0);
  v_date      := COALESCE(NEW.entry_date, CURRENT_DATE);
  v_svc       := COALESCE(NEW.service_name, 'Extra Service');
  v_notes     := NULLIF(trim(COALESCE(NEW.notes, '')), '');

  -- Vendor mirror (cost goes to the already-selected vendor).
  -- Only when a vendor is chosen AND there is an actual vendor cost.
  IF v_vendor IS NULL OR length(trim(v_vendor)) = 0 OR v_cost = 0 THEN
    DELETE FROM public.vendor_ledger WHERE source_table = 'extra_services' AND source_id = NEW.id;
  ELSE
    IF EXISTS (SELECT 1 FROM public.vendor_ledger WHERE source_table = 'extra_services' AND source_id = NEW.id) THEN
      UPDATE public.vendor_ledger SET
        entry_date = v_date,
        vendor_name = v_vendor,
        passenger_name = v_passenger,
        service_type = v_svc,
        country_route = v_svc,
        total_payable = v_cost,
        passport = NEW.passport,
        mobile = NEW.mobile,
        profit = v_price - v_cost,
        remarks = v_notes,
        created_by = COALESCE(created_by, NEW.created_by),
        updated_at = now()
      WHERE source_table = 'extra_services' AND source_id = NEW.id;
    ELSE
      v_new_id := public.next_module_id('VDL', 'vendor_ledger', 'ledger_id');
      INSERT INTO public.vendor_ledger
        (ledger_id, entry_date, vendor_name, passenger_name, service_type,
         country_route, total_payable, paid_amount, passport, mobile, profit,
         remarks, source_table, source_id, created_by)
      VALUES
        (v_new_id, v_date, v_vendor, v_passenger, v_svc,
         v_svc, v_cost, 0, NEW.passport, NEW.mobile, v_price - v_cost,
         v_notes, 'extra_services', NEW.id, NEW.created_by);
    END IF;
  END IF;

  -- Agency / customer mirror (price billed to the customer/reference).
  -- Only when an agency/reference is set AND there is an actual customer price.
  IF v_agency IS NULL OR length(trim(v_agency)) = 0 OR v_price = 0 THEN
    DELETE FROM public.agency_ledger WHERE source_table = 'extra_services' AND source_id = NEW.id;
  ELSE
    IF EXISTS (SELECT 1 FROM public.agency_ledger WHERE source_table = 'extra_services' AND source_id = NEW.id) THEN
      UPDATE public.agency_ledger SET
        entry_date = v_date,
        agent_name = v_agency,
        passenger_name = v_passenger,
        service_type = v_svc,
        country_route = v_svc,
        total_bill = v_price,
        discount_amount = 0,
        passport = NEW.passport,
        mobile = NEW.mobile,
        profit = v_price - v_cost,
        remarks = v_notes,
        created_by = COALESCE(created_by, NEW.created_by),
        updated_at = now()
      WHERE source_table = 'extra_services' AND source_id = NEW.id;
    ELSE
      v_new_id := public.next_module_id('AGL', 'agency_ledger', 'ledger_id');
      INSERT INTO public.agency_ledger
        (ledger_id, entry_date, agent_name, passenger_name, service_type,
         country_route, total_bill, received_amount, discount_amount, passport, mobile, profit,
         remarks, source_table, source_id, created_by)
      VALUES
        (v_new_id, v_date, v_agency, v_passenger, v_svc,
         v_svc, v_price, 0, 0, NEW.passport, NEW.mobile, v_price - v_cost,
         v_notes, 'extra_services', NEW.id, NEW.created_by);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;