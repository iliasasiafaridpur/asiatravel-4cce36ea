-- Prevent service payments from producing duplicate cash/accounting receipts.

-- Keep only one trigger per service table for service receipts, agency ledger sync, and vendor ledger sync.
DROP TRIGGER IF EXISTS trg_bmet_sync_receipt ON public.bmet_cards;
DROP TRIGGER IF EXISTS trg_saudi_sync_receipt ON public.saudi_visas;
DROP TRIGGER IF EXISTS trg_kuwait_sync_receipt ON public.kuwait_visas;
DROP TRIGGER IF EXISTS trg_tickets_sync_receipt ON public.tickets;

DROP TRIGGER IF EXISTS sync_agency_ledger_trg ON public.tickets;
DROP TRIGGER IF EXISTS sync_agency_ledger_trg ON public.bmet_cards;
DROP TRIGGER IF EXISTS sync_agency_ledger_trg ON public.saudi_visas;
DROP TRIGGER IF EXISTS sync_agency_ledger_trg ON public.kuwait_visas;

DROP TRIGGER IF EXISTS sync_vendor_ledger_trg ON public.tickets;
DROP TRIGGER IF EXISTS sync_vendor_ledger_trg ON public.bmet_cards;
DROP TRIGGER IF EXISTS sync_vendor_ledger_trg ON public.saudi_visas;
DROP TRIGGER IF EXISTS sync_vendor_ledger_trg ON public.kuwait_visas;

-- Make service-row receipts idempotent by source category.
DELETE FROM public.payment_receipts pr
USING public.payment_receipts newer
WHERE pr.id <> newer.id
  AND pr.service_table = newer.service_table
  AND pr.service_row_id = newer.service_row_id
  AND pr.source = newer.source
  AND pr.source IN ('due', 'agency_ledger_payment')
  AND pr.created_at < newer.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_due_unique
ON public.payment_receipts (service_table, service_row_id)
WHERE source = 'due';

CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_agency_ledger_payment_unique
ON public.payment_receipts (service_table, service_row_id)
WHERE source = 'agency_ledger_payment';

-- Rewrite the agency-ledger mirror function so direct service receipts always win.
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
  v_date := COALESCE(NEW.payment_date, NEW.entry_date, CURRENT_DATE);
  v_source := CASE
    WHEN NEW.source_table IS NOT NULL AND length(NEW.source_table) > 0 THEN 'agency_ledger_payment'
    ELSE 'agency_ledger'
  END;

  -- For service-linked agency ledger rows, the service's own receipt row is
  -- authoritative. Delete the agency mirror whenever a direct receipt exists.
  IF v_source = 'agency_ledger_payment' THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.payment_receipts pr
       WHERE pr.service_table = NEW.source_table
         AND pr.service_row_id = NEW.source_id
         AND pr.source NOT IN ('discount', 'agency_ledger_payment')
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
    entry_date       = EXCLUDED.entry_date,
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
END
$function$;

-- Remove mirror rows that duplicate a direct service receipt.
DELETE FROM public.payment_receipts mirror
USING public.agency_ledger al, public.payment_receipts direct_pr
WHERE mirror.service_table = 'agency_ledger'
  AND mirror.service_row_id = al.id
  AND mirror.source = 'agency_ledger_payment'
  AND al.source_table IS NOT NULL
  AND direct_pr.service_table = al.source_table
  AND direct_pr.service_row_id = al.source_id
  AND direct_pr.source NOT IN ('discount', 'agency_ledger_payment')
  AND lower(COALESCE(direct_pr.method, '')) <> 'discount';