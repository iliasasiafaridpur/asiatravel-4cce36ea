
-- Attach role-escalation prevention trigger to profiles
DROP TRIGGER IF EXISTS profiles_prevent_role_escalation ON public.profiles;
CREATE TRIGGER profiles_prevent_role_escalation
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_role_escalation();

-- Restrict Realtime channel access to authenticated users only
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read realtime" ON realtime.messages;
CREATE POLICY "Authenticated can read realtime"
ON realtime.messages
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Authenticated can send realtime" ON realtime.messages;
CREATE POLICY "Authenticated can send realtime"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (true);
