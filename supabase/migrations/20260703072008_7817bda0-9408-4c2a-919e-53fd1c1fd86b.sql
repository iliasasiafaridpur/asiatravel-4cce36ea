-- এন্ট্রি-টাইমে গৃহীত টাকার মাধ্যম (Cash/bKash/Bank...) সংরক্ষণের জন্য কলাম।
-- আগে sync_service_receipt trigger জোর করে method='Cash' ধরত; এখন এই কলাম থেকে নেবে।
ALTER TABLE public.tickets      ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.bmet_cards   ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.saudi_visas  ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.kuwait_visas ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.others       ADD COLUMN IF NOT EXISTS payment_method text;

-- Trigger আপডেট: এন্ট্রির received টাকার receipt-এ চয়ন করা payment_method বসবে।
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
    UPDATE public.payment_receipts
       SET service_type = svc,
           ref_id = ref,
           passenger_name = COALESCE(pname, ''),
           method = pay_method,
           entry_date = CASE WHEN source = 'service_form' THEN COALESCE(entry_date, pay_date) ELSE entry_date END,
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