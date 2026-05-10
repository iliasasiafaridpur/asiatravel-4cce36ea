
-- Generic ID generator for any module table
CREATE OR REPLACE FUNCTION public.next_module_id(_prefix TEXT, _table TEXT, _column TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  full_prefix TEXT;
  last_seq INT;
  next_id TEXT;
  q TEXT;
BEGIN
  full_prefix := _prefix || '-' || to_char(now(), 'YYMM') || '-';
  q := format(
    'SELECT COALESCE(MAX(CAST(split_part(%I, ''-'', 3) AS INT)), 0) FROM public.%I WHERE %I LIKE $1',
    _column, _table, _column
  );
  EXECUTE q INTO last_seq USING full_prefix || '%';
  next_id := full_prefix || lpad((last_seq + 1)::TEXT, 3, '0');
  RETURN next_id;
END;
$$;

-- Simple sequential ID for non-monthly tables (agents, vendors)
CREATE OR REPLACE FUNCTION public.next_simple_id(_prefix TEXT, _table TEXT, _column TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_seq INT;
  q TEXT;
BEGIN
  q := format(
    'SELECT COALESCE(MAX(CAST(split_part(%I, ''-'', 2) AS INT)), 0) FROM public.%I WHERE %I LIKE $1',
    _column, _table, _column
  );
  EXECUTE q INTO last_seq USING _prefix || '-%';
  RETURN _prefix || '-' || lpad((last_seq + 1)::TEXT, 3, '0');
END;
$$;

-- TICKETS
CREATE TABLE public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id TEXT NOT NULL UNIQUE,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  passenger_name TEXT NOT NULL,
  passport TEXT,
  mobile TEXT,
  airline TEXT,
  pnr TEXT,
  flight_date DATE,
  agency_sold TEXT,
  vendor_bought TEXT,
  sold_price NUMERIC DEFAULT 0,
  cost_price NUMERIC DEFAULT 0,
  received NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending',
  entry_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- BMET CARDS
CREATE TABLE public.bmet_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bmet_id TEXT NOT NULL UNIQUE,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  passenger_name TEXT NOT NULL,
  passport TEXT,
  mobile TEXT,
  country_name TEXT,
  attested_date DATE,
  agency_sold TEXT,
  vendor_sent_date DATE,
  received_date DATE,
  vendor_bought TEXT,
  sold_price NUMERIC DEFAULT 0,
  cost_price NUMERIC DEFAULT 0,
  received_amount NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending',
  delivery_date DATE,
  entry_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SAUDI VISAS
CREATE TABLE public.saudi_visas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saudi_id TEXT NOT NULL UNIQUE,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  passenger_name TEXT NOT NULL,
  passport TEXT,
  mobile TEXT,
  visa_type TEXT,
  sponsor_name TEXT,
  visa_no TEXT,
  id_no TEXT,
  mofa_no TEXT,
  medical_status TEXT,
  rl_no TEXT,
  vendor_sent_date DATE,
  tasheer_finger_date DATE,
  final_visa_no TEXT,
  bmet_training BOOLEAN DEFAULT false,
  bmet_finger BOOLEAN DEFAULT false,
  bmet_status TEXT,
  agency_sold TEXT,
  vendor_bought TEXT,
  sold_price NUMERIC DEFAULT 0,
  cost_price NUMERIC DEFAULT 0,
  received_amount NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending',
  update_date DATE,
  received_vendor NUMERIC DEFAULT 0,
  delivery_date DATE,
  entry_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- KUWAIT VISAS
CREATE TABLE public.kuwait_visas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kuwait_id TEXT NOT NULL UNIQUE,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  passenger_name TEXT NOT NULL,
  passport TEXT,
  mobile TEXT,
  visa_no TEXT,
  sponsor_name TEXT,
  medical_status TEXT,
  agency_sold TEXT,
  vendor_bought TEXT,
  sold_price NUMERIC DEFAULT 0,
  cost_price NUMERIC DEFAULT 0,
  received NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending',
  delivery_date DATE,
  entry_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AGENCY LEDGER (sub-agent accounts)
CREATE TABLE public.agency_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id TEXT NOT NULL UNIQUE,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  agent_name TEXT NOT NULL,
  passenger_name TEXT,
  service_type TEXT,
  total_bill NUMERIC DEFAULT 0,
  received_amount NUMERIC DEFAULT 0,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- VENDOR LEDGER
CREATE TABLE public.vendor_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id TEXT NOT NULL UNIQUE,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  vendor_name TEXT NOT NULL,
  passenger_name TEXT,
  service_type TEXT,
  total_payable NUMERIC DEFAULT 0,
  paid_amount NUMERIC DEFAULT 0,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AGENTS
CREATE TABLE public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- VENDORS
CREATE TABLE public.vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS + public policies + updated_at trigger for all tables
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tickets','bmet_cards','saudi_visas','kuwait_visas','agency_ledger','vendor_ledger','agents','vendors']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "Public can view %1$s" ON public.%1$I FOR SELECT USING (true)', t);
    EXECUTE format('CREATE POLICY "Public can insert %1$s" ON public.%1$I FOR INSERT WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "Public can update %1$s" ON public.%1$I FOR UPDATE USING (true)', t);
    EXECUTE format('CREATE POLICY "Public can delete %1$s" ON public.%1$I FOR DELETE USING (true)', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
  END LOOP;
END $$;

-- Useful indexes
CREATE INDEX idx_tickets_status ON public.tickets(status);
CREATE INDEX idx_bmet_status ON public.bmet_cards(status);
CREATE INDEX idx_saudi_status ON public.saudi_visas(status);
CREATE INDEX idx_kuwait_status ON public.kuwait_visas(status);
