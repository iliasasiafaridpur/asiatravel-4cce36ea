CREATE OR REPLACE FUNCTION public.guard_locked_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE'
     AND OLD.handover_id IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Submitted handover receipt cannot be deleted';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_submitted_expense_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.handover_id IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Submitted handover expense cannot be deleted';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_handover(_handover_id uuid, _confirmed_amount numeric)
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

  IF NOT (public.is_md(v_user) OR public.has_role(v_user,'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Only MD can approve handovers';
  END IF;

  UPDATE public.cash_handovers
     SET status='approved',
         confirmed_amount=COALESCE(_confirmed_amount, submitted_amount, amount),
         amount=COALESCE(_confirmed_amount, submitted_amount, amount),
         approved_by=v_user,
         approved_at=now(),
         updated_at=now()
   WHERE id=_handover_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Handover not found';
  END IF;

  UPDATE public.payment_receipts
     SET approval_status='approved',
         approved_by=v_user,
         approved_at=now(),
         updated_at=now()
   WHERE handover_id=_handover_id;
END;
$function$;