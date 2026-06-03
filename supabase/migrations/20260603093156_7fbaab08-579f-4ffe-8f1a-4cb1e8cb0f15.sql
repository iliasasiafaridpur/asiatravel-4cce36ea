-- Allow multiple legitimate due-receive installments for the same service row.
DROP INDEX IF EXISTS public.payment_receipts_due_unique;