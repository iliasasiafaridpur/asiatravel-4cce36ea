
-- =========================================================
-- 1) PROFILES TABLE (linked to auth.users)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT 'User',
  role text NOT NULL DEFAULT 'staff',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view profiles"
  ON public.profiles FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'staff'
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill existing users
INSERT INTO public.profiles (user_id, full_name, role)
SELECT id, COALESCE(raw_user_meta_data->>'full_name', split_part(email, '@', 1)), 'staff'
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- =========================================================
-- 2) ADD AUDIT COLUMNS to existing tables
-- =========================================================
ALTER TABLE public.tickets        ADD COLUMN IF NOT EXISTS created_by uuid, ADD COLUMN IF NOT EXISTS received_by uuid;
ALTER TABLE public.bmet_cards     ADD COLUMN IF NOT EXISTS created_by uuid, ADD COLUMN IF NOT EXISTS received_by uuid;
ALTER TABLE public.saudi_visas    ADD COLUMN IF NOT EXISTS created_by uuid, ADD COLUMN IF NOT EXISTS received_by uuid;
ALTER TABLE public.kuwait_visas   ADD COLUMN IF NOT EXISTS created_by uuid, ADD COLUMN IF NOT EXISTS received_by uuid;
ALTER TABLE public.agency_ledger  ADD COLUMN IF NOT EXISTS created_by uuid, ADD COLUMN IF NOT EXISTS received_by uuid;
ALTER TABLE public.vendor_ledger  ADD COLUMN IF NOT EXISTS created_by uuid, ADD COLUMN IF NOT EXISTS received_by uuid;

-- =========================================================
-- 3) ADD source tracking to ledgers (for auto-sync upsert)
-- =========================================================
ALTER TABLE public.agency_ledger
  ADD COLUMN IF NOT EXISTS source_table text,
  ADD COLUMN IF NOT EXISTS source_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS agency_ledger_source_uniq
  ON public.agency_ledger (source_table, source_id)
  WHERE source_table IS NOT NULL AND source_id IS NOT NULL;

ALTER TABLE public.vendor_ledger
  ADD COLUMN IF NOT EXISTS source_table text,
  ADD COLUMN IF NOT EXISTS source_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS vendor_ledger_source_uniq
  ON public.vendor_ledger (source_table, source_id)
  WHERE source_table IS NOT NULL AND source_id IS NOT NULL;

-- =========================================================
-- 4) CASH TRANSFERS TABLE
-- =========================================================
CREATE TABLE IF NOT EXISTS public.cash_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id text NOT NULL UNIQUE,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  from_user uuid,
  to_user uuid,
  from_name text,
  to_name text,
  amount numeric NOT NULL DEFAULT 0,
  method text NOT NULL DEFAULT 'Hand Cash', -- Hand Cash | Bank | bKash | Nagad | Other
  purpose text,
  remarks text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cash_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view cash_transfers"   ON public.cash_transfers FOR SELECT USING (true);
CREATE POLICY "Public can insert cash_transfers" ON public.cash_transfers FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can update cash_transfers" ON public.cash_transfers FOR UPDATE USING (true);
CREATE POLICY "Public can delete cash_transfers" ON public.cash_transfers FOR DELETE USING (true);

CREATE TRIGGER cash_transfers_set_updated_at
  BEFORE UPDATE ON public.cash_transfers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- 5) AUTO-SYNC TRIGGERS: source rows -> agency_ledger / vendor_ledger
-- =========================================================

-- Helper: get next ledger id (reuses next_module_id)
-- Sync to AGENCY ledger
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
  v_service text;
  v_date date;
  v_new_id text;
BEGIN
  v_agency    := NEW.agency_sold;
  v_passenger := NEW.passenger_name;
  v_sold      := COALESCE(NEW.sold_price, 0);
  -- received column varies: tickets/kuwait use 'received', bmet/saudi use 'received_amount'
  IF TG_TABLE_NAME IN ('tickets','kuwait_visas') THEN
    v_recv := COALESCE(NEW.received, 0);
  ELSE
    v_recv := COALESCE(NEW.received_amount, 0);
  END IF;
  v_date    := COALESCE(NEW.entry_date, CURRENT_DATE);
  v_service := TG_TABLE_NAME;

  -- skip if no agency
  IF v_agency IS NULL OR length(trim(v_agency)) = 0 THEN
    -- if updating and previously had a ledger row, delete it
    IF TG_OP = 'UPDATE' THEN
      DELETE FROM public.agency_ledger WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  -- upsert
  IF EXISTS (SELECT 1 FROM public.agency_ledger WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id) THEN
    UPDATE public.agency_ledger SET
      entry_date = v_date,
      agent_name = v_agency,
      passenger_name = v_passenger,
      service_type = v_service,
      total_bill = v_sold,
      received_amount = v_recv,
      received_by = NEW.received_by,
      created_by = COALESCE(created_by, NEW.created_by),
      updated_at = now()
    WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id;
  ELSE
    v_new_id := public.next_module_id('AGL', 'agency_ledger', 'ledger_id');
    INSERT INTO public.agency_ledger
      (ledger_id, entry_date, agent_name, passenger_name, service_type,
       total_bill, received_amount, source_table, source_id,
       created_by, received_by)
    VALUES
      (v_new_id, v_date, v_agency, v_passenger, v_service,
       v_sold, v_recv, TG_TABLE_NAME, NEW.id,
       NEW.created_by, NEW.received_by);
  END IF;

  RETURN NEW;
END;
$$;

-- Sync to VENDOR ledger
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
  v_service text;
  v_date date;
  v_new_id text;
BEGIN
  v_vendor    := NEW.vendor_bought;
  v_passenger := NEW.passenger_name;
  v_cost      := COALESCE(NEW.cost_price, 0);
  -- only saudi has 'received_vendor' for paid-to-vendor; default 0
  IF TG_TABLE_NAME = 'saudi_visas' THEN
    v_paid := COALESCE(NEW.received_vendor, 0);
  ELSE
    v_paid := 0;
  END IF;
  v_date    := COALESCE(NEW.entry_date, CURRENT_DATE);
  v_service := TG_TABLE_NAME;

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
      total_payable = v_cost,
      paid_amount = v_paid,
      created_by = COALESCE(created_by, NEW.created_by),
      updated_at = now()
    WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id;
  ELSE
    v_new_id := public.next_module_id('VDL', 'vendor_ledger', 'ledger_id');
    INSERT INTO public.vendor_ledger
      (ledger_id, entry_date, vendor_name, passenger_name, service_type,
       total_payable, paid_amount, source_table, source_id, created_by)
    VALUES
      (v_new_id, v_date, v_vendor, v_passenger, v_service,
       v_cost, v_paid, TG_TABLE_NAME, NEW.id, NEW.created_by);
  END IF;

  RETURN NEW;
END;
$$;

-- Cleanup ledger when source deleted
CREATE OR REPLACE FUNCTION public.cleanup_ledgers_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.agency_ledger WHERE source_table = TG_TABLE_NAME AND source_id = OLD.id;
  DELETE FROM public.vendor_ledger WHERE source_table = TG_TABLE_NAME AND source_id = OLD.id;
  RETURN OLD;
END;
$$;

-- Attach triggers to source tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tickets','bmet_cards','saudi_visas','kuwait_visas'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS sync_agency_ledger_trg ON public.%I', t);
    EXECUTE format('CREATE TRIGGER sync_agency_ledger_trg AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.sync_agency_ledger()', t);

    EXECUTE format('DROP TRIGGER IF EXISTS sync_vendor_ledger_trg ON public.%I', t);
    EXECUTE format('CREATE TRIGGER sync_vendor_ledger_trg AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.sync_vendor_ledger()', t);

    EXECUTE format('DROP TRIGGER IF EXISTS cleanup_ledgers_trg ON public.%I', t);
    EXECUTE format('CREATE TRIGGER cleanup_ledgers_trg AFTER DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.cleanup_ledgers_on_delete()', t);
  END LOOP;
END $$;

-- =========================================================
-- 6) OPEN LEDGER ROW WHEN AGENT/VENDOR CREATED
-- =========================================================
CREATE OR REPLACE FUNCTION public.open_agent_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id text;
BEGIN
  IF NEW.name IS NULL OR length(trim(NEW.name)) = 0 THEN RETURN NEW; END IF;
  v_id := public.next_module_id('AGL', 'agency_ledger', 'ledger_id');
  INSERT INTO public.agency_ledger
    (ledger_id, entry_date, agent_name, service_type, total_bill, received_amount, remarks)
  VALUES
    (v_id, CURRENT_DATE, NEW.name, 'opening', 0, 0, 'Account opened');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.open_vendor_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id text;
BEGIN
  IF NEW.name IS NULL OR length(trim(NEW.name)) = 0 THEN RETURN NEW; END IF;
  v_id := public.next_module_id('VDL', 'vendor_ledger', 'ledger_id');
  INSERT INTO public.vendor_ledger
    (ledger_id, entry_date, vendor_name, service_type, total_payable, paid_amount, remarks)
  VALUES
    (v_id, CURRENT_DATE, NEW.name, 'opening', 0, 0, 'Account opened');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS open_agent_ledger_trg ON public.agents;
CREATE TRIGGER open_agent_ledger_trg
  AFTER INSERT ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.open_agent_ledger();

DROP TRIGGER IF EXISTS open_vendor_ledger_trg ON public.vendors;
CREATE TRIGGER open_vendor_ledger_trg
  AFTER INSERT ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.open_vendor_ledger();

-- =========================================================
-- 7) ENABLE REALTIME on key tables
-- =========================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tickets','bmet_cards','saudi_visas','kuwait_visas','agency_ledger','vendor_ledger','cash_transfers','agents','vendors']
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;
