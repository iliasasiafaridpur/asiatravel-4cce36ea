-- Recompute a single handover's amount from its currently-linked receipts/expenses.
-- Mirrors the app's balance rules:
--   cash receipts (method cash/hand cash/empty, non-discount) MINUS
--   balance-hitting expenses (all except vendor_ledger neutral categories).
CREATE OR REPLACE FUNCTION public.recompute_handover_amount(h_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- Trigger wrapper: recompute affected handover(s) when a linked receipt/expense changes.
CREATE OR REPLACE FUNCTION public.sync_handover_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.handover_id IS NOT NULL THEN
    PERFORM public.recompute_handover_amount(NEW.handover_id);
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.handover_id IS NOT NULL
     AND OLD.handover_id IS DISTINCT FROM NEW.handover_id THEN
    PERFORM public.recompute_handover_amount(OLD.handover_id);
  END IF;

  IF TG_OP = 'DELETE' AND OLD.handover_id IS NOT NULL THEN
    PERFORM public.recompute_handover_amount(OLD.handover_id);
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_handover_amount_receipts ON public.payment_receipts;
CREATE TRIGGER trg_sync_handover_amount_receipts
AFTER INSERT OR UPDATE OR DELETE ON public.payment_receipts
FOR EACH ROW EXECUTE FUNCTION public.sync_handover_amount();

DROP TRIGGER IF EXISTS trg_sync_handover_amount_expenses ON public.cash_expenses;
CREATE TRIGGER trg_sync_handover_amount_expenses
AFTER INSERT OR UPDATE OR DELETE ON public.cash_expenses
FOR EACH ROW EXECUTE FUNCTION public.sync_handover_amount();

-- One-time correction of all existing handovers (only drifted rows actually change).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.cash_handovers LOOP
    PERFORM public.recompute_handover_amount(r.id);
  END LOOP;
END $$;