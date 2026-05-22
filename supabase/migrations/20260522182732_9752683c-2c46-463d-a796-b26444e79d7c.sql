DROP POLICY IF EXISTS "auth_all_fund_transfers" ON public.fund_transfers;

CREATE POLICY "auth_select_fund_transfers" ON public.fund_transfers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_fund_transfers" ON public.fund_transfers
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_fund_transfers" ON public.fund_transfers
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_delete_fund_transfers" ON public.fund_transfers
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));