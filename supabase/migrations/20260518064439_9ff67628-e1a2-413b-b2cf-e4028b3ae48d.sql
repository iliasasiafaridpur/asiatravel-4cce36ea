-- ============================================================
-- Double-Entry Ledger Linking: Vendor/Agent ledgers ↔ Cash Accounts
-- ============================================================

-- 1. Add payment_method to ledgers (defaults to Cash for legacy rows)
ALTER TABLE public.vendor_ledger
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'Cash';

ALTER TABLE public.agency_ledger
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'Cash';

-- 2. Add linkage columns on cash_expenses so vendor_ledger rows can own a cash_expenses row
ALTER TABLE public.cash_expenses
  ADD COLUMN IF NOT EXISTS linked_source_table text,
  ADD COLUMN IF NOT EXISTS linked_source_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_cash_expenses_linked
  ON public.cash_expenses(linked_source_table, linked_source_id)
  WHERE linked_source_id IS NOT NULL;

-- payment_receipts already has service_table / service_row_id — reuse with service_table='agency_ledger'.
-- Ensure uniqueness for the agency_ledger linkage so upserts work.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_receipts_agency_ledger
  ON public.payment_receipts(service_table, service_row_id)
  WHERE source = 'agency_ledger';

-- ============================================================
-- 3. Trigger: vendor_ledger.paid_amount → cash_expenses (Money Outflow)
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_vendor_payment_to_cash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_user_name text;
  v_expense_id text;
  v_amt numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.cash_expenses
     WHERE linked_source_table = 'vendor_ledger' AND linked_source_id = OLD.id;
    RETURN OLD;
  END IF;

  v_amt := COALESCE(NEW.paid_amount, 0);
  v_user := COALESCE(NEW.created_by, NEW.received_by);

  IF v_amt <= 0 OR v_user IS NULL THEN
    DELETE FROM public.cash_expenses
     WHERE linked_source_table = 'vendor_ledger' AND linked_source_id = NEW.id;
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_user_name FROM public.profiles WHERE user_id = v_user;

  IF EXISTS (SELECT 1 FROM public.cash_expenses
              WHERE linked_source_table = 'vendor_ledger' AND linked_source_id = NEW.id) THEN
    UPDATE public.cash_expenses SET
      entry_date    = NEW.entry_date,
      spent_by      = v_user,
      spent_by_name = v_user_name,
      category      = COALESCE(NEW.payment_method, 'Cash'),
      amount        = v_amt,
      purpose       = 'Vendor Payment: ' || COALESCE(NEW.vendor_name, ''),
      remarks       = COALESCE(NEW.remarks, NEW.passenger_name),
      updated_at    = now()
    WHERE linked_source_table = 'vendor_ledger' AND linked_source_id = NEW.id;
  ELSE
    v_expense_id := public.next_module_id('EXP', 'cash_expenses', 'expense_id');
    INSERT INTO public.cash_expenses (
      expense_id, entry_date, spent_by, spent_by_name, category, amount,
      purpose, remarks, created_by, linked_source_table, linked_source_id
    ) VALUES (
      v_expense_id, NEW.entry_date, v_user, v_user_name,
      COALESCE(NEW.payment_method, 'Cash'), v_amt,
      'Vendor Payment: ' || COALESCE(NEW.vendor_name, ''),
      COALESCE(NEW.remarks, NEW.passenger_name),
      NEW.created_by, 'vendor_ledger', NEW.id
    );
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_vendor_payment_to_cash ON public.vendor_ledger;
CREATE TRIGGER trg_sync_vendor_payment_to_cash
AFTER INSERT OR UPDATE OF paid_amount, payment_method, entry_date, vendor_name, remarks, created_by OR DELETE
ON public.vendor_ledger
FOR EACH ROW EXECUTE FUNCTION public.sync_vendor_payment_to_cash();

-- ============================================================
-- 4. Trigger: agency_ledger.received_amount → payment_receipts (Money Inflow)
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_agent_receipt_to_cash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_user_name text;
  v_receipt_id text;
  v_amt numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.payment_receipts
     WHERE source = 'agency_ledger' AND service_table = 'agency_ledger' AND service_row_id = OLD.id;
    RETURN OLD;
  END IF;

  v_amt := COALESCE(NEW.received_amount, 0);
  v_user := COALESCE(NEW.received_by, NEW.created_by);

  IF v_amt <= 0 OR v_user IS NULL THEN
    DELETE FROM public.payment_receipts
     WHERE source = 'agency_ledger' AND service_table = 'agency_ledger' AND service_row_id = NEW.id;
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_user_name FROM public.profiles WHERE user_id = v_user;

  IF EXISTS (SELECT 1 FROM public.payment_receipts
              WHERE source = 'agency_ledger' AND service_table = 'agency_ledger' AND service_row_id = NEW.id) THEN
    UPDATE public.payment_receipts SET
      entry_date       = NEW.entry_date,
      service_type     = 'Agent Receipt: ' || COALESCE(NEW.agent_name, ''),
      ref_id           = NEW.ledger_id,
      passenger_name   = COALESCE(NEW.passenger_name, NEW.agent_name, ''),
      received_by      = v_user,
      received_by_name = v_user_name,
      amount           = v_amt,
      method           = COALESCE(NEW.payment_method, 'Cash'),
      remarks          = NEW.remarks,
      updated_at       = now()
    WHERE source = 'agency_ledger' AND service_table = 'agency_ledger' AND service_row_id = NEW.id;
  ELSE
    v_receipt_id := 'AGL-' || to_char(CURRENT_DATE, 'YYYYMM') || '-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 8));
    INSERT INTO public.payment_receipts (
      receipt_id, entry_date, service_type, service_table, service_row_id, ref_id,
      passenger_name, received_by, received_by_name, amount, method, source, remarks, created_by
    ) VALUES (
      v_receipt_id, NEW.entry_date,
      'Agent Receipt: ' || COALESCE(NEW.agent_name, ''),
      'agency_ledger', NEW.id, NEW.ledger_id,
      COALESCE(NEW.passenger_name, NEW.agent_name, ''),
      v_user, v_user_name, v_amt,
      COALESCE(NEW.payment_method, 'Cash'), 'agency_ledger',
      NEW.remarks, NEW.created_by
    );
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_agent_receipt_to_cash ON public.agency_ledger;
CREATE TRIGGER trg_sync_agent_receipt_to_cash
AFTER INSERT OR UPDATE OF received_amount, payment_method, entry_date, agent_name, remarks, received_by, created_by OR DELETE
ON public.agency_ledger
FOR EACH ROW EXECUTE FUNCTION public.sync_agent_receipt_to_cash();

-- ============================================================
-- 5. Backfill existing rows so balances reconcile right away
-- ============================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.vendor_ledger WHERE COALESCE(paid_amount,0) > 0 LOOP
    UPDATE public.vendor_ledger SET updated_at = now() WHERE id = r.id;
  END LOOP;
  FOR r IN SELECT id FROM public.agency_ledger WHERE COALESCE(received_amount,0) > 0 LOOP
    UPDATE public.agency_ledger SET updated_at = now() WHERE id = r.id;
  END LOOP;
END $$;
