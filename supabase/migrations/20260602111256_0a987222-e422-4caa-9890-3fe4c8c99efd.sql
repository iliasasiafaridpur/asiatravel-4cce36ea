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

  IF v_from IS NULL AND v_status IS NULL THEN
    RAISE EXCEPTION 'Handover not found';
  END IF;

  -- Only the submitting staff, MD, or admin can cancel; and only while still pending.
  IF NOT (v_from = v_user OR public.is_md(v_user) OR public.has_role(v_user, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'You are not allowed to cancel this handover';
  END IF;

  IF COALESCE(v_status, 'pending') <> 'pending' THEN
    RAISE EXCEPTION 'Only pending handovers can be cancelled';
  END IF;

  -- Return all linked receipts back to the staff pending pool.
  UPDATE public.payment_receipts
     SET handover_id = NULL,
         approval_status = 'pending_md',
         approved_by = NULL,
         approved_at = NULL,
         updated_at = now()
   WHERE handover_id = _handover_id;

  -- Return all linked expenses back to the staff pending pool.
  UPDATE public.cash_expenses
     SET handover_id = NULL,
         updated_at = now()
   WHERE handover_id = _handover_id;

  -- Remove the cancelled handover entirely so it disappears from the queue.
  DELETE FROM public.cash_handovers WHERE id = _handover_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cancel_handover(uuid) TO authenticated;