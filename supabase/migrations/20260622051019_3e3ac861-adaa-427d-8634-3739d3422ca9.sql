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
  v_method text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.cash_expenses
     WHERE linked_source_table = 'vendor_ledger' AND linked_source_id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.source_table IS NOT NULL AND length(NEW.source_table) > 0 THEN
    DELETE FROM public.cash_expenses
     WHERE linked_source_table = 'vendor_ledger' AND linked_source_id = NEW.id;
    RETURN NEW;
  END IF;

  v_method := COALESCE(NULLIF(NEW.payment_method, ''), 'Cash');

  IF lower(COALESCE(NEW.service_type, '')) = 'opening due'
     OR lower(v_method) IN ('md sir deposit', 'md deposit', 'vendor received', 'vendor receive', 'adjustment') THEN
    UPDATE public.cash_expenses
       SET category = 'Adjustment',
           remarks = concat_ws(' · ', NULLIF(remarks, ''), 'Balance-neutral vendor entry'),
           updated_at = now()
     WHERE linked_source_table = 'vendor_ledger' AND linked_source_id = NEW.id;
    RETURN NEW;
  END IF;

  v_amt := COALESCE(NEW.paid_amount, 0);
  v_user := COALESCE(NEW.created_by, NEW.received_by);

  IF v_amt <= 0 OR v_user IS NULL THEN
    UPDATE public.cash_expenses
       SET category = 'Adjustment',
           updated_at = now()
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
      category      = v_method,
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
      v_method, v_amt,
      'Vendor Payment: ' || COALESCE(NEW.vendor_name, ''),
      COALESCE(NEW.remarks, NEW.passenger_name),
      NEW.created_by, 'vendor_ledger', NEW.id
    );
  END IF;

  RETURN NEW;
END $function$;

UPDATE public.cash_expenses ce
SET category = 'Adjustment',
    remarks = concat_ws(' · ', NULLIF(ce.remarks, ''), 'Balance-neutral opening due'),
    updated_at = now()
FROM public.vendor_ledger vl
WHERE ce.linked_source_table = 'vendor_ledger'
  AND ce.linked_source_id = vl.id
  AND lower(COALESCE(vl.service_type, '')) = 'opening due';