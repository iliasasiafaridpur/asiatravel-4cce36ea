
-- 1. Schema additions
ALTER TABLE public.payment_receipts
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'auto_approved',
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS handover_id uuid;

ALTER TABLE public.cash_handovers
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS submitted_amount numeric,
  ADD COLUMN IF NOT EXISTS confirmed_amount numeric,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS closing_date date;

CREATE INDEX IF NOT EXISTS idx_pr_approval ON public.payment_receipts(approval_status);
CREATE INDEX IF NOT EXISTS idx_pr_handover ON public.payment_receipts(handover_id);
CREATE INDEX IF NOT EXISTS idx_ch_status ON public.cash_handovers(status);

-- 2. day_locks table
CREATE TABLE IF NOT EXISTS public.day_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  locked_date date NOT NULL,
  handover_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, locked_date)
);
ALTER TABLE public.day_locks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_select_locks ON public.day_locks;
DROP POLICY IF EXISTS auth_insert_locks ON public.day_locks;
DROP POLICY IF EXISTS md_admin_delete_locks ON public.day_locks;
CREATE POLICY auth_select_locks ON public.day_locks FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_insert_locks ON public.day_locks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY md_admin_delete_locks ON public.day_locks FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR EXISTS(SELECT 1 FROM public.profiles WHERE user_id=auth.uid() AND role='md')
  );

-- 3. Helper: is_md
CREATE OR REPLACE FUNCTION public.is_md(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=_uid AND role='md');
$$;

-- 4. Auto-stamp approval on insert
CREATE OR REPLACE FUNCTION public.set_receipt_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.received_by IS NOT NULL
     AND (public.is_md(NEW.received_by) OR public.has_role(NEW.received_by,'admin'::app_role)) THEN
    NEW.approval_status := 'auto_approved';
    NEW.approved_by := NEW.received_by;
    NEW.approved_at := now();
  ELSE
    NEW.approval_status := 'pending_md';
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_set_receipt_approval ON public.payment_receipts;
CREATE TRIGGER trg_set_receipt_approval BEFORE INSERT ON public.payment_receipts
  FOR EACH ROW EXECUTE FUNCTION public.set_receipt_approval();

-- 5. Guard locked receipts
CREATE OR REPLACE FUNCTION public.guard_locked_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF public.is_md(auth.uid()) OR public.has_role(auth.uid(),'admin'::app_role) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='DELETE' THEN
    IF OLD.received_by IS NOT NULL AND EXISTS(
      SELECT 1 FROM public.day_locks
      WHERE user_id=OLD.received_by AND locked_date>=OLD.entry_date
    ) THEN
      RAISE EXCEPTION 'Receipt is locked by daily handover. Contact MD to unlock.';
    END IF;
    RETURN OLD;
  ELSE
    IF NEW.received_by IS NOT NULL AND EXISTS(
      SELECT 1 FROM public.day_locks
      WHERE user_id=NEW.received_by AND locked_date>=NEW.entry_date
    ) THEN
      RAISE EXCEPTION 'Receipt is locked by daily handover. Contact MD to unlock.';
    END IF;
    RETURN NEW;
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_guard_locked_receipt ON public.payment_receipts;
CREATE TRIGGER trg_guard_locked_receipt BEFORE UPDATE OR DELETE ON public.payment_receipts
  FOR EACH ROW EXECUTE FUNCTION public.guard_locked_receipt();

-- 6. submit_handover RPC
CREATE OR REPLACE FUNCTION public.submit_handover(
  _submitted_amount numeric,
  _closing_date date DEFAULT CURRENT_DATE,
  _remarks text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_name text;
  v_id uuid;
  v_handover_id text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF EXISTS(SELECT 1 FROM public.day_locks WHERE user_id=v_user AND locked_date=_closing_date) THEN
    RAISE EXCEPTION 'A handover for % already exists.', _closing_date;
  END IF;
  SELECT full_name INTO v_name FROM public.profiles WHERE user_id=v_user;
  v_handover_id := 'HND-' || to_char(_closing_date,'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));

  INSERT INTO public.cash_handovers(
    handover_id, entry_date, from_user, from_name, to_name, amount, method,
    remarks, status, submitted_amount, closing_date, created_by
  ) VALUES (
    v_handover_id, _closing_date, v_user, v_name, 'MD Sir',
    _submitted_amount, 'Hand Cash',
    _remarks, 'pending', _submitted_amount, _closing_date, v_user
  ) RETURNING id INTO v_id;

  UPDATE public.payment_receipts
     SET handover_id = v_id, updated_at = now()
   WHERE received_by = v_user
     AND entry_date <= _closing_date
     AND approval_status = 'pending_md'
     AND handover_id IS NULL;

  INSERT INTO public.day_locks(user_id, locked_date, handover_id)
    VALUES (v_user, _closing_date, v_id);

  RETURN v_id;
END $$;

-- 7. approve_handover RPC
CREATE OR REPLACE FUNCTION public.approve_handover(
  _handover_id uuid,
  _confirmed_amount numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.is_md(v_user) OR public.has_role(v_user,'admin'::app_role)) THEN
    RAISE EXCEPTION 'Only MD can approve handovers';
  END IF;
  UPDATE public.cash_handovers
     SET status='approved', confirmed_amount=_confirmed_amount, amount=_confirmed_amount,
         approved_by=v_user, approved_at=now(), updated_at=now()
   WHERE id=_handover_id;
  UPDATE public.payment_receipts
     SET approval_status='approved', approved_by=v_user, approved_at=now(), updated_at=now()
   WHERE handover_id=_handover_id;
END $$;

-- 8. reject_handover RPC
CREATE OR REPLACE FUNCTION public.reject_handover(
  _handover_id uuid,
  _reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.is_md(v_user) OR public.has_role(v_user,'admin'::app_role)) THEN
    RAISE EXCEPTION 'Only MD can reject handovers';
  END IF;
  UPDATE public.cash_handovers
     SET status='rejected', approved_by=v_user, approved_at=now(),
         remarks = COALESCE(remarks || ' · ', '') || 'Rejected: ' || COALESCE(_reason, ''),
         updated_at=now()
   WHERE id=_handover_id;
  UPDATE public.payment_receipts
     SET approval_status='pending_md', handover_id=NULL, updated_at=now()
   WHERE handover_id=_handover_id;
  DELETE FROM public.day_locks WHERE handover_id=_handover_id;
END $$;

-- 9. Update overview to expose pending separately
DROP FUNCTION IF EXISTS public.get_accounts_overview();
CREATE OR REPLACE FUNCTION public.get_accounts_overview()
RETURNS TABLE(
  user_id uuid, full_name text, role text,
  total_received numeric, total_handed_over numeric,
  total_expenses numeric, current_balance numeric, total_pending numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH people AS (
    SELECT p.user_id, COALESCE(p.full_name,'User') AS full_name, COALESCE(p.role,'staff') AS role
    FROM public.profiles p
    WHERE p.user_id=auth.uid()
       OR public.has_role(auth.uid(),'admin'::app_role)
       OR public.is_md(auth.uid())
  ),
  recv AS (
    SELECT received_by AS user_id,
           COALESCE(SUM(amount) FILTER (WHERE approval_status IN ('auto_approved','approved')),0) AS total,
           COALESCE(SUM(amount) FILTER (WHERE approval_status='pending_md'),0) AS pending
    FROM public.payment_receipts
    WHERE COALESCE(source,'')<>'discount'
      AND lower(COALESCE(method,''))<>'discount'
    GROUP BY received_by
  ),
  hand AS (
    SELECT from_user AS user_id, COALESCE(SUM(amount),0) AS total
    FROM public.cash_handovers
    WHERE COALESCE(status,'approved')<>'rejected'
    GROUP BY from_user
  ),
  exp AS (
    SELECT spent_by AS user_id, COALESCE(SUM(amount),0) AS total
    FROM public.cash_expenses GROUP BY spent_by
  )
  SELECT people.user_id, people.full_name, people.role,
         COALESCE(recv.total,0), COALESCE(hand.total,0), COALESCE(exp.total,0),
         COALESCE(recv.total,0) - COALESCE(hand.total,0) - COALESCE(exp.total,0),
         COALESCE(recv.pending,0)
  FROM people
  LEFT JOIN recv ON recv.user_id=people.user_id
  LEFT JOIN hand ON hand.user_id=people.user_id
  LEFT JOIN exp ON exp.user_id=people.user_id
  ORDER BY 7 DESC, 2 ASC;
$$;

-- 10. Update get_user_account to add pending
DROP FUNCTION IF EXISTS public.get_user_account(uuid);
CREATE OR REPLACE FUNCTION public.get_user_account(_user_id uuid)
RETURNS TABLE(
  user_id uuid, full_name text, role text,
  total_received numeric, total_received_today numeric,
  total_handed_over numeric, total_expenses numeric,
  current_balance numeric, total_pending numeric
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF auth.uid() <> _user_id
     AND NOT public.has_role(auth.uid(),'admin'::app_role)
     AND NOT public.is_md(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  WITH recv AS (
    SELECT COALESCE(SUM(amount) FILTER (WHERE approval_status IN ('auto_approved','approved')),0) AS total,
           COALESCE(SUM(amount) FILTER (WHERE approval_status IN ('auto_approved','approved') AND entry_date=CURRENT_DATE),0) AS today,
           COALESCE(SUM(amount) FILTER (WHERE approval_status='pending_md'),0) AS pending
    FROM public.payment_receipts
    WHERE received_by=_user_id
      AND COALESCE(source,'')<>'discount'
      AND lower(COALESCE(method,''))<>'discount'
  ),
  hand AS (SELECT COALESCE(SUM(amount),0) AS total FROM public.cash_handovers
            WHERE from_user=_user_id AND COALESCE(status,'approved')<>'rejected'),
  exp  AS (SELECT COALESCE(SUM(amount),0) AS total FROM public.cash_expenses WHERE spent_by=_user_id),
  prof AS (SELECT p.full_name, COALESCE(p.role,'staff') AS role FROM public.profiles p WHERE p.user_id=_user_id)
  SELECT _user_id,
         COALESCE((SELECT full_name FROM prof),'User'),
         COALESCE((SELECT role FROM prof),'staff'),
         (SELECT total FROM recv),
         (SELECT today FROM recv),
         (SELECT total FROM hand),
         (SELECT total FROM exp),
         (SELECT total FROM recv) - (SELECT total FROM hand) - (SELECT total FROM exp),
         (SELECT pending FROM recv);
END $$;

-- 11. Backfill existing data
UPDATE public.payment_receipts
   SET approval_status='auto_approved', approved_at=COALESCE(approved_at,created_at)
 WHERE approval_status IS NULL OR approval_status='pending_md';

UPDATE public.cash_handovers
   SET status='approved', confirmed_amount=COALESCE(confirmed_amount,amount),
       submitted_amount=COALESCE(submitted_amount,amount),
       approved_at=COALESCE(approved_at,created_at)
 WHERE status IS NULL OR status='pending';
