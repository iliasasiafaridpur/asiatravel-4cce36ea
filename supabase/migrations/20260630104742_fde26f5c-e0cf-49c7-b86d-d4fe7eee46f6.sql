-- Fix back-filled agency payment receipts that were stamped with the migration
-- run date (2026-06-30) instead of each payment's real date. Restore each
-- receipt's entry_date to the source agency_ledger row's actual payment date
-- (payment_date, falling back to the booking entry_date).
UPDATE public.payment_receipts pr
SET entry_date = COALESCE(al.payment_date, al.entry_date),
    updated_at = now()
FROM public.agency_ledger al
WHERE al.ledger_id = pr.ref_id
  AND pr.source = 'agency_ledger_payment'
  AND pr.created_at = '2026-06-30 10:12:31.121573+00'
  AND pr.entry_date <> COALESCE(al.payment_date, al.entry_date);