ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS trip_road TEXT;

DROP TRIGGER IF EXISTS bmet_log_stage_trg ON public.bmet_cards;
DROP FUNCTION IF EXISTS public.bmet_log_stage();

ALTER TABLE public.bmet_cards
  DROP COLUMN IF EXISTS submitted_date,
  DROP COLUMN IF EXISTS current_stage,
  DROP COLUMN IF EXISTS stage_updated_at,
  DROP COLUMN IF EXISTS stage_history;