ALTER TABLE public.vendor_ledger ADD COLUMN IF NOT EXISTS alloc_detail jsonb;

COMMENT ON COLUMN public.vendor_ledger.alloc_detail IS 'For PAYMENT log rows: stores the per-bill allocation breakdown so an admin delete can reverse the payment.';