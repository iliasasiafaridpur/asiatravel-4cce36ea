CREATE OR REPLACE FUNCTION public.is_total_agent_status_receipt(
  _source text,
  _method text,
  _service_table text,
  _service_row_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent text;
BEGIN
  IF NOT (
    COALESCE(_source, '') IN ('status_event', 'status_change', 'status-delivery')
    OR lower(COALESCE(_method, '')) = 'status'
  ) THEN
    RETURN false;
  END IF;

  IF _service_table IS NULL OR _service_row_id IS NULL THEN
    RETURN false;
  END IF;

  IF _service_table = 'tickets' THEN
    SELECT agency_sold INTO v_agent FROM public.tickets WHERE id = _service_row_id;
  ELSIF _service_table = 'bmet_cards' THEN
    SELECT agency_sold INTO v_agent FROM public.bmet_cards WHERE id = _service_row_id;
  ELSIF _service_table = 'saudi_visas' THEN
    SELECT agency_sold INTO v_agent FROM public.saudi_visas WHERE id = _service_row_id;
  ELSIF _service_table = 'kuwait_visas' THEN
    SELECT agency_sold INTO v_agent FROM public.kuwait_visas WHERE id = _service_row_id;
  ELSIF _service_table = 'others' THEN
    SELECT agency_sold INTO v_agent FROM public.others WHERE id = _service_row_id;
  ELSIF _service_table = 'extra_services' THEN
    SELECT agency_sold INTO v_agent FROM public.extra_services WHERE id = _service_row_id;
  ELSIF _service_table = 'agency_ledger' THEN
    SELECT agent_name INTO v_agent FROM public.agency_ledger WHERE id = _service_row_id;
  END IF;

  v_agent := btrim(COALESCE(v_agent, ''));
  IF v_agent = '' THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.agents a
     WHERE lower(btrim(a.name)) = lower(v_agent)
       AND COALESCE(a.settle_mode, 'total') = 'total'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_total_agent_status_receipt(text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_total_agent_status_receipt(text, text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_agent_payment(
  _receipt_id uuid DEFAULT NULL,
  _ledger_row_id uuid DEFAULT NULL,
  _amount numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rcpt public.payment_receipts%ROWTYPE;
  v_al public.agency_ledger%ROWTYPE;
  v_amt numeric := COALESCE(_amount, 0);
  v_al_id uuid := _ledger_row_id;
  v_src_table text;
  v_src_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _receipt_id IS NOT NULL THEN
    SELECT * INTO v_rcpt FROM public.payment_receipts WHERE id = _receipt_id;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    v_amt := COALESCE(v_rcpt.amount, 0);
    IF v_rcpt.service_table = 'agency_ledger' AND v_rcpt.service_row_id IS NOT NULL THEN
      v_al_id := v_rcpt.service_row_id;
    END IF;
  END IF;

  IF v_al_id IS NULL OR v_amt <= 0 THEN
    IF _receipt_id IS NOT NULL THEN
      DELETE FROM public.payment_receipts WHERE id = _receipt_id AND handover_id IS NULL;
    END IF;
    RETURN;
  END IF;

  SELECT * INTO v_al FROM public.agency_ledger WHERE id = v_al_id;
  IF NOT FOUND THEN
    IF _receipt_id IS NOT NULL THEN
      DELETE FROM public.payment_receipts WHERE id = _receipt_id AND handover_id IS NULL;
    END IF;
    RETURN;
  END IF;

  v_src_table := NULLIF(btrim(COALESCE(v_al.source_table, '')), '');
  v_src_id := v_al.source_id;

  -- Source-backed bill: lower the booking first. This lets sync triggers remove
  -- or shrink the pending agency-ledger cash mirror instead of recreating it.
  IF v_src_table IS NOT NULL AND v_src_id IS NOT NULL THEN
    IF v_src_table = 'tickets' THEN
      UPDATE public.tickets
         SET received = GREATEST(COALESCE(received, 0) - v_amt, 0), updated_at = now()
       WHERE id = v_src_id;
    ELSIF v_src_table = 'kuwait_visas' THEN
      UPDATE public.kuwait_visas
         SET received = GREATEST(COALESCE(received, 0) - v_amt, 0), updated_at = now()
       WHERE id = v_src_id;
    ELSIF v_src_table = 'bmet_cards' THEN
      UPDATE public.bmet_cards
         SET received_amount = GREATEST(COALESCE(received_amount, 0) - v_amt, 0), updated_at = now()
       WHERE id = v_src_id;
    ELSIF v_src_table = 'saudi_visas' THEN
      UPDATE public.saudi_visas
         SET received_amount = GREATEST(COALESCE(received_amount, 0) - v_amt, 0), updated_at = now()
       WHERE id = v_src_id;
    ELSIF v_src_table = 'others' THEN
      UPDATE public.others
         SET received_amount = GREATEST(COALESCE(received_amount, 0) - v_amt, 0), updated_at = now()
       WHERE id = v_src_id;
    ELSIF v_src_table = 'extra_services' THEN
      UPDATE public.extra_services
         SET received_amount = GREATEST(COALESCE(received_amount, 0) - v_amt, 0), updated_at = now()
       WHERE id = v_src_id;
    END IF;

    -- If the trigger did not remove this specific unlocked mirror, remove it now.
    IF _receipt_id IS NOT NULL THEN
      DELETE FROM public.payment_receipts
       WHERE id = _receipt_id
         AND handover_id IS NULL;
    END IF;
  ELSE
    -- Standalone agency_ledger row (opening balance / manual ADVANCE / payment).
    IF UPPER(COALESCE(v_al.service_type, '')) = 'ADVANCE'
       AND (COALESCE(v_al.received_amount, 0) - v_amt) <= 0.01 THEN
      DELETE FROM public.agency_ledger WHERE id = v_al.id;
    ELSE
      UPDATE public.agency_ledger
         SET received_amount = GREATEST(COALESCE(received_amount, 0) - v_amt, 0),
             updated_at = now()
       WHERE id = v_al.id;
    END IF;

    IF _receipt_id IS NOT NULL THEN
      DELETE FROM public.payment_receipts
       WHERE id = _receipt_id
         AND handover_id IS NULL;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_agent_payment(uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_agent_payment(uuid, uuid, numeric) TO service_role;

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