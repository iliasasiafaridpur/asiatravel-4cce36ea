-- Allow MD to view all transactions for full oversight on My Accounts page
DROP POLICY IF EXISTS "Users can view own receipts" ON public.payment_receipts;
CREATE POLICY "Users can view own receipts"
ON public.payment_receipts FOR SELECT TO authenticated
USING (
  received_by = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.is_md(auth.uid())
);