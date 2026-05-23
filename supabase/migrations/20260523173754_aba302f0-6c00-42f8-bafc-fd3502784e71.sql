
-- Cash handovers: allow admin to delete any row (not just unsubmitted)
DROP POLICY IF EXISTS admin_delete_unsubmitted_handovers ON public.cash_handovers;
CREATE POLICY admin_delete_all_handovers ON public.cash_handovers
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Payment receipts: allow admin to delete any row
DROP POLICY IF EXISTS admin_delete_unsubmitted_receipts ON public.payment_receipts;
CREATE POLICY admin_delete_all_receipts ON public.payment_receipts
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Cash expenses: allow admin to delete any row
DROP POLICY IF EXISTS admin_delete_unsubmitted_expenses ON public.cash_expenses;
CREATE POLICY admin_delete_all_expenses ON public.cash_expenses
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Profiles: admin should be able to delete profiles too
CREATE POLICY admin_delete_profiles ON public.profiles
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Day locks: admin update access (delete already exists)
CREATE POLICY admin_update_locks ON public.day_locks
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
