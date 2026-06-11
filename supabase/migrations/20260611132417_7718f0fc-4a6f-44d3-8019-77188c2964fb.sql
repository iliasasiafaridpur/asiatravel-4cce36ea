-- Prevent duplicate status/delivery notification rows for the same receiver + service + status.
CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_status_event_dedupe
ON public.payment_receipts (
  received_by,
  service_table,
  service_row_id,
  lower(btrim(regexp_replace(COALESCE(remarks, ''), '^\s*status\s*:\s*', '', 'i')))
)
WHERE (
  source IN ('status_event', 'status_change', 'status-delivery')
  OR lower(COALESCE(method, '')) = 'status'
);

-- Hide any empty pending handover accidentally created by double-submit/race conditions.
UPDATE public.cash_handovers ch
   SET status = 'cancelled',
       remarks = COALESCE(ch.remarks || ' · ', '') || 'System cleanup: empty pending handover',
       updated_at = now()
 WHERE COALESCE(ch.status, 'pending') = 'pending'
   AND NOT EXISTS (SELECT 1 FROM public.payment_receipts pr WHERE pr.handover_id = ch.id)
   AND NOT EXISTS (SELECT 1 FROM public.cash_expenses ce WHERE ce.handover_id = ch.id);

-- Make Submit to MD atomic per user so rapid/double clicks cannot create duplicate handovers.
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

  IF _submitted_amount IS NULL OR _submitted_amount < 0 THEN
    RAISE EXCEPTION 'সঠিক টাকার পরিমাণ দিন';
  END IF;

  -- One active submit per user inside this transaction.
  PERFORM pg_advisory_xact_lock(hashtext('submit_handover:' || v_user::text));

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
    v_handover_id, _closing_date, v_user, COALESCE(v_name, 'User'), 'Kaium Khan (MD)',
    COALESCE(_submitted_amount, 0), 'Hand Cash',
    _remarks, 'pending', COALESCE(_submitted_amount, 0), _closing_date, v_user
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