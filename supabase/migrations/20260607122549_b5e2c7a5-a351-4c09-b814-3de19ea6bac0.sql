-- =========================================================
-- 1. extra_services table
-- =========================================================
CREATE TABLE public.extra_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  service_name text NOT NULL,
  service_price numeric NOT NULL DEFAULT 0,
  vendor_cost numeric NOT NULL DEFAULT 0,
  vendor_name text,
  agency_sold text,
  passenger_name text,
  passport text,
  mobile text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_extra_services_source ON public.extra_services(source_table, source_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.extra_services TO authenticated;
GRANT ALL ON public.extra_services TO service_role;

ALTER TABLE public.extra_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select" ON public.extra_services FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_insert" ON public.extra_services FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON public.extra_services FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete" ON public.extra_services FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TRIGGER trg_extra_services_updated BEFORE UPDATE ON public.extra_services
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- 2. others table (new "Other" service module)
-- =========================================================
CREATE TABLE public.others (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  other_id text NOT NULL UNIQUE,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  passenger_name text NOT NULL,
  passport text,
  mobile text,
  service_name text,
  country_route text,
  sold_price numeric DEFAULT 0,
  agency_sold text,
  received_amount numeric DEFAULT 0,
  discount_amount numeric NOT NULL DEFAULT 0,
  payment_date date,
  vendor_bought text,
  cost_price numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'Pending',
  delivery_date date,
  entry_by text,
  notes text,
  created_by uuid,
  received_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_others_entry_date_desc ON public.others(entry_date DESC);
CREATE INDEX idx_others_vendor_bought ON public.others(vendor_bought);
CREATE INDEX idx_others_agency_sold ON public.others(agency_sold);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.others TO authenticated;
GRANT ALL ON public.others TO service_role;

ALTER TABLE public.others ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select" ON public.others FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert" ON public.others FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON public.others FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_delete" ON public.others FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- =========================================================
-- 3. sync_extra_service()
-- =========================================================
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

  -- Vendor mirror (cost goes to the already-selected vendor)
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
        created_by = COALESCE(created_by, NEW.created_by),
        updated_at = now()
      WHERE source_table = 'extra_services' AND source_id = NEW.id;
    ELSE
      v_new_id := public.next_module_id('VDL', 'vendor_ledger', 'ledger_id');
      INSERT INTO public.vendor_ledger
        (ledger_id, entry_date, vendor_name, passenger_name, service_type,
         country_route, total_payable, paid_amount, passport, mobile, profit,
         source_table, source_id, created_by)
      VALUES
        (v_new_id, v_date, v_vendor, v_passenger, v_svc,
         v_svc, v_cost, 0, NEW.passport, NEW.mobile, v_price - v_cost,
         'extra_services', NEW.id, NEW.created_by);
    END IF;
  END IF;

  -- Agency / customer mirror (price billed to the customer/reference)
  IF v_agency IS NULL OR length(trim(v_agency)) = 0 THEN
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
        received_amount = 0,
        discount_amount = 0,
        passport = NEW.passport,
        mobile = NEW.mobile,
        profit = v_price - v_cost,
        created_by = COALESCE(created_by, NEW.created_by),
        updated_at = now()
      WHERE source_table = 'extra_services' AND source_id = NEW.id;
    ELSE
      v_new_id := public.next_module_id('AGL', 'agency_ledger', 'ledger_id');
      INSERT INTO public.agency_ledger
        (ledger_id, entry_date, agent_name, passenger_name, service_type,
         country_route, total_bill, received_amount, discount_amount, passport, mobile, profit,
         source_table, source_id, created_by)
      VALUES
        (v_new_id, v_date, v_agency, v_passenger, v_svc,
         v_svc, v_price, 0, 0, NEW.passport, NEW.mobile, v_price - v_cost,
         'extra_services', NEW.id, NEW.created_by);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_sync_extra_service
  AFTER INSERT OR UPDATE OR DELETE ON public.extra_services
  FOR EACH ROW EXECUTE FUNCTION public.sync_extra_service();

-- =========================================================
-- 4. Extend existing sync functions to support 'others'
-- =========================================================
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
  pay_date := CURRENT_DATE;

  IF TG_OP = 'UPDATE' THEN
    UPDATE public.payment_receipts
       SET service_type = svc,
           ref_id = ref,
           passenger_name = COALESCE(pname, ''),
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

CREATE OR REPLACE FUNCTION public.cleanup_deleted_service_accounting()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  service_ref text;
BEGIN
  IF TG_TABLE_NAME = 'tickets' THEN
    service_ref := OLD.ticket_id;
  ELSIF TG_TABLE_NAME = 'bmet_cards' THEN
    service_ref := OLD.bmet_id;
  ELSIF TG_TABLE_NAME = 'saudi_visas' THEN
    service_ref := OLD.saudi_id;
  ELSIF TG_TABLE_NAME = 'kuwait_visas' THEN
    service_ref := OLD.kuwait_id;
  ELSIF TG_TABLE_NAME = 'others' THEN
    service_ref := OLD.other_id;
  ELSE
    service_ref := NULL;
  END IF;

  DELETE FROM public.payment_receipts
   WHERE service_row_id = OLD.id
      OR (service_table = TG_TABLE_NAME AND service_row_id = OLD.id)
      OR (service_ref IS NOT NULL AND ref_id = service_ref);

  DELETE FROM public.agency_ledger
   WHERE (source_table = TG_TABLE_NAME AND source_id = OLD.id)
      OR (service_ref IS NOT NULL AND service_type = TG_TABLE_NAME AND passenger_name = OLD.passenger_name);

  DELETE FROM public.vendor_ledger
   WHERE (source_table = TG_TABLE_NAME AND source_id = OLD.id)
      OR (service_ref IS NOT NULL AND service_type = TG_TABLE_NAME AND passenger_name = OLD.passenger_name);

  -- Remove this entry's extra services (their ledger mirrors auto-clear via their own trigger)
  DELETE FROM public.extra_services WHERE source_table = TG_TABLE_NAME AND source_id = OLD.id;

  RETURN OLD;
END;
$function$;

-- =========================================================
-- 5. Attach module triggers to 'others'
-- =========================================================
CREATE TRIGGER trg_others_updated BEFORE UPDATE ON public.others
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_sync_vendor_ledger
  AFTER INSERT OR UPDATE ON public.others
  FOR EACH ROW EXECUTE FUNCTION public.sync_vendor_ledger();

CREATE TRIGGER trg_sync_agency_ledger
  AFTER INSERT OR UPDATE ON public.others
  FOR EACH ROW EXECUTE FUNCTION public.sync_agency_ledger();

CREATE TRIGGER trg_sync_service_receipt
  AFTER INSERT OR UPDATE ON public.others
  FOR EACH ROW EXECUTE FUNCTION public.sync_service_receipt();

CREATE TRIGGER others_cleanup_deleted_service_accounting
  AFTER DELETE ON public.others
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_deleted_service_accounting();
