CREATE OR REPLACE FUNCTION public.delete_agent_payment(
  _receipt_id uuid DEFAULT NULL::uuid,
  _ledger_row_id uuid DEFAULT NULL::uuid,
  _amount numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_rcpt public.payment_receipts%ROWTYPE;
  v_al public.agency_ledger%ROWTYPE;
  v_amt numeric := COALESCE(_amount, 0);
  v_al_id uuid := _ledger_row_id;
  v_src_table text;
  v_src_id uuid;
  v_old_handover_id uuid;
  v_is_owner boolean := false;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _receipt_id IS NOT NULL THEN
    SELECT * INTO v_rcpt FROM public.payment_receipts WHERE id = _receipt_id;
    IF NOT FOUND THEN
      RETURN;
    END IF;

    -- Owner-only delete: the receiver/creator may reverse their own payment.
    -- Legacy rows with no owner are allowed so old data remains correctable.
    v_is_owner := (v_rcpt.created_by IS NULL AND v_rcpt.received_by IS NULL)
                  OR v_rcpt.created_by = v_user
                  OR v_rcpt.received_by = v_user;
    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'Only the payment owner can delete this receipt';
    END IF;

    v_amt := COALESCE(v_rcpt.amount, 0);
    v_old_handover_id := v_rcpt.handover_id;
    IF v_rcpt.service_table = 'agency_ledger' AND v_rcpt.service_row_id IS NOT NULL THEN
      v_al_id := v_rcpt.service_row_id;
    END IF;
  END IF;

  IF v_al_id IS NULL OR v_amt <= 0 THEN
    IF _receipt_id IS NOT NULL THEN
      DELETE FROM public.payment_receipts WHERE id = _receipt_id;
      IF v_old_handover_id IS NOT NULL THEN
        PERFORM public.recompute_handover_amount(v_old_handover_id);
      END IF;
    END IF;
    RETURN;
  END IF;

  SELECT * INTO v_al FROM public.agency_ledger WHERE id = v_al_id;
  IF NOT FOUND THEN
    IF _receipt_id IS NOT NULL THEN
      DELETE FROM public.payment_receipts WHERE id = _receipt_id;
      IF v_old_handover_id IS NOT NULL THEN
        PERFORM public.recompute_handover_amount(v_old_handover_id);
      END IF;
    END IF;
    RETURN;
  END IF;

  IF _receipt_id IS NULL THEN
    v_is_owner := (v_al.created_by IS NULL AND v_al.received_by IS NULL)
                  OR v_al.created_by = v_user
                  OR v_al.received_by = v_user;
    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'Only the payment owner can delete this ledger payment';
    END IF;
  END IF;

  v_src_table := NULLIF(btrim(COALESCE(v_al.source_table, '')), '');
  v_src_id := v_al.source_id;

  -- Source-backed bill: lower the booking first. This lets sync triggers shrink
  -- the agency-ledger row while the explicit receipt deletion below removes the
  -- exact cash mirror, even if it was already locked in a handover.
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

    IF _receipt_id IS NOT NULL THEN
      DELETE FROM public.payment_receipts WHERE id = _receipt_id;
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
      DELETE FROM public.payment_receipts WHERE id = _receipt_id;
    END IF;
  END IF;

  IF v_old_handover_id IS NOT NULL THEN
    PERFORM public.recompute_handover_amount(v_old_handover_id);
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.delete_agent_payment(uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_agent_payment(uuid, uuid, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.recompute_handover_amount(h_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cash numeric;
  v_exp  numeric;
  v_net  numeric;
BEGIN
  IF h_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_cash
  FROM public.payment_receipts
  WHERE handover_id = h_id
    AND source IS DISTINCT FROM 'discount'
    AND lower(coalesce(method, '')) NOT LIKE 'discount'
    AND NOT public.is_total_agent_status_receipt(source, method, service_table, service_row_id)
    AND (coalesce(trim(method), '') = '' OR lower(trim(method)) IN ('cash', 'hand cash'));

  SELECT COALESCE(SUM(amount), 0) INTO v_exp
  FROM public.cash_expenses
  WHERE handover_id = h_id
    AND NOT (linked_source_table = 'vendor_ledger'
             AND lower(coalesce(category, '')) IN
                 ('md sir deposit', 'md deposit', 'vendor received', 'vendor receive', 'adjustment'));

  v_net := v_cash - v_exp;

  UPDATE public.cash_handovers
  SET amount = v_net,
      submitted_amount = CASE WHEN submitted_amount IS NOT NULL THEN v_net ELSE submitted_amount END
  WHERE id = h_id
    AND (amount IS DISTINCT FROM v_net
         OR (submitted_amount IS NOT NULL AND submitted_amount IS DISTINCT FROM v_net));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.recompute_handover_amount(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_handover_amount(uuid) TO service_role;