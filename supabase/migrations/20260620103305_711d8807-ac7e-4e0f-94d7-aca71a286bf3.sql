-- Stop broadcasting the profiles table over Supabase Realtime.
-- The profiles SELECT policy is USING(true) for all authenticated staff, which
-- means every authenticated subscriber could receive realtime change events
-- carrying sensitive fields (mobile, notify_email, role, is_active,
-- must_reset_password) for ALL staff. Direct queries still work (name lookups,
-- handover notification email lookups), so removing it from the realtime
-- publication closes the broadcast leak without breaking app functionality.
ALTER PUBLICATION supabase_realtime DROP TABLE public.profiles;