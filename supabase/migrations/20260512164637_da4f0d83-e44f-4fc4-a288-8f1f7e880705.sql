
-- 1) Profiles: add mobile, designation, is_active
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mobile text,
  ADD COLUMN IF NOT EXISTS designation text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false;

-- 2) BMET tracking columns
ALTER TABLE public.bmet_cards
  ADD COLUMN IF NOT EXISTS submitted_date date,
  ADD COLUMN IF NOT EXISTS current_stage text,
  ADD COLUMN IF NOT EXISTS stage_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS stage_history jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 3) Update handle_new_user: capture mobile + designation, first user becomes admin+active
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
  v_active boolean := false;
  v_role  text := 'staff';
BEGIN
  SELECT count(*) INTO v_count FROM public.profiles;
  IF v_count = 0 THEN
    v_active := true;
    v_role := 'admin';
  END IF;

  INSERT INTO public.profiles (user_id, full_name, role, mobile, designation, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    v_role,
    NEW.raw_user_meta_data->>'mobile',
    NEW.raw_user_meta_data->>'designation',
    v_active
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- Mirror role into user_roles for first user
  IF v_role = 'admin' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- ensure trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4) Allow admins to UPDATE any profile (for activation + role changes)
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
CREATE POLICY "Admins can update any profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5) Adjust prevent_role_escalation: allow admins to change role
CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      NEW.role := 'staff';
      NEW.is_active := false;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      IF NEW.role IS DISTINCT FROM OLD.role THEN
        NEW.role := OLD.role;
      END IF;
      IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        NEW.is_active := OLD.is_active;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- 6) BMET stage history trigger
CREATE OR REPLACE FUNCTION public.bmet_log_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uname text;
BEGIN
  IF NEW.current_stage IS NOT NULL AND
     (TG_OP = 'INSERT' OR NEW.current_stage IS DISTINCT FROM OLD.current_stage) THEN
    NEW.stage_updated_at := now();
    SELECT full_name INTO uname FROM public.profiles WHERE user_id = auth.uid();
    NEW.stage_history := COALESCE(OLD.stage_history, '[]'::jsonb) ||
      jsonb_build_array(jsonb_build_object(
        'stage', NEW.current_stage,
        'at', now(),
        'by', auth.uid(),
        'by_name', COALESCE(uname, 'system')
      ));
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS bmet_log_stage_trg ON public.bmet_cards;
CREATE TRIGGER bmet_log_stage_trg
  BEFORE INSERT OR UPDATE OF current_stage ON public.bmet_cards
  FOR EACH ROW EXECUTE FUNCTION public.bmet_log_stage();

-- 7) Make existing users active (so login keeps working)
UPDATE public.profiles SET is_active = true WHERE is_active = false;
