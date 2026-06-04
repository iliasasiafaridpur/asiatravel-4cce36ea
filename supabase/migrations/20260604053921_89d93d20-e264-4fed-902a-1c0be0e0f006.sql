CREATE OR REPLACE FUNCTION public.remove_duplicate_agency_mirror_for_direct_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Direct service receipts (Due Receive / status receive / service receipt) are authoritative.
  -- The service-row update can fire agency_ledger sync before the direct receipt insert finishes,
  -- so this cleanup runs after the direct receipt exists and removes the temporary mirror.
  IF NEW.service_table IS NULL
     OR NEW.service_row_id IS NULL
     OR NEW.source IN ('discount', 'agency_ledger', 'agency_ledger_payment')
     OR lower(COALESCE(NEW.method, '')) = 'discount' THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.payment_receipts mirror
   USING public.agency_ledger al
   WHERE mirror.service_table = 'agency_ledger'
     AND mirror.service_row_id = al.id
     AND mirror.source = 'agency_ledger_payment'
     AND al.source_table = NEW.service_table
     AND al.source_id = NEW.service_row_id
     AND mirror.received_by = NEW.received_by
     -- If the mirror amount matches this direct receipt, it is certainly the same payment.
     -- If a previous direct receipt already exists for the service, the mirror is still
     -- invalid because direct receipts are the source of truth for service payments.
     AND (
       mirror.amount = NEW.amount
       OR EXISTS (
         SELECT 1
           FROM public.payment_receipts pr
          WHERE pr.service_table = NEW.service_table
            AND pr.service_row_id = NEW.service_row_id
            AND pr.source NOT IN ('discount', 'agency_ledger', 'agency_ledger_payment')
            AND lower(COALESCE(pr.method, '')) <> 'discount'
       )
     );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_remove_duplicate_agency_mirror_for_direct_receipt ON public.payment_receipts;
CREATE TRIGGER trg_remove_duplicate_agency_mirror_for_direct_receipt
AFTER INSERT OR UPDATE OF service_table, service_row_id, source, amount, method, received_by
ON public.payment_receipts
FOR EACH ROW
EXECUTE FUNCTION public.remove_duplicate_agency_mirror_for_direct_receipt();

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
END;
$function$;

WITH duplicate_mirrors AS (
  SELECT mirror.id
  FROM public.payment_receipts direct
  JOIN public.agency_ledger al
    ON al.source_table = direct.service_table
   AND al.source_id = direct.service_row_id
  JOIN public.payment_receipts mirror
    ON mirror.service_table = 'agency_ledger'
   AND mirror.service_row_id = al.id
   AND mirror.source = 'agency_ledger_payment'
  WHERE direct.source NOT IN ('discount', 'agency_ledger_payment', 'agency_ledger')
    AND lower(COALESCE(direct.method, '')) <> 'discount'
    AND direct.handover_id IS NULL
    AND mirror.handover_id IS NULL
)
DELETE FROM public.payment_receipts pr
USING duplicate_mirrors d
WHERE pr.id = d.id;