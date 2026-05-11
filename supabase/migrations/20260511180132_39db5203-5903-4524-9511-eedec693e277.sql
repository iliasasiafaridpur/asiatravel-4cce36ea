
-- ============================================================
-- 1) Replace public policies with authenticated-only on all business tables
-- ============================================================
DO $$
DECLARE
  t text;
  pol record;
  tables text[] := ARRAY[
    'tickets','bmet_cards','saudi_visas','kuwait_visas',
    'passengers','agents','vendors',
    'agency_ledger','vendor_ledger',
    'cash_transfers','cash_expenses'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;
    EXECUTE format('CREATE POLICY "auth_select" ON public.%I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY "auth_insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "auth_update" ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "auth_delete" ON public.%I FOR DELETE TO authenticated USING (true)', t);
  END LOOP;
END $$;

-- ============================================================
-- 2) lookups: authenticated read + write
-- ============================================================
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='lookups' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.lookups', pol.policyname);
  END LOOP;
END $$;
CREATE POLICY "lookups_auth_select" ON public.lookups FOR SELECT TO authenticated USING (true);
CREATE POLICY "lookups_auth_insert" ON public.lookups FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "lookups_auth_update" ON public.lookups FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "lookups_auth_delete" ON public.lookups FOR DELETE TO authenticated USING (true);

-- ============================================================
-- 3) profiles: prevent role escalation
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.role := 'staff';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      NEW.role := OLD.role;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_prevent_role_escalation_ins ON public.profiles;
DROP TRIGGER IF EXISTS trg_prevent_role_escalation_upd ON public.profiles;
CREATE TRIGGER trg_prevent_role_escalation_ins
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_role_escalation();
CREATE TRIGGER trg_prevent_role_escalation_upd
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_role_escalation();

-- ============================================================
-- 4) get_cash_drawer: lock to authenticated + own user only
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.get_cash_drawer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_drawer(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_cash_drawer(_user_id uuid)
 RETURNS TABLE(user_id uuid, full_name text, total_received numeric, total_received_today numeric, total_handed_over numeric, total_received_in numeric, total_expenses numeric, current_balance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF auth.uid() <> _user_id THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  WITH recv AS (
    SELECT COALESCE(SUM(amt),0) AS total, COALESCE(SUM(amt) FILTER (WHERE d = CURRENT_DATE),0) AS today
    FROM (
      SELECT COALESCE(received,0) AS amt, entry_date AS d FROM tickets WHERE received_by = _user_id
      UNION ALL
      SELECT COALESCE(received_amount,0), entry_date FROM bmet_cards WHERE received_by = _user_id
      UNION ALL
      SELECT COALESCE(received_amount,0), entry_date FROM saudi_visas WHERE received_by = _user_id
      UNION ALL
      SELECT COALESCE(received,0), entry_date FROM kuwait_visas WHERE received_by = _user_id
    ) x
  ),
  out_xfer AS (SELECT COALESCE(SUM(amount),0) AS total FROM cash_transfers WHERE from_user = _user_id),
  in_xfer  AS (SELECT COALESCE(SUM(amount),0) AS total FROM cash_transfers WHERE to_user = _user_id),
  exp      AS (SELECT COALESCE(SUM(amount),0) AS total FROM cash_expenses WHERE spent_by = _user_id),
  prof     AS (SELECT p.user_id, p.full_name FROM profiles p WHERE p.user_id = _user_id)
  SELECT
    _user_id,
    COALESCE((SELECT full_name FROM prof), 'User'),
    (SELECT total FROM recv),
    (SELECT today FROM recv),
    (SELECT total FROM out_xfer),
    (SELECT total FROM in_xfer),
    (SELECT total FROM exp),
    (SELECT total FROM recv) + (SELECT total FROM in_xfer) - (SELECT total FROM out_xfer) - (SELECT total FROM exp);
END $function$;

-- ============================================================
-- 5) set_updated_at: add search_path
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
