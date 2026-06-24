CREATE OR REPLACE FUNCTION public.reject_handover(_handover_id uuid, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.is_md(v_user) OR public.has_role(v_user, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'Only MD can reject handovers';
  END IF;

  UPDATE public.cash_handovers
     SET status = 'rejected',
         approved_by = v_user,
         approved_at = now(),
         remarks = COALESCE(remarks || ' · ', '') || 'Rejected: ' || COALESCE(_reason, ''),
         updated_at = now()
   WHERE id = _handover_id;

  -- Send the batch's receipts BACK to the staff's pending pool so they can be
  -- corrected and re-submitted (status back to pending_md, unlink handover).
  UPDATE public.payment_receipts
     SET approval_status = 'pending_md',
         approved_by = NULL,
         approved_at = NULL,
         handover_id = NULL,
         updated_at = now()
   WHERE handover_id = _handover_id;

  -- CRITICAL: expenses must also be unlinked, otherwise they stay attached to
  -- the rejected handover and silently disappear from the next submission.
  UPDATE public.cash_expenses
     SET handover_id = NULL,
         updated_at = now()
   WHERE handover_id = _handover_id;
END;
$function$;