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
    ELSIF v_rcpt.service_table IS NOT NULL AND v_rcpt.service_row_id IS NOT NULL THEN
      SELECT id INTO v_al_id
        FROM public.agency_ledger
       WHERE source_table = v_rcpt.service_table
         AND source_id = v_rcpt.service_row_id
       ORDER BY created_at ASC
       LIMIT 1;
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