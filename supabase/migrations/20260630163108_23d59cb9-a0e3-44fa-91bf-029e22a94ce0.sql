-- Re-enable automatic Agency/Vendor identity assignment.
-- Only touches agents/vendors identity triggers and repairs missing/invalid serial/code values.

CREATE OR REPLACE FUNCTION public.assign_agent_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('public.agents.serial_no'));

  IF NEW.serial_no IS NULL OR NEW.serial_no <= 0 THEN
    SELECT COALESCE(MAX(serial_no), 0) + 1
      INTO NEW.serial_no
      FROM public.agents
     WHERE id IS DISTINCT FROM NEW.id;
  END IF;

  NEW.agent_code := 'AGT-' || lpad(NEW.serial_no::text, 3, '0');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_vendor_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('public.vendors.serial_no'));

  IF NEW.serial_no IS NULL OR NEW.serial_no <= 0 THEN
    SELECT COALESCE(MAX(serial_no), 0) + 1
      INTO NEW.serial_no
      FROM public.vendors
     WHERE id IS DISTINCT FROM NEW.id;
  END IF;

  NEW.vendor_code := 'VND-' || lpad(NEW.serial_no::text, 3, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agents_serial ON public.agents;
CREATE TRIGGER trg_agents_serial
BEFORE INSERT OR UPDATE OF serial_no ON public.agents
FOR EACH ROW
EXECUTE FUNCTION public.assign_agent_identity();

DROP TRIGGER IF EXISTS trg_vendors_serial ON public.vendors;
CREATE TRIGGER trg_vendors_serial
BEFORE INSERT OR UPDATE OF serial_no ON public.vendors
FOR EACH ROW
EXECUTE FUNCTION public.assign_vendor_identity();

-- Repair any existing rows with missing/invalid serial/code, without changing names or ledger data.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, name, id)::int AS rn
  FROM public.agents
  WHERE serial_no IS NULL OR serial_no <= 0 OR agent_code IS NULL OR btrim(agent_code) = ''
)
UPDATE public.agents a
SET serial_no = ordered.rn,
    agent_code = 'AGT-' || lpad(ordered.rn::text, 3, '0')
FROM ordered
WHERE a.id = ordered.id;

UPDATE public.agents
SET agent_code = 'AGT-' || lpad(serial_no::text, 3, '0')
WHERE serial_no IS NOT NULL
  AND (agent_code IS NULL OR agent_code !~ '^AGT-[0-9]+$' OR agent_code <> 'AGT-' || lpad(serial_no::text, 3, '0'));

WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, name, id)::int AS rn
  FROM public.vendors
  WHERE serial_no IS NULL OR serial_no <= 0 OR vendor_code IS NULL OR btrim(vendor_code) = ''
)
UPDATE public.vendors v
SET serial_no = ordered.rn,
    vendor_code = 'VND-' || lpad(ordered.rn::text, 3, '0')
FROM ordered
WHERE v.id = ordered.id;

UPDATE public.vendors
SET vendor_code = 'VND-' || lpad(serial_no::text, 3, '0')
WHERE serial_no IS NOT NULL
  AND (vendor_code IS NULL OR vendor_code !~ '^VND-[0-9]+$' OR vendor_code <> 'VND-' || lpad(serial_no::text, 3, '0'));
