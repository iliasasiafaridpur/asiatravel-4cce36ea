ALTER TABLE public.bmet_cards
  ADD COLUMN IF NOT EXISTS call_status text,
  ADD COLUMN IF NOT EXISTS last_call_date date,
  ADD COLUMN IF NOT EXISTS called_by text;