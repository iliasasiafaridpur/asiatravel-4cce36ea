ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS status_by text;
ALTER TABLE public.bmet_cards ADD COLUMN IF NOT EXISTS status_by text;
ALTER TABLE public.saudi_visas ADD COLUMN IF NOT EXISTS status_by text;
ALTER TABLE public.kuwait_visas ADD COLUMN IF NOT EXISTS status_by text;
ALTER TABLE public.others ADD COLUMN IF NOT EXISTS status_by text;