DROP POLICY IF EXISTS owner_delete_own_receipts ON public.payment_receipts;
DROP POLICY IF EXISTS admin_delete ON public.payment_receipts;

CREATE POLICY owner_delete_own_receipts
ON public.payment_receipts
FOR DELETE TO authenticated
USING (
  handover_id IS NULL
  AND (received_by = auth.uid() OR created_by = auth.uid())
  AND NOT EXISTS (
    SELECT 1
    FROM public.day_locks dl
    WHERE dl.user_id = COALESCE(payment_receipts.received_by, payment_receipts.created_by)
      AND dl.locked_date >= payment_receipts.entry_date
  )
);

CREATE POLICY admin_delete
ON public.payment_receipts
FOR DELETE TO authenticated
USING (
  handover_id IS NULL
  AND public.has_role(auth.uid(), 'admin'::app_role)
  AND NOT EXISTS (
    SELECT 1
    FROM public.day_locks dl
    WHERE dl.user_id = COALESCE(payment_receipts.received_by, payment_receipts.created_by)
      AND dl.locked_date >= payment_receipts.entry_date
  )
);

CREATE OR REPLACE FUNCTION public.guard_locked_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.handover_id IS NOT NULL OR EXISTS (
    SELECT 1
    FROM public.day_locks dl
    WHERE dl.user_id = COALESCE(OLD.received_by, OLD.created_by)
      AND dl.locked_date >= OLD.entry_date
  ) THEN
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