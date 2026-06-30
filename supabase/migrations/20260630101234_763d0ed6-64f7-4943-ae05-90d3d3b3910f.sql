-- Fix: Agency-ledger payments were not crediting the staff balance when the
-- booking already had a zero-amount "status_event" audit receipt.
--
-- Root cause: both the cash-mirror trigger (sync_agent_receipt_to_cash) and the
-- de-dupe trigger (remove_duplicate_agency_mirror_for_direct_receipt) treated ANY
-- non-discount payment_receipts row as a "real direct receipt". The status-change
-- audit rows (source = 'status_event'/'status_change'/'status-delivery', method =
-- 'Status', amount = 0) matched that test, so the agency payment receipt was either
-- skipped or deleted -- money received from the Agency Ledger never reached the
-- balance. DueReceiveDialog inserts a real 'due' receipt directly, which is why the
-- same action behaved differently across entry points.

-- 1) Cash-mirror trigger -----------------------------------------------------
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
  v_source text;
  v_has_direct_receipt boolean;
  v_locked_total numeric;
  v_unlocked numeric;
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
  v_date := CURRENT_DATE;
  v_source := CASE
    WHEN NEW.source_table IS NOT NULL AND length(NEW.source_table) > 0 THEN 'agency_ledger_payment'
    ELSE 'agency_ledger'
  END;

  IF v_source = 'agency_ledger_payment' THEN
    -- Only a *real money* receipt (not a zero-amount status audit row) should
    -- suppress the agency mirror, otherwise the payment would be lost.
    SELECT EXISTS (
      SELECT 1
        FROM public.payment_receipts pr
       WHERE pr.service_table = NEW.source_table
         AND pr.service_row_id = NEW.source_id
         AND pr.source NOT IN ('discount', 'agency_ledger_payment', 'agency_ledger',
                               'status_event', 'status_change', 'status-delivery')
         AND lower(COALESCE(pr.method, '')) NOT IN ('discount', 'status')
         AND COALESCE(pr.amount, 0) > 0
    ) INTO v_has_direct_receipt;

    IF v_has_direct_receipt THEN
      DELETE FROM public.payment_receipts
       WHERE service_table = 'agency_ledger'
         AND service_row_id = NEW.id
         AND source = 'agency_ledger_payment'
         AND handover_id IS NULL;
      RETURN NEW;
    END IF;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_locked_total
    FROM public.payment_receipts
   WHERE service_table = 'agency_ledger'
     AND service_row_id = NEW.id
     AND source IN ('agency_ledger', 'agency_ledger_payment')
     AND handover_id IS NOT NULL;

  v_unlocked := v_amt - v_locked_total;

  IF v_user IS NULL OR v_unlocked <= 0 THEN
    DELETE FROM public.payment_receipts
     WHERE service_table = 'agency_ledger'
       AND service_row_id = NEW.id
       AND source IN ('agency_ledger', 'agency_ledger_payment')
       AND handover_id IS NULL;
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_user_name FROM public.profiles WHERE user_id = v_user;

  v_receipt_id := 'AGL-' || to_char(v_date, 'YYYYMM') || '-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 8))
    || CASE WHEN v_locked_total > 0 THEN '-' || to_char(v_locked_total, 'FM999999999') ELSE '' END;

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
    v_user, v_user_name, v_unlocked,
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
  ON CONFLICT (service_table, service_row_id) WHERE source = 'agency_ledger_payment' AND handover_id IS NULL
  DO UPDATE SET
    receipt_id       = EXCLUDED.receipt_id,
    entry_date       = CASE
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
$function$;

-- 2) De-dupe trigger ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_duplicate_agency_mirror_for_direct_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- A zero-amount status audit row is NOT a real receipt and must never delete
  -- a legitimate agency payment mirror.
  IF NEW.service_table IS NULL
     OR NEW.service_row_id IS NULL
     OR NEW.source IN ('discount', 'agency_ledger', 'agency_ledger_payment',
                       'status_event', 'status_change', 'status-delivery')
     OR lower(COALESCE(NEW.method, '')) IN ('discount', 'status')
     OR COALESCE(NEW.amount, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.payment_receipts mirror
   USING public.agency_ledger al
   WHERE mirror.service_table = 'agency_ledger'
     AND mirror.service_row_id = al.id
     AND mirror.source = 'agency_ledger_payment'
     AND mirror.handover_id IS NULL
     AND al.source_table = NEW.service_table
     AND al.source_id = NEW.service_row_id
     AND mirror.received_by = NEW.received_by
     AND (
       mirror.amount = NEW.amount
       OR EXISTS (
         SELECT 1
           FROM public.payment_receipts pr
          WHERE pr.service_table = NEW.service_table
            AND pr.service_row_id = NEW.service_row_id
            AND pr.source NOT IN ('discount', 'agency_ledger', 'agency_ledger_payment',
                                  'status_event', 'status_change', 'status-delivery')
            AND lower(COALESCE(pr.method, '')) NOT IN ('discount', 'status')
            AND COALESCE(pr.amount, 0) > 0
       )
     );

  RETURN NEW;
END;
$function$;

-- 3) Backfill: re-run the corrected mirror trigger for source-backed agency
-- payments currently missing their money receipt.
UPDATE public.agency_ledger al
   SET received_amount = al.received_amount
 WHERE al.source_table IS NOT NULL
   AND length(al.source_table) > 0
   AND COALESCE(al.received_amount, 0) > 0
   AND NOT EXISTS (
     SELECT 1 FROM public.payment_receipts pr
      WHERE pr.service_table = 'agency_ledger'
        AND pr.service_row_id = al.id
        AND pr.source IN ('agency_ledger', 'agency_ledger_payment')
   )
   AND NOT EXISTS (
     SELECT 1 FROM public.payment_receipts pr
      WHERE pr.service_table = al.source_table
        AND pr.service_row_id = al.source_id
        AND pr.source NOT IN ('discount', 'agency_ledger', 'agency_ledger_payment',
                              'status_event', 'status_change', 'status-delivery')
        AND lower(COALESCE(pr.method, '')) NOT IN ('discount', 'status')
        AND COALESCE(pr.amount, 0) > 0
   );