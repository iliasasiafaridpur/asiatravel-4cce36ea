ALTER TABLE public.agency_ledger ADD COLUMN IF NOT EXISTS country_route text;
ALTER TABLE public.vendor_ledger ADD COLUMN IF NOT EXISTS country_route text;