-- Add per-party settlement preference (total = Auto FIFO, one_by_one = Bill-by-Bill)
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS settle_mode text NOT NULL DEFAULT 'total';
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS settle_mode text NOT NULL DEFAULT 'total';

-- Validate allowed values via trigger (CHECK is fine here since values are static,
-- but use a constraint for clarity)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_settle_mode_chk') THEN
    ALTER TABLE public.vendors
      ADD CONSTRAINT vendors_settle_mode_chk CHECK (settle_mode IN ('total','one_by_one'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_settle_mode_chk') THEN
    ALTER TABLE public.agents
      ADD CONSTRAINT agents_settle_mode_chk CHECK (settle_mode IN ('total','one_by_one'));
  END IF;
END $$;