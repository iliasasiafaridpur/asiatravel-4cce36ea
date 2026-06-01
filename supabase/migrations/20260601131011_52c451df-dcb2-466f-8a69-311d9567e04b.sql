-- Allow any authenticated staff member to delete payment receipts, expenses,
-- and cash handovers from the My Accounts page.

DROP POLICY IF EXISTS staff_delete_receipts ON public.payment_receipts;
CREATE POLICY staff_delete_receipts
ON public.payment_receipts
FOR DELETE
TO authenticated
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS staff_delete_expenses ON public.cash_expenses;
CREATE POLICY staff_delete_expenses
ON public.cash_expenses
FOR DELETE
TO authenticated
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS staff_delete_handovers ON public.cash_handovers;
CREATE POLICY staff_delete_handovers
ON public.cash_handovers
FOR DELETE
TO authenticated
USING (auth.uid() IS NOT NULL);