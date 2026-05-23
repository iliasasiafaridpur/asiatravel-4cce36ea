DROP POLICY IF EXISTS "Users can view own receipts" ON public.payment_receipts;
CREATE POLICY "cash_receipts_select_own_or_manager"
ON public.payment_receipts
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    received_by = auth.uid()
    OR created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.is_md(auth.uid())
  )
);

DROP POLICY IF EXISTS auth_select ON public.cash_expenses;
DROP POLICY IF EXISTS "Public can view cash_expenses" ON public.cash_expenses;
CREATE POLICY "cash_expenses_select_own_or_manager"
ON public.cash_expenses
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    spent_by = auth.uid()
    OR created_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.is_md(auth.uid())
  )
);

DROP POLICY IF EXISTS auth_select ON public.cash_handovers;
CREATE POLICY "cash_handovers_select_own_or_manager"
ON public.cash_handovers
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND (
    from_user = auth.uid()
    OR created_by = auth.uid()
    OR approved_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.is_md(auth.uid())
  )
);

DROP POLICY IF EXISTS auth_select ON public.agency_ledger;
CREATE POLICY "agency_ledger_select_auth"
ON public.agency_ledger
FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS auth_select ON public.vendor_ledger;
CREATE POLICY "vendor_ledger_select_auth"
ON public.vendor_ledger
FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS auth_select_accounts ON public.accounts;
CREATE POLICY "accounts_select_auth"
ON public.accounts
FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);