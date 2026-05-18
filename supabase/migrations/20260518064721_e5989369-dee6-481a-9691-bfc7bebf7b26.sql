-- Skip auto-synced ledger rows (those tied to a source service table)
-- because sync_service_receipt already creates the corresponding cash entry.

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

  -- Skip rows auto-synced from a service table (booking entry handles cash itself)
  IF NEW.source_table IS NOT NULL AND length(NEW.source_table) > 0 THEN
    RETURN NEW;
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

  -- Skip rows auto-synced from a service table (booking entry creates the cash receipt itself)
  IF NEW.source_table IS NOT NULL AND length(NEW.source_table) > 0 THEN
    RETURN NEW;
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

-- Clean up any duplicate cash entries created by the first version of the trigger
-- for service-table-sourced ledger rows.
DELETE FROM public.cash_expenses ce
 WHERE ce.linked_source_table = 'vendor_ledger'
   AND EXISTS (
     SELECT 1 FROM public.vendor_ledger vl
      WHERE vl.id = ce.linked_source_id
        AND vl.source_table IS NOT NULL
   );

DELETE FROM public.payment_receipts pr
 WHERE pr.source = 'agency_ledger'
   AND pr.service_table = 'agency_ledger'
   AND EXISTS (
     SELECT 1 FROM public.agency_ledger al
      WHERE al.id = pr.service_row_id
        AND al.source_table IS NOT NULL
   );
