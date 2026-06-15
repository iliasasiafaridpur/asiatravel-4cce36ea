-- Allow trusted authenticated staff full delete on accounts-related tables.
-- Previously only admins or owners of manual/unlinked rows could delete,
-- which made deletes silently fail (RLS filtered the row, no error) for linked records.

-- payment_receipts
DROP POLICY IF EXISTS owner_delete_own_manual_receipts ON public.payment_receipts;
DROP POLICY IF EXISTS admin_delete_all_receipts ON public.payment_receipts;
CREATE POLICY "auth_delete_receipts" ON public.payment_receipts
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- cash_expenses
DROP POLICY IF EXISTS owner_delete_own_manual_expenses ON public.cash_expenses;
DROP POLICY IF EXISTS admin_delete_all_expenses ON public.cash_expenses;
CREATE POLICY "auth_delete_expenses" ON public.cash_expenses
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- cash_handovers
DROP POLICY IF EXISTS admin_delete_all_handovers ON public.cash_handovers;
CREATE POLICY "auth_delete_handovers" ON public.cash_handovers
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);