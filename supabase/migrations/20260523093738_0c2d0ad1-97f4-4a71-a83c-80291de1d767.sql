ALTER TABLE public.cash_expenses
  ADD COLUMN IF NOT EXISTS handover_id uuid;

CREATE INDEX IF NOT EXISTS idx_cash_expenses_handover
  ON public.cash_expenses(handover_id);

-- Owner/admin can delete only receipts that have not been submitted in a handover.
DROP POLICY IF EXISTS owner_delete_own_receipts ON public.payment_receipts;
DROP POLICY IF EXISTS "Users can delete own receipts" ON public.payment_receipts;
DROP POLICY IF EXISTS admin_delete ON public.payment_receipts;

CREATE POLICY owner_delete_own_receipts
ON public.payment_receipts
FOR DELETE TO authenticated
USING (
  handover_id IS NULL
  AND (received_by = auth.uid() OR created_by = auth.uid())
);

CREATE POLICY admin_delete
ON public.payment_receipts
FOR DELETE TO authenticated
USING (
  handover_id IS NULL
  AND public.has_role(auth.uid(), 'admin'::app_role)
);

-- Owner/admin can delete only expenses that have not been submitted in a handover.
DROP POLICY IF EXISTS owner_delete_own_expenses ON public.cash_expenses;
DROP POLICY IF EXISTS admin_delete ON public.cash_expenses;

CREATE POLICY owner_delete_own_expenses
ON public.cash_expenses
FOR DELETE TO authenticated
USING (
  handover_id IS NULL
  AND (spent_by = auth.uid() OR created_by = auth.uid())
  AND NOT EXISTS (
    SELECT 1
    FROM public.day_locks dl
    WHERE dl.user_id = COALESCE(cash_expenses.spent_by, cash_expenses.created_by)
      AND dl.locked_date = cash_expenses.entry_date
  )
);

CREATE POLICY admin_delete
ON public.cash_expenses
FOR DELETE TO authenticated
USING (
  handover_id IS NULL
  AND public.has_role(auth.uid(), 'admin'::app_role)
  AND NOT EXISTS (
    SELECT 1
    FROM public.day_locks dl
    WHERE dl.user_id = COALESCE(cash_expenses.spent_by, cash_expenses.created_by)
      AND dl.locked_date = cash_expenses.entry_date
  )
);

-- Owner/admin can delete only legacy/manual handover rows, not MD-submitted handovers.
DROP POLICY IF EXISTS owner_delete_own_handovers ON public.cash_handovers;
DROP POLICY IF EXISTS admin_delete ON public.cash_handovers;

CREATE POLICY owner_delete_own_handovers
ON public.cash_handovers
FOR DELETE TO authenticated
USING (
  submitted_amount IS NULL
  AND closing_date IS NULL
  AND COALESCE(status, 'approved') <> 'pending'
  AND (from_user = auth.uid() OR created_by = auth.uid())
);

CREATE POLICY admin_delete
ON public.cash_handovers
FOR DELETE TO authenticated
USING (
  submitted_amount IS NULL
  AND closing_date IS NULL
  AND COALESCE(status, 'approved') <> 'pending'
  AND public.has_role(auth.uid(), 'admin'::app_role)
);

-- Replace the old date-lock receipt guard: only handover-submitted receipts are undeletable.
CREATE OR REPLACE FUNCTION public.guard_locked_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.handover_id IS NOT NULL THEN
    RAISE EXCEPTION 'এই লেনদেন MD handover submit করা হয়েছে, তাই ডিলেট করা যাবে না।';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_locked_receipt ON public.payment_receipts;
CREATE TRIGGER trg_guard_locked_receipt
BEFORE DELETE ON public.payment_receipts
FOR EACH ROW
EXECUTE FUNCTION public.guard_locked_receipt();

CREATE OR REPLACE FUNCTION public.guard_submitted_expense_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.handover_id IS NOT NULL OR EXISTS (
    SELECT 1
    FROM public.day_locks dl
    WHERE dl.user_id = COALESCE(OLD.spent_by, OLD.created_by)
      AND dl.locked_date = OLD.entry_date
  ) THEN
    RAISE EXCEPTION 'এই খরচ MD handover submit করা হয়েছে, তাই ডিলেট করা যাবে না।';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_submitted_expense_delete ON public.cash_expenses;
CREATE TRIGGER trg_guard_submitted_expense_delete
BEFORE DELETE ON public.cash_expenses
FOR EACH ROW
EXECUTE FUNCTION public.guard_submitted_expense_delete();

CREATE OR REPLACE FUNCTION public.guard_submitted_handover_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.submitted_amount IS NOT NULL
     OR OLD.closing_date IS NOT NULL
     OR COALESCE(OLD.status, 'approved') = 'pending' THEN
    RAISE EXCEPTION 'এই cash handover MD-কে submit করা হয়েছে, তাই ডিলেট করা যাবে না।';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_submitted_handover_delete ON public.cash_handovers;
CREATE TRIGGER trg_guard_submitted_handover_delete
BEFORE DELETE ON public.cash_handovers
FOR EACH ROW
EXECUTE FUNCTION public.guard_submitted_handover_delete();

-- Link future expense rows to the MD handover they are submitted with.
CREATE OR REPLACE FUNCTION public.submit_handover(
  _submitted_amount numeric,
  _closing_date date DEFAULT CURRENT_DATE,
  _remarks text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_name text;
  v_id uuid;
  v_handover_id text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT full_name INTO v_name
  FROM public.profiles
  WHERE user_id = v_user;

  v_handover_id := 'HND-' || to_char(_closing_date, 'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

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

  UPDATE public.cash_expenses
     SET handover_id = v_id, updated_at = now()
   WHERE spent_by = v_user
     AND entry_date = _closing_date
     AND handover_id IS NULL;

  RETURN v_id;
END;
$$;