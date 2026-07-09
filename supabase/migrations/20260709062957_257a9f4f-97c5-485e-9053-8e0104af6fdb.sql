
-- Helper: initials from a name (first char of first word + first char of last word)
CREATE OR REPLACE FUNCTION public.handover_code_initials(_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_clean text;
  v_parts text[];
  v_first text;
  v_last text;
BEGIN
  v_clean := btrim(regexp_replace(COALESCE(_name, ''), '\s+', ' ', 'g'));
  IF v_clean = '' THEN
    RETURN 'XX';
  END IF;
  v_parts := string_to_array(v_clean, ' ');
  v_first := left(v_parts[1], 1);
  IF array_length(v_parts, 1) > 1 THEN
    v_last := left(v_parts[array_length(v_parts, 1)], 1);
  ELSE
    v_last := COALESCE(NULLIF(substr(v_parts[1], 2, 1), ''), v_first);
  END IF;
  RETURN upper(v_first || v_last);
END;
$$;

-- Recreate submit_handover with the new human-readable handover code
CREATE OR REPLACE FUNCTION public.submit_handover(_submitted_amount numeric, _closing_date date DEFAULT CURRENT_DATE, _remarks text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_name text;
  v_id uuid;
  v_handover_id text;
  v_receipt_count integer := 0;
  v_expense_count integer := 0;
  v_serial integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _submitted_amount IS NULL OR _submitted_amount < 0 THEN
    RAISE EXCEPTION 'সঠিক টাকার পরিমাণ দিন';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('submit_handover:' || v_user::text));

  SELECT count(*) INTO v_receipt_count
  FROM public.payment_receipts
  WHERE received_by = v_user
    AND entry_date <= _closing_date
    AND approval_status = 'pending_md'
    AND handover_id IS NULL
    AND COALESCE(source, '') <> 'discount'
    AND lower(COALESCE(method, '')) <> 'discount'
    AND NOT public.is_total_agent_status_receipt(source, method, service_table, service_row_id);

  SELECT count(*) INTO v_expense_count
  FROM public.cash_expenses
  WHERE spent_by = v_user
    AND entry_date <= _closing_date
    AND handover_id IS NULL
    AND NOT (
      linked_source_table = 'vendor_ledger'
      AND lower(COALESCE(category, '')) IN ('md sir deposit', 'md deposit', 'vendor received', 'vendor receive', 'adjustment')
    );

  IF (v_receipt_count + v_expense_count) = 0 THEN
    RAISE EXCEPTION 'এই closing date পর্যন্ত handover করার মতো কোনো pending আয়/খরচ নেই';
  END IF;

  SELECT full_name INTO v_name
  FROM public.profiles
  WHERE user_id = v_user;

  -- Serial for this user within the closing_date month
  SELECT count(*) INTO v_serial
  FROM public.cash_handovers
  WHERE from_user = v_user
    AND to_char(COALESCE(closing_date, entry_date), 'YYYYMM') = to_char(_closing_date, 'YYYYMM');
  v_serial := v_serial + 1;

  v_handover_id := 'HND-' || public.handover_code_initials(COALESCE(v_name, 'User'))
                   || '/' || to_char(_closing_date, 'YYYY-MM')
                   || '/' || lpad(v_serial::text, 2, '0');

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
     AND lower(COALESCE(method, '')) <> 'discount'
     AND NOT public.is_total_agent_status_receipt(source, method, service_table, service_row_id);

  UPDATE public.cash_expenses
     SET handover_id = v_id, updated_at = now()
   WHERE spent_by = v_user
     AND entry_date <= _closing_date
     AND handover_id IS NULL
     AND NOT (
       linked_source_table = 'vendor_ledger'
       AND lower(COALESCE(category, '')) IN ('md sir deposit', 'md deposit', 'vendor received', 'vendor receive', 'adjustment')
     );

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_handover(numeric, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_handover(numeric, date, text) TO service_role;

-- Backfill existing handovers to the new format
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY from_user, to_char(COALESCE(closing_date, entry_date), 'YYYYMM')
           ORDER BY created_at, id
         ) AS rn
  FROM public.cash_handovers
)
UPDATE public.cash_handovers ch
SET handover_id = 'HND-' || public.handover_code_initials(ch.from_name)
                  || '/' || to_char(COALESCE(ch.closing_date, ch.entry_date), 'YYYY-MM')
                  || '/' || lpad(ranked.rn::text, 2, '0')
FROM ranked
WHERE ch.id = ranked.id;
