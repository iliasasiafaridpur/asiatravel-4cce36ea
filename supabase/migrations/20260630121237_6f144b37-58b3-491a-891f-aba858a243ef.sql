-- Remove ONLY the phantom backfilled cash receipt that wrongly shows ৳9000
-- (Md Arman Sikder / Kholil-QA, 19-May) in Elias Rahman's hand. This receipt
-- was auto-created by a 30-Jun backfill for an old payment already handed to MD.
-- The guard trigger blocks deletes when auth.uid() is null (migration context),
-- so disable it just for this targeted delete, then re-enable.
ALTER TABLE public.payment_receipts DISABLE TRIGGER trg_guard_locked_receipt;

DELETE FROM public.payment_receipts
WHERE id = '6487d9e7-63be-401d-a8d2-d5bc59f508bc'
  AND receipt_id = 'AGL-202605-2E9D42B7'
  AND amount = 9000
  AND source = 'agency_ledger_payment'
  AND entry_date = '2026-05-19'
  AND received_by = '8f073160-0e50-432d-9095-d9ee2edaba26'
  AND handover_id IS NULL;

ALTER TABLE public.payment_receipts ENABLE TRIGGER trg_guard_locked_receipt;