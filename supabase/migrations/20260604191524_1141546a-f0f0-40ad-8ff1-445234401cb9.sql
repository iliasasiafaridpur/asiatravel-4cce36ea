-- ============================================================================
-- Handover integrity fix for agency_ledger mirror receipts.
--
-- Problem: a single cumulative receipt per ledger row was re-stamped to the new
-- total even after it was locked into a handover. A second installment received
-- after handover silently inflated the already-handed-over receipt, so money
-- that was never handed over appeared handed over.
--
-- Fix: receipts locked into a handover (handover_id IS NOT NULL) are now
-- immutable. The trigger maintains exactly ONE *unlocked* mirror receipt
-- holding only the not-yet-handed-over remainder (total received minus the sum
-- already locked in handovers). New money therefore lands in its own pending
-- receipt that must get its own handover/MD approval.
-- ============================================================================

-- 1) Handover-aware uniqueness: allow many locked receipts per row, but only
--    one unlocked one.
DROP INDEX IF EXISTS public.payment_receipts_agency_ledger_payment_unique;
CREATE UNIQUE INDEX payment_receipts_agency_ledger_payment_unique
  ON public.payment_receipts (service_table, service_row_id)
  WHERE (source = 'agency_ledger_payment' AND handover_id IS NULL);

-- 2) Rewrite the sync function to be handover-aware.
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
    -- Never remove receipts already locked into a handover (audit integrity).
    DELETE FROM public.payment_receipts
     WHERE service_table = 'agency_ledger'
       AND service_row_id = OLD.id
       AND source IN ('agency_ledger', 'agency_ledger_payment')
       AND handover_id IS NULL;
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
         AND source = 'agency_ledger_payment'
         AND handover_id IS NULL;
      RETURN NEW;
    END IF;
  END IF;

  -- Amount already locked into handovers for this row — immutable.
  SELECT COALESCE(SUM(amount), 0) INTO v_locked_total
    FROM public.payment_receipts
   WHERE service_table = 'agency_ledger'
     AND service_row_id = NEW.id
     AND source IN ('agency_ledger', 'agency_ledger_payment')
     AND handover_id IS NOT NULL;

  v_unlocked := v_amt - v_locked_total;

  IF v_user IS NULL OR v_unlocked <= 0 THEN
    -- Nothing left outside of handovers — drop only the unlocked mirror.
    DELETE FROM public.payment_receipts
     WHERE service_table = 'agency_ledger'
       AND service_row_id = NEW.id
       AND source IN ('agency_ledger', 'agency_ledger_payment')
       AND handover_id IS NULL;
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_user_name FROM public.profiles WHERE user_id = v_user;

  -- Receipt id stays legacy when nothing is locked yet (backward compatible);
  -- once part is locked, the remainder gets a distinct, stable suffix so it
  -- never collides with the locked receipt's id.
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

-- 3) Never let the duplicate-mirror cleanup delete a handed-over receipt.
CREATE OR REPLACE FUNCTION public.remove_duplicate_agency_mirror_for_direct_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
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
     AND mirror.handover_id IS NULL            -- never touch handed-over receipts
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
            AND pr.source NOT IN ('discount', 'agency_ledger', 'agency_ledger_payment')
            AND lower(COALESCE(pr.method, '')) <> 'discount'
       )
     );

  RETURN NEW;
END;
$function$;

-- 4) One-time correction for Mohammad Sabbir Ahmed (ledger AGL-2606-028):
--    9,500 was wrongly all marked handed over. Real split: 5,000 handed over
--    (kept in its handover) + 4,500 second installment now pending MD.
UPDATE public.payment_receipts
   SET amount = 5000,
       remarks = concat_ws(' · ', NULLIF(remarks, ''), 'Adjusted: handed-over first installment (৳5,000)'),
       updated_at = now()
 WHERE receipt_id = 'AGL-202605-893CF4DD'
   AND service_row_id = '893cf4dd-ad40-41f6-b82a-eeefe5348e33'
   AND handover_id = '147b9f31-59e3-4bcb-83c1-94e020b61fc8';

INSERT INTO public.payment_receipts (
  receipt_id, entry_date, service_type, service_table, service_row_id, ref_id,
  passenger_name, received_by, received_by_name, amount, method, source, remarks, created_by
)
SELECT
  'AGL-202606-893CF4DD-5000',
  CURRENT_DATE,
  'Service Receipt: Future travel-Bhanga',
  'agency_ledger',
  '893cf4dd-ad40-41f6-b82a-eeefe5348e33',
  'AGL-2606-028',
  'Mohammad Sabbir Ahmed',
  '8f073160-0e50-432d-9095-d9ee2edaba26',
  'Elias Rahman',
  4500,
  'Bank Transfer',
  'agency_ledger_payment',
  'সার্ভিস/কাস্টমার পেমেন্ট রিসিভ · দ্বিতীয় কিস্তি ৳4,500 — এখনো MD-কে handover হয়নি',
  '8f073160-0e50-432d-9095-d9ee2edaba26'
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_receipts
   WHERE service_table = 'agency_ledger'
     AND service_row_id = '893cf4dd-ad40-41f6-b82a-eeefe5348e33'
     AND source = 'agency_ledger_payment'
     AND handover_id IS NULL
);