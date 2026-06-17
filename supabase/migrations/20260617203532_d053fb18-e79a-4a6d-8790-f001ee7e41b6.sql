-- 1) passengers: track creator + default to current user
ALTER TABLE public.passengers ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.passengers ALTER COLUMN created_by SET DEFAULT auth.uid();

-- 2) Owner-based DELETE policies on operational tables.
-- Legacy rows with NULL created_by remain deletable so they don't get stuck.

-- tickets
DROP POLICY IF EXISTS admin_delete ON public.tickets;
CREATE POLICY owner_delete ON public.tickets FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR created_by IS NULL);

-- bmet_cards
DROP POLICY IF EXISTS admin_delete ON public.bmet_cards;
CREATE POLICY owner_delete ON public.bmet_cards FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR created_by IS NULL);

-- saudi_visas
DROP POLICY IF EXISTS admin_delete ON public.saudi_visas;
CREATE POLICY owner_delete ON public.saudi_visas FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR created_by IS NULL);

-- kuwait_visas
DROP POLICY IF EXISTS admin_delete ON public.kuwait_visas;
CREATE POLICY owner_delete ON public.kuwait_visas FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR created_by IS NULL);

-- others
DROP POLICY IF EXISTS admin_delete ON public.others;
CREATE POLICY owner_delete ON public.others FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR created_by IS NULL);

-- extra_services
DROP POLICY IF EXISTS auth_delete ON public.extra_services;
CREATE POLICY owner_delete ON public.extra_services FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR created_by IS NULL);

-- agency_ledger
DROP POLICY IF EXISTS admin_delete ON public.agency_ledger;
CREATE POLICY owner_delete ON public.agency_ledger FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR created_by IS NULL);

-- vendor_ledger
DROP POLICY IF EXISTS admin_delete ON public.vendor_ledger;
CREATE POLICY owner_delete ON public.vendor_ledger FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR created_by IS NULL);

-- payment_receipts
DROP POLICY IF EXISTS auth_delete_receipts ON public.payment_receipts;
CREATE POLICY owner_delete ON public.payment_receipts FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR received_by = auth.uid() OR created_by IS NULL);

-- cash_handovers
DROP POLICY IF EXISTS auth_delete_handovers ON public.cash_handovers;
CREATE POLICY owner_delete ON public.cash_handovers FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR from_user = auth.uid() OR created_by IS NULL);

-- cash_expenses
DROP POLICY IF EXISTS auth_delete_expenses ON public.cash_expenses;
CREATE POLICY owner_delete ON public.cash_expenses FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR spent_by = auth.uid() OR created_by IS NULL);

-- fund_transfers
DROP POLICY IF EXISTS admin_delete_fund_transfers ON public.fund_transfers;
CREATE POLICY owner_delete ON public.fund_transfers FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR created_by IS NULL);

-- passengers (Action Board)
DROP POLICY IF EXISTS admin_delete ON public.passengers;
CREATE POLICY owner_delete ON public.passengers FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR created_by IS NULL);

-- 3) Owner-only receipt deletion RPC (no admin/MD cross-user override).
CREATE OR REPLACE FUNCTION public.delete_payment_receipt_and_revert(_receipt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rec public.payment_receipts%ROWTYPE;
  v_recv_col text;
  v_next_amount numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM public.payment_receipts
   WHERE id = _receipt_id
     AND (
       received_by = auth.uid()
       OR created_by = auth.uid()
       OR created_by IS NULL
     )
   RETURNING * INTO v_rec;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found or delete permission denied';
  END IF;

  IF COALESCE(v_rec.amount, 0) > 0
     AND COALESCE(v_rec.source, '') <> 'discount'
     AND lower(COALESCE(v_rec.method, '')) <> 'discount'
     AND v_rec.service_table IS NOT NULL
     AND v_rec.service_row_id IS NOT NULL THEN

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
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'deleted_id', v_rec.id,
    'receipt_id', v_rec.receipt_id,
    'reverted_amount', COALESCE(v_rec.amount, 0),
    'service_table', v_rec.service_table,
    'service_row_id', v_rec.service_row_id,
    'service_received_after_delete', v_next_amount
  );
END;
$function$;