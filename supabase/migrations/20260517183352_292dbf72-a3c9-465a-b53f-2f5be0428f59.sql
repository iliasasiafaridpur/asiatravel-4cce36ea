-- Activity Hub: audit log table + auto-capture triggers

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_name text,
  actor_role text,
  action text NOT NULL,
  module text NOT NULL,
  entity_id text,
  entity_label text,
  summary text NOT NULL,
  changes jsonb,
  amount numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON public.activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_actor ON public.activity_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_module ON public.activity_logs (module);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON public.activity_logs (action);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select" ON public.activity_logs;
CREATE POLICY "auth_select" ON public.activity_logs FOR SELECT TO authenticated USING (true);
-- No INSERT/UPDATE/DELETE policies: only the SECURITY DEFINER trigger function writes.

-- Shared logging function
CREATE OR REPLACE FUNCTION public.log_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_name text;
  v_role text;
  v_action text;
  v_module text;
  v_entity_id text;
  v_entity_label text;
  v_summary text;
  v_amount numeric;
  v_changes jsonb := NULL;
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_key text;
BEGIN
  -- actor snapshot
  IF v_uid IS NOT NULL THEN
    SELECT full_name, role INTO v_name, v_role FROM public.profiles WHERE user_id = v_uid;
  END IF;
  v_name := COALESCE(v_name, 'System');
  v_role := COALESCE(v_role, 'system');

  -- action
  IF TG_OP = 'INSERT' THEN v_action := 'CREATED';
  ELSIF TG_OP = 'UPDATE' THEN v_action := 'UPDATED';
  ELSIF TG_OP = 'DELETE' THEN v_action := 'DELETED';
  END IF;

  -- module + entity + summary per table
  IF TG_TABLE_NAME = 'tickets' THEN
    v_module := 'tickets';
    v_row := to_jsonb(COALESCE(NEW, OLD));
    v_entity_id := v_row->>'ticket_id';
    v_entity_label := COALESCE(v_row->>'passenger_name','') || ' · ' || COALESCE(v_row->>'pnr','');
  ELSIF TG_TABLE_NAME = 'bmet_cards' THEN
    v_module := 'bmet';
    v_row := to_jsonb(COALESCE(NEW, OLD));
    v_entity_id := v_row->>'bmet_id';
    v_entity_label := COALESCE(v_row->>'passenger_name','') || ' · ' || COALESCE(v_row->>'passport','');
  ELSIF TG_TABLE_NAME = 'saudi_visas' THEN
    v_module := 'saudi_visa';
    v_row := to_jsonb(COALESCE(NEW, OLD));
    v_entity_id := v_row->>'saudi_id';
    v_entity_label := COALESCE(v_row->>'passenger_name','') || ' · ' || COALESCE(v_row->>'passport','');
  ELSIF TG_TABLE_NAME = 'kuwait_visas' THEN
    v_module := 'kuwait_visa';
    v_row := to_jsonb(COALESCE(NEW, OLD));
    v_entity_id := v_row->>'kuwait_id';
    v_entity_label := COALESCE(v_row->>'passenger_name','') || ' · ' || COALESCE(v_row->>'passport','');
  ELSIF TG_TABLE_NAME = 'vendor_ledger' THEN
    v_module := 'vendor_ledger';
    v_row := to_jsonb(COALESCE(NEW, OLD));
    v_entity_id := v_row->>'ledger_id';
    v_entity_label := COALESCE(v_row->>'vendor_name','');
  ELSIF TG_TABLE_NAME = 'agency_ledger' THEN
    v_module := 'agency_ledger';
    v_row := to_jsonb(COALESCE(NEW, OLD));
    v_entity_id := v_row->>'ledger_id';
    v_entity_label := COALESCE(v_row->>'agent_name','');
  ELSIF TG_TABLE_NAME = 'payment_receipts' THEN
    v_module := 'payment';
    v_row := to_jsonb(COALESCE(NEW, OLD));
    v_entity_id := v_row->>'receipt_id';
    v_entity_label := COALESCE(v_row->>'passenger_name','') || ' · ' || COALESCE(v_row->>'service_type','');
    v_amount := (v_row->>'amount')::numeric;
    IF TG_OP = 'INSERT' THEN v_action := 'PAYMENT_RECEIVED'; END IF;
  ELSIF TG_TABLE_NAME = 'cash_handovers' THEN
    v_module := 'handover';
    v_row := to_jsonb(COALESCE(NEW, OLD));
    v_entity_id := v_row->>'handover_id';
    v_entity_label := COALESCE(v_row->>'from_name','') || ' → ' || COALESCE(v_row->>'to_name','');
    v_amount := (v_row->>'amount')::numeric;
    IF TG_OP = 'INSERT' THEN v_action := 'HANDOVER'; END IF;
  ELSIF TG_TABLE_NAME = 'cash_expenses' THEN
    v_module := 'expense';
    v_row := to_jsonb(COALESCE(NEW, OLD));
    v_entity_id := v_row->>'expense_id';
    v_entity_label := COALESCE(v_row->>'category','') || ' · ' || COALESCE(v_row->>'purpose', v_row->>'remarks','');
    v_amount := (v_row->>'amount')::numeric;
    IF TG_OP = 'INSERT' THEN v_action := 'EXPENSE'; END IF;
  ELSIF TG_TABLE_NAME = 'passengers' THEN
    v_module := 'passenger';
    v_row := to_jsonb(COALESCE(NEW, OLD));
    v_entity_id := v_row->>'passenger_id';
    v_entity_label := COALESCE(v_row->>'passenger_name','') || ' · ' || COALESCE(v_row->>'passport','');
  ELSIF TG_TABLE_NAME = 'agents' THEN
    v_module := 'agent';
    v_row := to_jsonb(COALESCE(NEW, OLD));
    v_entity_id := v_row->>'agent_code';
    v_entity_label := COALESCE(v_row->>'name','');
  ELSIF TG_TABLE_NAME = 'vendors' THEN
    v_module := 'vendor';
    v_row := to_jsonb(COALESCE(NEW, OLD));
    v_entity_id := v_row->>'vendor_code';
    v_entity_label := COALESCE(v_row->>'name','');
  ELSE
    v_module := TG_TABLE_NAME;
    v_row := to_jsonb(COALESCE(NEW, OLD));
  END IF;

  -- diff for updates
  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_changes := '{}'::jsonb;
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      IF v_key NOT IN ('updated_at','created_at') AND v_new->v_key IS DISTINCT FROM v_old->v_key THEN
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('from', v_old->v_key, 'to', v_new->v_key));
      END IF;
    END LOOP;
    IF v_changes = '{}'::jsonb THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
  END IF;

  -- summary
  v_summary := v_name || ' ' || lower(v_action) || ' ' || v_module ||
               CASE WHEN v_entity_id IS NOT NULL THEN ' (' || v_entity_id || ')' ELSE '' END ||
               CASE WHEN v_entity_label IS NOT NULL AND length(v_entity_label) > 0 THEN ' — ' || v_entity_label ELSE '' END ||
               CASE WHEN v_amount IS NOT NULL THEN ' · ৳' || v_amount::text ELSE '' END;

  INSERT INTO public.activity_logs
    (actor_id, actor_name, actor_role, action, module, entity_id, entity_label, summary, changes, amount)
  VALUES
    (v_uid, v_name, v_role, v_action, v_module, v_entity_id, v_entity_label, v_summary, v_changes, v_amount);

  RETURN COALESCE(NEW, OLD);
END;
$fn$;

-- Attach triggers
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['tickets','bmet_cards','saudi_visas','kuwait_visas','vendor_ledger','agency_ledger','payment_receipts','cash_handovers','cash_expenses','passengers','agents','vendors'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_log_activity ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_log_activity AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_activity()', t);
  END LOOP;
END $$;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_logs;