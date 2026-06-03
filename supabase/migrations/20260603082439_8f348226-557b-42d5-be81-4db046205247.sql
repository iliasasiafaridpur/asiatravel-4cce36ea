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

  IF v_amt <= 0 OR v_user IS NULL THEN
    DELETE FROM public.payment_receipts
     WHERE service_table = 'agency_ledger'
       AND service_row_id = NEW.id
       AND source IN ('agency_ledger', 'agency_ledger_payment');
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_user_name FROM public.profiles WHERE user_id = v_user;
  v_receipt_id := 'AGL-' || to_char(v_date, 'YYYYMM') || '-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 8));

  IF EXISTS (
    SELECT 1 FROM public.payment_receipts
     WHERE service_table = 'agency_ledger'
       AND service_row_id = NEW.id
       AND source IN ('agency_ledger', 'agency_ledger_payment')
  ) THEN
    UPDATE public.payment_receipts SET
      receipt_id       = v_receipt_id,
      entry_date       = v_date,
      service_type     = CASE
        WHEN v_source = 'agency_ledger_payment' THEN 'Service Receipt: ' || COALESCE(NEW.agent_name, '')
        ELSE 'Agent Receipt: ' || COALESCE(NEW.agent_name, '')
      END,
      ref_id           = NEW.ledger_id,
      passenger_name   = COALESCE(NEW.passenger_name, NEW.agent_name, ''),
      received_by      = v_user,
      received_by_name = v_user_name,
      amount           = v_amt,
      method           = COALESCE(NULLIF(NEW.payment_method, ''), 'Cash'),
      source           = v_source,
      remarks          = concat_ws(' · ',
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
      created_by       = COALESCE(NEW.created_by, v_user),
      updated_at       = now()
    WHERE service_table = 'agency_ledger'
      AND service_row_id = NEW.id
      AND source IN ('agency_ledger', 'agency_ledger_payment');
  ELSE
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
    );
  END IF;

  RETURN NEW;
END
$function$;

UPDATE public.agency_ledger
   SET updated_at = now()
 WHERE COALESCE(received_amount, 0) > 0
   AND received_by IS NOT NULL
   AND source_table IN ('tickets', 'bmet_cards', 'saudi_visas', 'kuwait_visas')
   AND NOT EXISTS (
     SELECT 1
       FROM public.payment_receipts pr
      WHERE pr.service_table = 'agency_ledger'
        AND pr.service_row_id = agency_ledger.id
        AND pr.source IN ('agency_ledger', 'agency_ledger_payment')
   );