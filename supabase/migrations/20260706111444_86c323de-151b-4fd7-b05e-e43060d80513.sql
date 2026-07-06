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

  -- Path A: delete by a concrete payment_receipts row.
  IF _receipt_id IS NOT NULL THEN
    SELECT * INTO v_rcpt FROM public.payment_receipts WHERE id = _receipt_id;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    v_amt := COALESCE(v_rcpt.amount, 0);
    IF v_rcpt.service_table = 'agency_ledger' AND v_rcpt.service_row_id IS NOT NULL THEN
      v_al_id := v_rcpt.service_row_id;
    END IF;
    -- Remove the receipt first so the source-update trigger reconciles cleanly.
    DELETE FROM public.payment_receipts WHERE id = _receipt_id;
  END IF;

  IF v_al_id IS NULL OR v_amt <= 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_al FROM public.agency_ledger WHERE id = v_al_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_src_table := NULLIF(btrim(COALESCE(v_al.source_table, '')), '');
  v_src_id := v_al.source_id;

  IF v_src_table IS NOT NULL AND v_src_id IS NOT NULL THEN
    -- Source-backed bill: lower the booking's received amount; sync triggers
    -- then update the agency ledger, cash mirror and any handover total.
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
  ELSE
    -- Standalone agency_ledger row (opening balance / manual ADVANCE / payment).
    IF UPPER(COALESCE(v_al.service_type, '')) = 'ADVANCE'
       AND (COALESCE(v_al.received_amount, 0) - v_amt) <= 0.01 THEN
      -- The whole deposit is being reversed -> drop the row entirely.
      DELETE FROM public.agency_ledger WHERE id = v_al.id;
    ELSE
      UPDATE public.agency_ledger
         SET received_amount = GREATEST(COALESCE(received_amount, 0) - v_amt, 0),
             updated_at = now()
       WHERE id = v_al.id;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_agent_payment(uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_agent_payment(uuid, uuid, numeric) TO service_role;