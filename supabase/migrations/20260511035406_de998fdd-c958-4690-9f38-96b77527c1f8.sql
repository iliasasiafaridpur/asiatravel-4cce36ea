CREATE TABLE IF NOT EXISTS public.lookups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, value)
);

ALTER TABLE public.lookups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view lookups" ON public.lookups FOR SELECT USING (true);
CREATE POLICY "Public can insert lookups" ON public.lookups FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can delete lookups" ON public.lookups FOR DELETE USING (true);
CREATE POLICY "Public can update lookups" ON public.lookups FOR UPDATE USING (true);

CREATE INDEX IF NOT EXISTS lookups_kind_idx ON public.lookups(kind);

INSERT INTO public.lookups (kind, value) VALUES
  ('country', 'Saudi Arabia'),
  ('country', 'Kuwait'),
  ('country', 'UAE'),
  ('country', 'Qatar'),
  ('country', 'Oman'),
  ('country', 'Malaysia'),
  ('country', 'Bahrain'),
  ('airline', 'Biman Bangladesh'),
  ('airline', 'Saudia'),
  ('airline', 'Emirates'),
  ('airline', 'Qatar Airways'),
  ('airline', 'Air Arabia'),
  ('airline', 'Salam Air'),
  ('airline', 'Kuwait Airways')
ON CONFLICT (kind, value) DO NOTHING;