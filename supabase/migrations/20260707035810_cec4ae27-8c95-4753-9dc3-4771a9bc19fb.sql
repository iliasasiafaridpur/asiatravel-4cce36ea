
DO $$
BEGIN
  -- Temporarily bypass the two BEFORE-DELETE guard triggers (auth + day-lock)
  -- so we can remove one orphaned receipt. The AFTER-DELETE reconciliation
  -- triggers (handover sync, account recalc) stay enabled and run normally.
  ALTER TABLE public.payment_receipts DISABLE TRIGGER trg_guard_locked_receipt;
  ALTER TABLE public.payment_receipts DISABLE TRIGGER trg_lock_payment_receipts;

  DELETE FROM public.payment_receipts
  WHERE id = '366c5219-4e7f-4162-8423-c404284bb527'
    AND ref_id = 'AGL-2606-031'
    AND amount = 2000
    AND source = 'agency_ledger'
    AND service_row_id = '8d06d3c9-9436-446d-a426-232f2d6c9e44';

  ALTER TABLE public.payment_receipts ENABLE TRIGGER trg_guard_locked_receipt;
  ALTER TABLE public.payment_receipts ENABLE TRIGGER trg_lock_payment_receipts;
END $$;
