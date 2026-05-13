CREATE OR REPLACE FUNCTION public.get_user_account(_user_id uuid)
 RETURNS TABLE(user_id uuid, full_name text, total_received numeric, total_received_today numeric, total_handed_over numeric, total_expenses numeric, current_balance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF auth.uid() <> _user_id AND NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY
  WITH recv AS (
    SELECT COALESCE(SUM(pr.amount),0) AS total,
           COALESCE(SUM(pr.amount) FILTER (WHERE pr.entry_date = CURRENT_DATE),0) AS today
    FROM public.payment_receipts pr WHERE pr.received_by = _user_id
  ),
  hand AS (SELECT COALESCE(SUM(ch.amount),0) AS total FROM public.cash_handovers ch WHERE ch.from_user = _user_id),
  exp  AS (SELECT COALESCE(SUM(ce.amount),0) AS total FROM public.cash_expenses ce WHERE ce.spent_by = _user_id),
  prof AS (SELECT p.full_name AS pname FROM public.profiles p WHERE p.user_id = _user_id)
  SELECT _user_id,
         COALESCE((SELECT prof.pname FROM prof), 'User'),
         (SELECT recv.total FROM recv),
         (SELECT recv.today FROM recv),
         (SELECT hand.total FROM hand),
         (SELECT exp.total FROM exp),
         (SELECT recv.total FROM recv) - (SELECT hand.total FROM hand) - (SELECT exp.total FROM exp);
END $function$;