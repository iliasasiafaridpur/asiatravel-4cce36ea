DROP POLICY IF EXISTS owner_delete_own_receipts ON public.payment_receipts;
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

DROP POLICY IF EXISTS owner_delete_own_expenses ON public.cash_expenses;
DROP POLICY IF EXISTS admin_delete ON public.cash_expenses;

CREATE POLICY owner_delete_own_expenses
ON public.cash_expenses
FOR DELETE TO authenticated
USING (
  handover_id IS NULL
  AND (spent_by = auth.uid() OR created_by = auth.uid())
);

CREATE POLICY admin_delete
ON public.cash_expenses
FOR DELETE TO authenticated
USING (
  handover_id IS NULL
  AND public.has_role(auth.uid(), 'admin'::app_role)
);

CREATE OR REPLACE FUNCTION public.guard_locked_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.handover_id IS NOT NULL THEN
    RAISE EXCEPTION 'এই আয় MD handover submit করা হয়েছে, তাই ডিলেট করা যাবে না।';
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
  IF OLD.handover_id IS NOT NULL THEN
    RAISE EXCEPTION 'এই খরচ MD handover submit করা হয়েছে, তাই ডিলেট করা যাবে না।';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_submitted_expense_delete ON public.cash_expenses;
CREATE TRIGGER trg_guard_submitted_expense_delete
BEFORE DELETE ON public.cash_expenses
FOR EACH ROW
EXECUTE FUNCTION public.guard_submitted_expense_delete();