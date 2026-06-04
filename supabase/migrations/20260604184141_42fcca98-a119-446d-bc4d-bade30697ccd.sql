-- 1) Agency/service mirror receipt: date it by the day it is recorded (today),
--    and never disturb a receipt that is already locked into a handover.
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
  v_date date;
  v_source text;
  v_has_direct_receipt boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.payment_receipts
     WHERE service_table = 'agency_ledger'
       AND service_row_id = OLD.id
       AND source IN ('agency_ledger', 'agency_ledger_payment');
    RETURN OLD;
  END IF;

  v_amt := COALESCE(NEW.received_amount, 0);
  v_user := COALESCE(NEW.received_by, NEW.created_by);
  -- Receipt is dated when it is recorded in the software (business rule),
  -- not by a possibly-stale payment/booking date.
  v_date := CURRENT_DATE;
  v_source := CASE
    WHEN NEW.source_table IS NOT NULL AND length(NEW.source_table) > 0 THEN 'agency_ledger_payment'
    ELSE 'agency_ledger'
  END;

  IF v_source = 'agency_ledger_payment' THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.payment_receipts pr
       WHERE pr.service_table = NEW.source_table
         AND pr.service_row_id = NEW.source_id
         AND pr.source NOT IN ('discount', 'agency_ledger_payment', 'agency_ledger')
         AND lower(COALESCE(pr.method, '')) <> 'discount'
    ) INTO v_has_direct_receipt;

    IF v_has_direct_receipt THEN
      DELETE FROM public.payment_receipts
       WHERE service_table = 'agency_ledger'
         AND service_row_id = NEW.id
         AND source = 'agency_ledger_payment';
      RETURN NEW;
    END IF;
  END IF;

  IF v_amt <= 0 OR v_user IS NULL THEN
    DELETE FROM public.payment_receipts
     WHERE service_table = 'agency_ledger'
       AND service_row_id = NEW.id
       AND source IN ('agency_ledger', 'agency_ledger_payment');
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_user_name FROM public.profiles WHERE user_id = v_user;
  v_receipt_id := 'AGL-' || to_char(v_date, 'YYYYMM') || '-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 8));

  INSERT INTO public.payment_receipts (
    receipt_id, entry_date, service_type, service_table, service_row_id, ref_id,
    passenger_name, received_by, received_by_name, amount, method, source, remarks, created_by
  ) VALUES (
    v_receipt_id, v_date,
    CASE
      WHEN v_source = 'agency_ledger_payment' THEN 'Service Receipt: ' || COALESCE(NEW.agent_name, '')
      ELSE 'Agent Receipt: ' || COALESCE(NEW.agent_name, '')
    END,
    'agency_ledger', NEW.id, NEW.ledger_id,
    COALESCE(NEW.passenger_name, NEW.agent_name, ''),
    v_user, v_user_name, v_amt,
    COALESCE(NULLIF(NEW.payment_method, ''), 'Cash'), v_source,
    concat_ws(' · ',
      CASE
        WHEN v_source = 'agency_ledger_payment'
        THEN 'সার্ভিস/কাস্টমার পেমেন্ট রিসিভ'
        ELSE 'Customer/Sub-Agent payment received'
      END,
      CASE
        WHEN lower(COALESCE(NEW.payment_method, 'Cash')) IN ('cash', 'hand cash')
        THEN 'User cash received'
        ELSE 'MD received via ' || COALESCE(NULLIF(NEW.payment_method, ''), 'Cash') || ' — staff balance neutral'
      END,
      NULLIF(NEW.remarks, '')
    ),
    COALESCE(NEW.created_by, v_user)
  )
  ON CONFLICT (service_table, service_row_id) WHERE source = 'agency_ledger_payment'
  DO UPDATE SET
    receipt_id       = EXCLUDED.receipt_id,
    -- Keep the date stable once handed over; otherwise reflect the day the
    -- amount actually changes (a fresh payment), not every metadata touch.
    entry_date       = CASE
                          WHEN public.payment_receipts.handover_id IS NOT NULL
                            THEN public.payment_receipts.entry_date
                          WHEN public.payment_receipts.amount IS DISTINCT FROM EXCLUDED.amount
                            THEN CURRENT_DATE
                          ELSE public.payment_receipts.entry_date
                       END,
    service_type     = EXCLUDED.service_type,
    ref_id           = EXCLUDED.ref_id,
    passenger_name   = EXCLUDED.passenger_name,
    received_by      = EXCLUDED.received_by,
    received_by_name = EXCLUDED.received_by_name,
    amount           = EXCLUDED.amount,
    method           = EXCLUDED.method,
    source           = EXCLUDED.source,
    remarks          = EXCLUDED.remarks,
    created_by       = EXCLUDED.created_by,
    updated_at       = now();

  RETURN NEW;
END;
$$;

-- 2) Initial service-row receipt (service_form): date it by the recording day.
CREATE OR REPLACE FUNCTION public.sync_service_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  -- Receipt dated when recorded in software (business rule).
  pay_date := CURRENT_DATE;

  IF TG_OP = 'UPDATE' THEN
    UPDATE public.payment_receipts
       SET service_type = svc,
           ref_id = ref,
           passenger_name = COALESCE(pname, ''),
           updated_at = now()
     WHERE service_table = TG_TABLE_NAME
       AND service_row_id = NEW.id
       AND source = 'service_form';
    RETURN NEW;
  END IF;

  IF receiver IS NULL OR amt <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO receiver_name FROM public.profiles WHERE user_id = receiver;
  rid := 'RCV-' || to_char(pay_date, 'YYYYMM') || '-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 8));

  INSERT INTO public.payment_receipts (
    receipt_id, entry_date, service_type, service_table, service_row_id, ref_id,
    passenger_name, received_by, received_by_name, amount, method, source, created_by
  ) VALUES (
    rid, pay_date, svc, TG_TABLE_NAME, NEW.id, ref,
    COALESCE(pname, ''), receiver, receiver_name, amt, 'Cash', 'service_form', NEW.created_by
  )
  ON CONFLICT (service_table, service_row_id) WHERE source = 'service_form'
  DO NOTHING;

  RETURN NEW;
END;
$$;

-- 3) Never silently un-approve a receipt that is already locked into a handover.
CREATE OR REPLACE FUNCTION public.set_receipt_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Locked into a handover: keep its existing approval untouched.
  IF NEW.handover_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.received_by IS NOT NULL AND public.is_md(NEW.received_by) THEN
    NEW.approval_status := 'auto_approved';
    NEW.approved_by := NEW.received_by;
    NEW.approved_at := now();
  ELSE
    NEW.approval_status := 'pending_md';
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;