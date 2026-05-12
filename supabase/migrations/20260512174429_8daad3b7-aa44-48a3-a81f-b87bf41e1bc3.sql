CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      NEW.role := 'staff';
      NEW.is_active := false;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
      IF NEW.role IS DISTINCT FROM OLD.role THEN
        NEW.role := OLD.role;
      END IF;
      IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        NEW.is_active := OLD.is_active;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

UPDATE public.profiles
SET is_active = true,
    role = 'admin',
    updated_at = now()
WHERE user_id IN (
  SELECT user_id
  FROM public.user_roles
  WHERE role = 'admin'
)
AND is_active = false;