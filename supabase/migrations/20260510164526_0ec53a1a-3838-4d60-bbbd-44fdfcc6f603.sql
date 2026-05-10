
CREATE TABLE public.passengers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  passenger_id TEXT NOT NULL UNIQUE,
  passenger_name TEXT NOT NULL,
  passport TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.passengers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view passengers" ON public.passengers FOR SELECT USING (true);
CREATE POLICY "Public can insert passengers" ON public.passengers FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can update passengers" ON public.passengers FOR UPDATE USING (true);
CREATE POLICY "Public can delete passengers" ON public.passengers FOR DELETE USING (true);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_passengers_updated_at
BEFORE UPDATE ON public.passengers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.next_passenger_id()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prefix TEXT;
  last_seq INT;
  next_id TEXT;
BEGIN
  prefix := 'MAN-' || to_char(now(), 'YYMM') || '-';
  SELECT COALESCE(MAX(CAST(split_part(passenger_id, '-', 3) AS INT)), 0)
    INTO last_seq
    FROM public.passengers
    WHERE passenger_id LIKE prefix || '%';
  next_id := prefix || lpad((last_seq + 1)::TEXT, 3, '0');
  RETURN next_id;
END;
$$;

CREATE INDEX idx_passengers_status ON public.passengers(status);
CREATE INDEX idx_passengers_created_at ON public.passengers(created_at DESC);
