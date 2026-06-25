ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS serial_no integer;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS serial_no integer;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS full_name text;

WITH ranked AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM public.vendors
)
UPDATE public.vendors v SET serial_no = ranked.rn FROM ranked WHERE v.id = ranked.id AND v.serial_no IS NULL;

WITH ranked AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM public.agents
)
UPDATE public.agents a SET serial_no = ranked.rn FROM ranked WHERE a.id = ranked.id AND a.serial_no IS NULL;

CREATE OR REPLACE FUNCTION public.assign_party_serial()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.serial_no IS NULL THEN
    IF TG_TABLE_NAME = 'vendors' THEN
      SELECT COALESCE(MAX(serial_no), 0) + 1 INTO NEW.serial_no FROM public.vendors;
    ELSE
      SELECT COALESCE(MAX(serial_no), 0) + 1 INTO NEW.serial_no FROM public.agents;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vendors_serial ON public.vendors;
CREATE TRIGGER trg_vendors_serial BEFORE INSERT ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.assign_party_serial();

DROP TRIGGER IF EXISTS trg_agents_serial ON public.agents;
CREATE TRIGGER trg_agents_serial BEFORE INSERT ON public.agents FOR EACH ROW EXECUTE FUNCTION public.assign_party_serial();