CREATE OR REPLACE FUNCTION public.cancel_handover(_handover_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_from uuid;
  v_status text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT from_user, status INTO v_from, v_status
  FROM public.cash_handovers
  WHERE id = _handover_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Handover not found';
  END IF;

  -- Only submitting staff, MD, or admin can cancel; and only while still pending.
  IF NOT (v_from = v_user OR public.is_md(v_user) OR public.has_role(v_user, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'You are not allowed to cancel this handover';
  END IF;

  IF COALESCE(v_status, 'pending') <> 'pending' THEN
    RAISE EXCEPTION 'Only pending handovers can be cancelled';
  END IF;

  -- Return linked receipts back to staff pending pool before deleting handover.
  UPDATE public.payment_receipts
     SET handover_id = NULL,
         approval_status = 'pending_md',
         approved_by = NULL,
         approved_at = NULL,
         updated_at = now()
   WHERE handover_id = _handover_id;

  -- Return linked expenses back to staff pending pool before deleting handover.
  UPDATE public.cash_expenses
     SET handover_id = NULL,
         updated_at = now()
   WHERE handover_id = _handover_id;

  DELETE FROM public.cash_handovers WHERE id = _handover_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_submitted_handover_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- cancel_handover() is the controlled path that first unlinks receipts/expenses.
  -- pg_trigger_depth() > 1 means this delete is happening from a trusted trigger/function flow.
  IF (OLD.submitted_amount IS NOT NULL
      OR OLD.closing_date IS NOT NULL
      OR COALESCE(OLD.status, 'approved') = 'pending')
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     AND pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'এই cash handover MD-কে submit করা হয়েছে, তাই ডিলেট করা যাবে না।';
  END IF;
  RETURN OLD;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cancel_handover(uuid) TO authenticated;