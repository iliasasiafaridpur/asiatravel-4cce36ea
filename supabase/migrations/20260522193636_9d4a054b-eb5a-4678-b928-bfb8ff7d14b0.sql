-- Remove any past "Discount" rows that were incorrectly recorded as cash receipts
DELETE FROM public.payment_receipts
 WHERE source = 'discount' OR lower(COALESCE(method,'')) = 'discount';

-- Update get_user_account so Discount adjustments never inflate cash totals
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
    FROM public.payment_receipts pr
    WHERE pr.received_by = _user_id
      AND COALESCE(pr.source,'') <> 'discount'
      AND lower(COALESCE(pr.method,'')) <> 'discount'
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

-- Same exclusion in the accounts overview (admin view)
CREATE OR REPLACE FUNCTION public.get_accounts_overview()
 RETURNS TABLE(user_id uuid, full_name text, total_received numeric, total_handed_over numeric, total_expenses numeric, current_balance numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH people AS (
    SELECT p.user_id, COALESCE(p.full_name, 'User') AS full_name
    FROM public.profiles p
    WHERE p.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')
  ), recv AS (
    SELECT received_by AS user_id, SUM(amount) AS total
      FROM public.payment_receipts
      WHERE COALESCE(source,'') <> 'discount'
        AND lower(COALESCE(method,'')) <> 'discount'
      GROUP BY received_by
  ), hand AS (
    SELECT from_user AS user_id, SUM(amount) AS total FROM public.cash_handovers GROUP BY from_user
  ), exp AS (
    SELECT spent_by AS user_id, SUM(amount) AS total FROM public.cash_expenses GROUP BY spent_by
  ), summary AS (
    SELECT people.user_id, people.full_name,
           COALESCE(recv.total,0) AS total_received,
           COALESCE(hand.total,0) AS total_handed_over,
           COALESCE(exp.total,0) AS total_expenses,
           COALESCE(recv.total,0) - COALESCE(hand.total,0) - COALESCE(exp.total,0) AS current_balance
    FROM people
    LEFT JOIN recv ON recv.user_id = people.user_id
    LEFT JOIN hand ON hand.user_id = people.user_id
    LEFT JOIN exp ON exp.user_id = people.user_id
  )
  SELECT * FROM summary ORDER BY summary.current_balance DESC, summary.full_name ASC;
$function$;