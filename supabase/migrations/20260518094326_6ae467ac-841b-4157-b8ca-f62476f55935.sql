-- Add payment_date column to all service tables
ALTER TABLE public.tickets      ADD COLUMN IF NOT EXISTS payment_date date;
ALTER TABLE public.bmet_cards   ADD COLUMN IF NOT EXISTS payment_date date;
ALTER TABLE public.saudi_visas  ADD COLUMN IF NOT EXISTS payment_date date;
ALTER TABLE public.kuwait_visas ADD COLUMN IF NOT EXISTS payment_date date;

-- Add payment_date to ledger rows so manual receipts/payments can be dated separately
ALTER TABLE public.agency_ledger ADD COLUMN IF NOT EXISTS payment_date date;
ALTER TABLE public.vendor_ledger ADD COLUMN IF NOT EXISTS payment_date date;

-- Update sync_service_receipt: cash receipt entry_date follows payment_date when set
CREATE OR REPLACE FUNCTION public.sync_service_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  amt numeric;
  ref text;
  pname text;
  svc text;
  receiver uuid;
  receiver_name text;
  rid text;
  pay_date date;
BEGIN
  IF TG_TABLE_NAME = 'tickets' THEN
    amt := COALESCE(NEW.received, 0); ref := NEW.ticket_id; svc := 'AIR TICKET';
  ELSIF TG_TABLE_NAME = 'bmet_cards' THEN
    amt := COALESCE(NEW.received_amount, 0); ref := NEW.bmet_id; svc := 'BMET';
  ELSIF TG_TABLE_NAME = 'saudi_visas' THEN
    amt := COALESCE(NEW.received_amount, 0); ref := NEW.saudi_id; svc := 'Saudi Visa';
  ELSIF TG_TABLE_NAME = 'kuwait_visas' THEN
    amt := COALESCE(NEW.received, 0); ref := NEW.kuwait_id; svc := 'Kuwait Visa';
  ELSE
    RETURN NEW;
  END IF;

  pname := NEW.passenger_name;
  receiver := COALESCE(NEW.received_by, NEW.created_by);
  IF receiver IS NULL THEN RETURN NEW; END IF;

  SELECT full_name INTO receiver_name FROM public.profiles WHERE user_id = receiver;

  IF amt <= 0 THEN
    DELETE FROM public.payment_receipts
     WHERE service_table = TG_TABLE_NAME AND service_row_id = NEW.id AND source = 'service_form';
    RETURN NEW;
  END IF;

  pay_date := COALESCE(NEW.payment_date, NEW.entry_date, CURRENT_DATE);
  rid := 'RCV-' || to_char(pay_date, 'YYYYMM') || '-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 8));

  INSERT INTO public.payment_receipts (
    receipt_id, entry_date, service_type, service_table, service_row_id, ref_id,
    passenger_name, received_by, received_by_name, amount, method, source, created_by
  ) VALUES (
    rid, pay_date, svc, TG_TABLE_NAME, NEW.id, ref,
    COALESCE(pname, ''), receiver, receiver_name, amt, 'Cash', 'service_form', NEW.created_by
  )
  ON CONFLICT (service_table, service_row_id) WHERE source = 'service_form'
  DO UPDATE SET
    entry_date = EXCLUDED.entry_date,
    service_type = EXCLUDED.service_type,
    ref_id = EXCLUDED.ref_id,
    passenger_name = EXCLUDED.passenger_name,
    received_by = EXCLUDED.received_by,
    received_by_name = EXCLUDED.received_by_name,
    amount = EXCLUDED.amount,
    updated_at = now();

  RETURN NEW;
END;
$function$;

-- Update sync_vendor_payment_to_cash to honor payment_date on the ledger row
CREATE OR REPLACE FUNCTION public.sync_vendor_payment_to_cash()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid;
  v_user_name text;
  v_expense_id text;
  v_amt numeric;
  v_date date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.cash_expenses
     WHERE linked_source_table = 'vendor_ledger' AND linked_source_id = OLD.id;
    RETURN OLD;
  END IF;

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
  v_date := COALESCE(NEW.payment_date, NEW.entry_date, CURRENT_DATE);

  IF EXISTS (SELECT 1 FROM public.cash_expenses
              WHERE linked_source_table = 'vendor_ledger' AND linked_source_id = NEW.id) THEN
    UPDATE public.cash_expenses SET
      entry_date    = v_date,
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
      v_expense_id, v_date, v_user, v_user_name,
      COALESCE(NEW.payment_method, 'Cash'), v_amt,
      'Vendor Payment: ' || COALESCE(NEW.vendor_name, ''),
      COALESCE(NEW.remarks, NEW.passenger_name),
      NEW.created_by, 'vendor_ledger', NEW.id
    );
  END IF;

  RETURN NEW;
END $function$;

-- Update sync_agent_receipt_to_cash to honor payment_date on the ledger row
CREATE OR REPLACE FUNCTION public.sync_agent_receipt_to_cash()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid;
  v_user_name text;
  v_receipt_id text;
  v_amt numeric;
  v_date date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.payment_receipts
     WHERE source = 'agency_ledger' AND service_table = 'agency_ledger' AND service_row_id = OLD.id;
    RETURN OLD;
  END IF;

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
  v_date := COALESCE(NEW.payment_date, NEW.entry_date, CURRENT_DATE);

  IF EXISTS (SELECT 1 FROM public.payment_receipts
              WHERE source = 'agency_ledger' AND service_table = 'agency_ledger' AND service_row_id = NEW.id) THEN
    UPDATE public.payment_receipts SET
      entry_date       = v_date,
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
    v_receipt_id := 'AGL-' || to_char(v_date, 'YYYYMM') || '-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 8));
    INSERT INTO public.payment_receipts (
      receipt_id, entry_date, service_type, service_table, service_row_id, ref_id,
      passenger_name, received_by, received_by_name, amount, method, source, remarks, created_by
    ) VALUES (
      v_receipt_id, v_date,
      'Agent Receipt: ' || COALESCE(NEW.agent_name, ''),
      'agency_ledger', NEW.id, NEW.ledger_id,
      COALESCE(NEW.passenger_name, NEW.agent_name, ''),
      v_user, v_user_name, v_amt,
      COALESCE(NEW.payment_method, 'Cash'), 'agency_ledger',
      NEW.remarks, NEW.created_by
    );
  END IF;

  RETURN NEW;
END $function$;