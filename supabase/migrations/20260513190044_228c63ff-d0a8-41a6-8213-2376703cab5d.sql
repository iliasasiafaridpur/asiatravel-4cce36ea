-- Restore upsert capability for the service-form receipt trigger without
-- blocking multiple "due" payment rows. We use a partial unique index that
-- only covers source='service_form', and rewrite the trigger to ON CONFLICT
-- against that partial index.

CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_service_form_unique
  ON public.payment_receipts (service_table, service_row_id)
  WHERE source = 'service_form';

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

  rid := 'RCV-' || to_char(CURRENT_DATE, 'YYYYMM') || '-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 8));

  INSERT INTO public.payment_receipts (
    receipt_id, entry_date, service_type, service_table, service_row_id, ref_id,
    passenger_name, received_by, received_by_name, amount, method, source, created_by
  ) VALUES (
    rid, NEW.entry_date, svc, TG_TABLE_NAME, NEW.id, ref,
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
$$;