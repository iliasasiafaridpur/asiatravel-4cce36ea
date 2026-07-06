CREATE OR REPLACE FUNCTION public.delete_payment_receipt_and_revert(_receipt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rec public.payment_receipts%ROWTYPE;
  v_ledger public.agency_ledger%ROWTYPE;
  v_recv_col text;
  v_next_amount numeric;
  v_reverted_table text;
  v_reverted_row_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_rec
    FROM public.payment_receipts
   WHERE id = _receipt_id
     AND (
       received_by = auth.uid()
       OR created_by = auth.uid()
       OR created_by IS NULL
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found or delete permission denied';
  END IF;

  IF v_rec.handover_id IS NOT NULL THEN
    RAISE EXCEPTION 'This receipt is already inside a cash handover. Cancel/reject the handover or use the agency payment delete flow.';
  END IF;

  DELETE FROM public.payment_receipts WHERE id = v_rec.id;

  IF COALESCE(v_rec.amount, 0) > 0
     AND COALESCE(v_rec.source, '') <> 'discount'
     AND lower(COALESCE(v_rec.method, '')) <> 'discount'
     AND v_rec.service_table IS NOT NULL
     AND v_rec.service_row_id IS NOT NULL THEN

    IF v_rec.service_table = 'agency_ledger' THEN
      SELECT * INTO v_ledger
        FROM public.agency_ledger
       WHERE id = v_rec.service_row_id;

      IF FOUND THEN
        v_recv_col := CASE v_ledger.source_table
          WHEN 'tickets' THEN 'received'
          WHEN 'kuwait_visas' THEN 'received'
          WHEN 'bmet_cards' THEN 'received_amount'
          WHEN 'saudi_visas' THEN 'received_amount'
          WHEN 'others' THEN 'received_amount'
          WHEN 'extra_services' THEN 'received_amount'
          ELSE NULL
        END;

        IF v_recv_col IS NOT NULL AND v_ledger.source_id IS NOT NULL THEN
          EXECUTE format(
            'UPDATE public.%I SET %I = GREATEST(COALESCE(%I, 0) - $1, 0) WHERE id = $2 RETURNING %I',
            v_ledger.source_table, v_recv_col, v_recv_col, v_recv_col
          ) INTO v_next_amount
          USING COALESCE(v_rec.amount, 0), v_ledger.source_id;
          v_reverted_table := v_ledger.source_table;
          v_reverted_row_id := v_ledger.source_id;
        ELSE
          UPDATE public.agency_ledger
             SET received_amount = GREATEST(COALESCE(received_amount, 0) - COALESCE(v_rec.amount, 0), 0),
                 updated_at = now()
           WHERE id = v_rec.service_row_id
           RETURNING received_amount INTO v_next_amount;
          v_reverted_table := 'agency_ledger';
          v_reverted_row_id := v_rec.service_row_id;
        END IF;
      END IF;
    ELSE
      v_recv_col := CASE v_rec.service_table
        WHEN 'tickets' THEN 'received'
        WHEN 'kuwait_visas' THEN 'received'
        WHEN 'bmet_cards' THEN 'received_amount'
        WHEN 'saudi_visas' THEN 'received_amount'
        WHEN 'others' THEN 'received_amount'
        WHEN 'extra_services' THEN 'received_amount'
        ELSE NULL
      END;

      IF v_recv_col IS NOT NULL THEN
        EXECUTE format(
          'UPDATE public.%I SET %I = GREATEST(COALESCE(%I, 0) - $1, 0) WHERE id = $2 RETURNING %I',
          v_rec.service_table, v_recv_col, v_recv_col, v_recv_col
        ) INTO v_next_amount
        USING COALESCE(v_rec.amount, 0), v_rec.service_row_id;
        v_reverted_table := v_rec.service_table;
        v_reverted_row_id := v_rec.service_row_id;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'deleted_id', v_rec.id,
    'receipt_id', v_rec.receipt_id,
    'reverted_amount', COALESCE(v_rec.amount, 0),
    'service_table', v_rec.service_table,
    'service_row_id', v_rec.service_row_id,
    'reverted_table', v_reverted_table,
    'reverted_row_id', v_reverted_row_id,
    'service_received_after_delete', v_next_amount
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.delete_payment_receipt_and_revert(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_payment_receipt_and_revert(uuid) TO service_role;