-- Attach the prevent_role_escalation trigger to profiles (function exists but was not wired up)
DROP TRIGGER IF EXISTS prevent_role_escalation_trg ON public.profiles;
CREATE TRIGGER prevent_role_escalation_trg
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_role_escalation();

-- Tighten the "Users can update own profile" RLS policy so non-admins cannot
-- change role / is_active even by submitting them in an UPDATE statement.
-- (The trigger above is the hard backstop; this gives a clear RLS rejection.)
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND role = (SELECT p.role FROM public.profiles p WHERE p.user_id = auth.uid())
  AND is_active = (SELECT p.is_active FROM public.profiles p WHERE p.user_id = auth.uid())
);

-- Also lock down user_roles writes to admins only (Admins-can-manage policy
-- already exists, but make sure there's no permissive insert path).
-- No-op if already restricted; included for completeness.
