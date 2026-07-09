-- Fix: FIFO "previous deposit" in cash handover ledger computed 0 for receipts
-- created by other staff, because the payment_receipts SELECT policy hid other
-- users' receipts from non-manager staff. In this internal, all-staff-trusted
-- back-office app, operational tables (tickets, bmet_cards, agency_ledger,
-- vendor_ledger) are already readable by any authenticated user. Align
-- payment_receipts SELECT so every authenticated staff member can read all
-- receipts, which the cross-user "previous paid" calculation requires.

DROP POLICY IF EXISTS "cash_receipts_select_own_or_manager" ON public.payment_receipts;

CREATE POLICY "payment_receipts_select_auth"
  ON public.payment_receipts
  FOR SELECT
  USING (auth.uid() IS NOT NULL);
