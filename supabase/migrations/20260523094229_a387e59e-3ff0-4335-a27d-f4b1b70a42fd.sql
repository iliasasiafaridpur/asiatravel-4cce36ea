CREATE OR REPLACE FUNCTION public.reject_handover(
  _handover_id uuid,
  _reason text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  UPDATE public.payment_receipts
     SET approval_status = 'rejected',
         approved_by = v_user,
         approved_at = now(),
         updated_at = now()
   WHERE handover_id = _handover_id;
END;
$$;