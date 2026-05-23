-- Ensure staff drawer balance counts money physically received, even before MD approval.
CREATE OR REPLACE FUNCTION public.get_user_account(_user_id uuid)
 RETURNS TABLE(
  user_id uuid,
  full_name text,
  role text,
  total_received numeric,
  total_received_today numeric,
  total_handed_over numeric,
  total_expenses numeric,
  current_balance numeric,
  total_pending numeric
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF auth.uid() <> _user_id
     AND NOT public.has_role(auth.uid(),'admin'::app_role)
     AND NOT public.is_md(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  WITH recv AS (
    SELECT COALESCE(SUM(amount),0) AS total,
           COALESCE(SUM(amount) FILTER (WHERE entry_date=CURRENT_DATE),0) AS today,
           COALESCE(SUM(amount) FILTER (WHERE approval_status='pending_md'),0) AS pending
    FROM public.payment_receipts
    WHERE received_by=_user_id
      AND COALESCE(source,'')<>'discount'
      AND lower(COALESCE(method,''))<>'discount'
  ),
  hand AS (
    SELECT COALESCE(SUM(amount),0) AS total
    FROM public.cash_handovers
    WHERE from_user=_user_id AND COALESCE(status,'approved')<>'rejected'
  ),
  exp AS (
    SELECT COALESCE(SUM(amount),0) AS total
    FROM public.cash_expenses
    WHERE spent_by=_user_id
  ),
  prof AS (
    SELECT p.full_name, COALESCE(p.role,'staff') AS role
    FROM public.profiles p
    WHERE p.user_id=_user_id
  )
  SELECT _user_id,
         COALESCE((SELECT full_name FROM prof),'User'),
         COALESCE((SELECT role FROM prof),'staff'),
         (SELECT total FROM recv),
         (SELECT today FROM recv),
         (SELECT total FROM hand),
         (SELECT total FROM exp),
         (SELECT total FROM recv) - (SELECT total FROM hand) - (SELECT total FROM exp),
         (SELECT pending FROM recv);
END
$function$;

CREATE OR REPLACE FUNCTION public.get_accounts_overview()
 RETURNS TABLE(
  user_id uuid,
  full_name text,
  role text,
  total_received numeric,
  total_handed_over numeric,
  total_expenses numeric,
  current_balance numeric,
  total_pending numeric
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH people AS (
    SELECT p.user_id, COALESCE(p.full_name,'User') AS full_name, COALESCE(p.role,'staff') AS role
    FROM public.profiles p
    WHERE p.user_id=auth.uid()
       OR public.has_role(auth.uid(),'admin'::app_role)
       OR public.is_md(auth.uid())
  ),
  recv AS (
    SELECT received_by AS user_id,
           COALESCE(SUM(amount),0) AS total,
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
    FROM public.cash_expenses
    GROUP BY spent_by
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
$function$;

-- Approval assignment: only MD receipts bypass approval. Staff receipts wait for MD.
CREATE OR REPLACE FUNCTION public.set_receipt_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.received_by IS NOT NULL AND public.is_md(NEW.received_by) THEN
    NEW.approval_status := 'auto_approved';
    NEW.approved_by := NEW.received_by;
    NEW.approved_at := now();
  ELSE
    NEW.approval_status := 'pending_md';
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
  END IF;
  RETURN NEW;
END
$function$;

ALTER TABLE public.payment_receipts
  ALTER COLUMN approval_status SET DEFAULT 'pending_md';

DROP TRIGGER IF EXISTS trg_set_receipt_approval ON public.payment_receipts;
CREATE TRIGGER trg_set_receipt_approval
BEFORE INSERT ON public.payment_receipts
FOR EACH ROW
EXECUTE FUNCTION public.set_receipt_approval();

-- Correct existing unhanded staff receipts that were marked auto-approved by earlier broad backfill.
UPDATE public.payment_receipts pr
SET approval_status = 'pending_md',
    approved_by = NULL,
    approved_at = NULL,
    updated_at = now()
FROM public.profiles p
WHERE pr.received_by = p.user_id
  AND COALESCE(p.role, 'staff') = 'staff'
  AND pr.handover_id IS NULL
  AND pr.approval_status = 'auto_approved';