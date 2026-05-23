
CREATE OR REPLACE FUNCTION public.get_user_account(_user_id uuid)
 RETURNS TABLE(user_id uuid, full_name text, role text, total_received numeric, total_received_today numeric, total_handed_over numeric, total_expenses numeric, current_balance numeric, total_pending numeric)
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
    WHERE from_user=_user_id AND COALESCE(status,'approved')='approved'
  ),
  exp AS (
    SELECT COALESCE(SUM(amount),0) AS total
    FROM public.cash_expenses
    WHERE spent_by=_user_id
  ),
  prof AS (
    SELECT p.full_name AS p_full_name, COALESCE(p.role,'staff') AS p_role
    FROM public.profiles p
    WHERE p.user_id=_user_id
  )
  SELECT _user_id,
         COALESCE((SELECT prof.p_full_name FROM prof),'User'),
         COALESCE((SELECT prof.p_role FROM prof),'staff'),
         (SELECT recv.total FROM recv),
         (SELECT recv.today FROM recv),
         (SELECT hand.total FROM hand),
         (SELECT exp.total FROM exp),
         COALESCE((SELECT recv.total FROM recv),0) - COALESCE((SELECT hand.total FROM hand),0) - COALESCE((SELECT exp.total FROM exp),0),
         (SELECT recv.pending FROM recv);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_accounts_overview()
 RETURNS TABLE(user_id uuid, full_name text, role text, total_received numeric, total_handed_over numeric, total_expenses numeric, current_balance numeric, total_pending numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH people AS (
    SELECT p.user_id AS p_user_id, COALESCE(p.full_name,'User') AS p_full_name, COALESCE(p.role,'staff') AS p_role
    FROM public.profiles p
    WHERE p.user_id=auth.uid()
       OR public.has_role(auth.uid(),'admin'::app_role)
       OR public.is_md(auth.uid())
  ),
  recv AS (
    SELECT received_by AS u,
           COALESCE(SUM(amount),0) AS total,
           COALESCE(SUM(amount) FILTER (WHERE approval_status='pending_md'),0) AS pending
    FROM public.payment_receipts
    WHERE COALESCE(source,'')<>'discount'
      AND lower(COALESCE(method,''))<>'discount'
    GROUP BY received_by
  ),
  hand AS (
    SELECT from_user AS u, COALESCE(SUM(amount),0) AS total
    FROM public.cash_handovers
    WHERE COALESCE(status,'approved')='approved'
    GROUP BY from_user
  ),
  exp AS (
    SELECT spent_by AS u, COALESCE(SUM(amount),0) AS total
    FROM public.cash_expenses
    GROUP BY spent_by
  )
  SELECT people.p_user_id, people.p_full_name, people.p_role,
         COALESCE(recv.total,0), COALESCE(hand.total,0), COALESCE(exp.total,0),
         COALESCE(recv.total,0) - COALESCE(hand.total,0) - COALESCE(exp.total,0),
         COALESCE(recv.pending,0)
  FROM people
  LEFT JOIN recv ON recv.u=people.p_user_id
  LEFT JOIN hand ON hand.u=people.p_user_id
  LEFT JOIN exp ON exp.u=people.p_user_id;
$function$;
