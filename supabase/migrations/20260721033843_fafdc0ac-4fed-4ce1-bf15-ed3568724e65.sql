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
  pay_method text;
BEGIN
  IF TG_TABLE_NAME = 'tickets' THEN
    amt := COALESCE(NEW.received, 0); ref := NEW.ticket_id; svc := 'AIR TICKET';
  ELSIF TG_TABLE_NAME = 'bmet_cards' THEN
    amt := COALESCE(NEW.received_amount, 0); ref := NEW.bmet_id; svc := 'BMET';
  ELSIF TG_TABLE_NAME = 'saudi_visas' THEN
    amt := COALESCE(NEW.received_amount, 0); ref := NEW.saudi_id; svc := 'Saudi Visa';
  ELSIF TG_TABLE_NAME = 'kuwait_visas' THEN
    amt := COALESCE(NEW.received, 0); ref := NEW.kuwait_id; svc := 'Kuwait Visa';
  ELSIF TG_TABLE_NAME = 'others' THEN
    amt := COALESCE(NEW.received_amount, 0); ref := NEW.other_id; svc := 'Other';
  ELSE
    RETURN NEW;
  END IF;

  pname := NEW.passenger_name;
  receiver := COALESCE(NEW.received_by, NEW.created_by);
  pay_date := COALESCE(NEW.payment_date, NEW.entry_date, CURRENT_DATE);
  pay_method := COALESCE(NULLIF(NEW.payment_method, ''), 'Cash');

  IF TG_OP = 'UPDATE' THEN
    -- Sync ref_id + passenger_name on ALL receipts tied to this service row
    -- (service_form, due, and any other source), so name/ref edits propagate everywhere.
    UPDATE public.payment_receipts
       SET ref_id = ref,
           passenger_name = COALESCE(pname, ''),
           updated_at = now()
     WHERE service_table = TG_TABLE_NAME
       AND service_row_id = NEW.id;

    -- Only the service_form auto-receipt mirrors service_type/method/entry_date.
    UPDATE public.payment_receipts
       SET service_type = svc,
           method = pay_method,
           entry_date = COALESCE(entry_date, pay_date),
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
    COALESCE(pname, ''), receiver, receiver_name, amt, pay_method, 'service_form', NEW.created_by
  )
  ON CONFLICT (service_table, service_row_id) WHERE source = 'service_form'
  DO NOTHING;

  RETURN NEW;
END;
$function$;

-- Backfill: propagate current passenger_name from source tables to all payment_receipts
UPDATE public.payment_receipts pr
   SET passenger_name = t.passenger_name, ref_id = t.ticket_id, updated_at = now()
  FROM public.tickets t
 WHERE pr.service_table = 'tickets' AND pr.service_row_id = t.id
   AND (pr.passenger_name IS DISTINCT FROM t.passenger_name OR pr.ref_id IS DISTINCT FROM t.ticket_id);

UPDATE public.payment_receipts pr
   SET passenger_name = b.passenger_name, ref_id = b.bmet_id, updated_at = now()
  FROM public.bmet_cards b
 WHERE pr.service_table = 'bmet_cards' AND pr.service_row_id = b.id
   AND (pr.passenger_name IS DISTINCT FROM b.passenger_name OR pr.ref_id IS DISTINCT FROM b.bmet_id);

UPDATE public.payment_receipts pr
   SET passenger_name = s.passenger_name, ref_id = s.saudi_id, updated_at = now()
  FROM public.saudi_visas s
 WHERE pr.service_table = 'saudi_visas' AND pr.service_row_id = s.id
   AND (pr.passenger_name IS DISTINCT FROM s.passenger_name OR pr.ref_id IS DISTINCT FROM s.saudi_id);

UPDATE public.payment_receipts pr
   SET passenger_name = k.passenger_name, ref_id = k.kuwait_id, updated_at = now()
  FROM public.kuwait_visas k
 WHERE pr.service_table = 'kuwait_visas' AND pr.service_row_id = k.id
   AND (pr.passenger_name IS DISTINCT FROM k.passenger_name OR pr.ref_id IS DISTINCT FROM k.kuwait_id);

UPDATE public.payment_receipts pr
   SET passenger_name = o.passenger_name, ref_id = o.other_id, updated_at = now()
  FROM public.others o
 WHERE pr.service_table = 'others' AND pr.service_row_id = o.id
   AND (pr.passenger_name IS DISTINCT FROM o.passenger_name OR pr.ref_id IS DISTINCT FROM o.other_id);