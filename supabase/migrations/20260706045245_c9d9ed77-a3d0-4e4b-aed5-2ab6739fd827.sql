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
  v_base_receipt_id text;
  v_suffix integer := 1;
  v_amt numeric;
  v_date date;
  v_source text;
  v_direct_total numeric := 0;
  v_locked_total numeric := 0;
  v_unlocked numeric := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.payment_receipts
     WHERE service_table = 'agency_ledger'
       AND service_row_id = OLD.id
       AND source IN ('agency_ledger', 'agency_ledger_payment')
       AND handover_id IS NULL;
    RETURN OLD;
  END IF;

  v_amt := COALESCE(NEW.received_amount, 0);
  v_user := COALESCE(NEW.received_by, NEW.created_by);
  v_date := COALESCE(NEW.payment_date, NEW.entry_date, CURRENT_DATE);
  v_source := CASE
    WHEN NEW.source_table IS NOT NULL AND length(NEW.source_table) > 0 THEN 'agency_ledger_payment'
    ELSE 'agency_ledger'
  END;

  IF v_source = 'agency_ledger_payment' THEN
    SELECT COALESCE(SUM(pr.amount), 0) INTO v_direct_total
      FROM public.payment_receipts pr
     WHERE pr.service_table = NEW.source_table
       AND pr.service_row_id = NEW.source_id
       AND pr.source NOT IN ('discount', 'agency_ledger_payment', 'agency_ledger',
                             'status_event', 'status_change', 'status-delivery')
       AND lower(COALESCE(pr.method, '')) NOT IN ('discount', 'status')
       AND COALESCE(pr.amount, 0) > 0;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_locked_total
    FROM public.payment_receipts
   WHERE service_table = 'agency_ledger'
     AND service_row_id = NEW.id
     AND source IN ('agency_ledger', 'agency_ledger_payment')
     AND handover_id IS NOT NULL;

  v_unlocked := GREATEST(v_amt - v_direct_total - v_locked_total, 0);

  IF v_user IS NULL OR v_unlocked <= 0 THEN
    DELETE FROM public.payment_receipts
     WHERE service_table = 'agency_ledger'
       AND service_row_id = NEW.id
       AND source IN ('agency_ledger', 'agency_ledger_payment')
       AND handover_id IS NULL;
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_user_name FROM public.profiles WHERE user_id = v_user;

  -- A bill can be paid several times. Once an earlier generated receipt is
  -- locked inside a handover, the next receipt for the same ledger row must use
  -- a fresh receipt_id; otherwise the global receipt_id unique constraint rejects
  -- the payment and the source-row update rolls back.
  SELECT receipt_id INTO v_receipt_id
    FROM public.payment_receipts
   WHERE service_table = 'agency_ledger'
     AND service_row_id = NEW.id
     AND source = v_source
     AND handover_id IS NULL
   LIMIT 1;

  IF v_receipt_id IS NULL THEN
    v_base_receipt_id := 'AGL-' || to_char(v_date, 'YYYYMM') || '-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 8));
    v_receipt_id := v_base_receipt_id;
    WHILE EXISTS (SELECT 1 FROM public.payment_receipts WHERE receipt_id = v_receipt_id) LOOP
      v_suffix := v_suffix + 1;
      v_receipt_id := v_base_receipt_id || '-' || lpad(v_suffix::text, 2, '0');
    END LOOP;
  END IF;

  IF v_source = 'agency_ledger' THEN
    INSERT INTO public.payment_receipts (
      receipt_id, entry_date, service_type, service_table, service_row_id, ref_id,
      passenger_name, received_by, received_by_name, amount, method, source, remarks, created_by
    ) VALUES (
      v_receipt_id, v_date, 'Agent Receipt: ' || COALESCE(NEW.agent_name, ''),
      'agency_ledger', NEW.id, NEW.ledger_id,
      COALESCE(NEW.passenger_name, NEW.agent_name, ''),
      v_user, v_user_name, v_unlocked,
      COALESCE(NULLIF(NEW.payment_method, ''), 'Cash'), v_source,
      concat_ws(' · ', 'Customer/Sub-Agent payment received', NULLIF(NEW.remarks, '')),
      COALESCE(NEW.created_by, v_user)
    )
    ON CONFLICT (service_table, service_row_id) WHERE source = 'agency_ledger' AND handover_id IS NULL
    DO UPDATE SET
      receipt_id = EXCLUDED.receipt_id,
      entry_date = EXCLUDED.entry_date,
      service_type = EXCLUDED.service_type,
      ref_id = EXCLUDED.ref_id,
      passenger_name = EXCLUDED.passenger_name,
      received_by = EXCLUDED.received_by,
      received_by_name = EXCLUDED.received_by_name,
      amount = EXCLUDED.amount,
      method = EXCLUDED.method,
      source = EXCLUDED.source,
      remarks = EXCLUDED.remarks,
      created_by = EXCLUDED.created_by,
      updated_at = now();
  ELSE
    INSERT INTO public.payment_receipts (
      receipt_id, entry_date, service_type, service_table, service_row_id, ref_id,
      passenger_name, received_by, received_by_name, amount, method, source, remarks, created_by
    ) VALUES (
      v_receipt_id, v_date, 'Service Receipt: ' || COALESCE(NEW.agent_name, ''),
      'agency_ledger', NEW.id, NEW.ledger_id,
      COALESCE(NEW.passenger_name, NEW.agent_name, ''),
      v_user, v_user_name, v_unlocked,
      COALESCE(NULLIF(NEW.payment_method, ''), 'Cash'), v_source,
      concat_ws(' · ', 'সার্ভিস/কাস্টমার পেমেন্ট রিসিভ', NULLIF(NEW.remarks, '')),
      COALESCE(NEW.created_by, v_user)
    )
    ON CONFLICT (service_table, service_row_id) WHERE source = 'agency_ledger_payment' AND handover_id IS NULL
    DO UPDATE SET
      receipt_id = EXCLUDED.receipt_id,
      entry_date = EXCLUDED.entry_date,
      service_type = EXCLUDED.service_type,
      ref_id = EXCLUDED.ref_id,
      passenger_name = EXCLUDED.passenger_name,
      received_by = EXCLUDED.received_by,
      received_by_name = EXCLUDED.received_by_name,
      amount = EXCLUDED.amount,
      method = EXCLUDED.method,
      source = EXCLUDED.source,
      remarks = EXCLUDED.remarks,
      created_by = EXCLUDED.created_by,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$function$;