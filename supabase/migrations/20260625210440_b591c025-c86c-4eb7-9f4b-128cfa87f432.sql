ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS phone_labels text;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS phone_labels text;