-- Fix duplicate receipts: when DueReceiveDialog adds a payment, it inserts a
-- 'due' receipt AND updates service.received. The previous trigger then
-- upserted the 'service_form' receipt to the new total — double counting.
-- New behavior:
--   * INSERT: create the service_form receipt for the initial received amount.
--   * UPDATE: only sync metadata (passenger_name, ref_id, payment_date) on the
--     existing service_form receipt; never change its amount. Subsequent
--     payments are tracked as 'due' receipts by DueReceiveDialog.

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
  pay_date := COALESCE(NEW.payment_date, NEW.entry_date, CURRENT_DATE);

  IF TG_OP = 'UPDATE' THEN
    -- Only sync metadata on existing service_form receipt; do NOT change amount.
    -- This prevents double-counting when DueReceiveDialog inserts a separate
    -- 'due' receipt AND updates received on the service row.
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

  -- INSERT path
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
$function$;

-- Clean up existing duplicates: for each service row that has BOTH a
-- service_form receipt and one or more 'due' receipts, set service_form.amount
-- to (service.received - SUM(due receipts)) so totals reconcile correctly.
WITH svc_rows AS (
  SELECT 'tickets'::text AS t, id, COALESCE(received, 0) AS recv FROM public.tickets
  UNION ALL
  SELECT 'bmet_cards', id, COALESCE(received_amount, 0) FROM public.bmet_cards
  UNION ALL
  SELECT 'saudi_visas', id, COALESCE(received_amount, 0) FROM public.saudi_visas
  UNION ALL
  SELECT 'kuwait_visas', id, COALESCE(received, 0) FROM public.kuwait_visas
),
due_sums AS (
  SELECT service_table, service_row_id, COALESCE(SUM(amount), 0) AS due_total
    FROM public.payment_receipts
   WHERE source = 'due'
   GROUP BY service_table, service_row_id
)
UPDATE public.payment_receipts pr
   SET amount = GREATEST(s.recv - COALESCE(d.due_total, 0), 0),
       updated_at = now()
  FROM svc_rows s
  LEFT JOIN due_sums d ON d.service_table = s.t AND d.service_row_id = s.id
 WHERE pr.source = 'service_form'
   AND pr.service_table = s.t
   AND pr.service_row_id = s.id
   AND pr.amount <> GREATEST(s.recv - COALESCE(d.due_total, 0), 0);

-- Remove zero-amount service_form receipts left behind (initial received=0
-- with subsequent due payments — the due rows already account for everything).
DELETE FROM public.payment_receipts
 WHERE source = 'service_form' AND amount = 0;