CREATE TABLE public.mobile_colors (
  mobile TEXT PRIMARY KEY,
  color TEXT NOT NULL DEFAULT 'default',
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mobile_colors TO authenticated;
GRANT ALL ON public.mobile_colors TO service_role;

ALTER TABLE public.mobile_colors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view mobile colors"
ON public.mobile_colors FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff can insert mobile colors"
ON public.mobile_colors FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Staff can update mobile colors"
ON public.mobile_colors FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Staff can delete mobile colors"
ON public.mobile_colors FOR DELETE TO authenticated USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.mobile_colors;