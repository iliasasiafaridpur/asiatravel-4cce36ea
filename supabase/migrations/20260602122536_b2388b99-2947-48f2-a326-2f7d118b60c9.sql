CREATE OR REPLACE FUNCTION public.submit_handover(_submitted_amount numeric, _closing_date date DEFAULT CURRENT_DATE, _remarks text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_name text;
  v_id uuid;
  v_handover_id text;
  v_receipt_count integer := 0;
  v_expense_count integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF COALESCE(_submitted_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'সঠিক টাকার পরিমাণ দিন';
  END IF;

  SELECT count(*) INTO v_receipt_count
  FROM public.payment_receipts
  WHERE received_by = v_user
    AND entry_date <= _closing_date
    AND approval_status = 'pending_md'
    AND handover_id IS NULL
    AND COALESCE(source, '') <> 'discount'
    AND lower(COALESCE(method, '')) <> 'discount';

  SELECT count(*) INTO v_expense_count
  FROM public.cash_expenses
  WHERE spent_by = v_user
    AND entry_date <= _closing_date
    AND handover_id IS NULL;

  IF (v_receipt_count + v_expense_count) = 0 THEN
    RAISE EXCEPTION 'এই closing date পর্যন্ত handover করার মতো কোনো pending আয়/খরচ নেই';
  END IF;

  SELECT full_name INTO v_name
  FROM public.profiles
  WHERE user_id = v_user;

  v_handover_id := 'HND-' || to_char(_closing_date, 'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  INSERT INTO public.cash_handovers(
    handover_id, entry_date, from_user, from_name, to_name, amount, method,
    remarks, status, submitted_amount, closing_date, created_by
  ) VALUES (
    v_handover_id, _closing_date, v_user, v_name, 'MD Sir',
    _submitted_amount, 'Hand Cash',
    _remarks, 'pending', _submitted_amount, _closing_date, v_user
  ) RETURNING id INTO v_id;

  UPDATE public.payment_receipts
     SET handover_id = v_id, updated_at = now()
   WHERE received_by = v_user
     AND entry_date <= _closing_date
     AND approval_status = 'pending_md'
     AND handover_id IS NULL
     AND COALESCE(source, '') <> 'discount'
     AND lower(COALESCE(method, '')) <> 'discount';

  UPDATE public.cash_expenses
     SET handover_id = v_id, updated_at = now()
   WHERE spent_by = v_user
     AND entry_date <= _closing_date
     AND handover_id IS NULL;

  RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.submit_handover(numeric, date, text) TO authenticated;