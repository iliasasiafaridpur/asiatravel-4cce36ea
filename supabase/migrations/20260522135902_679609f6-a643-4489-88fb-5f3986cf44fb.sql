
-- Drop existing permissive delete policies and replace with admin-only
DROP POLICY IF EXISTS auth_delete ON public.agency_ledger;
CREATE POLICY admin_delete ON public.agency_ledger FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS auth_delete ON public.agents;
CREATE POLICY admin_delete ON public.agents FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS auth_delete ON public.bmet_cards;
CREATE POLICY admin_delete ON public.bmet_cards FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS auth_delete ON public.cash_expenses;
CREATE POLICY admin_delete ON public.cash_expenses FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS auth_delete ON public.cash_handovers;
CREATE POLICY admin_delete ON public.cash_handovers FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS auth_delete ON public.kuwait_visas;
CREATE POLICY admin_delete ON public.kuwait_visas FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS lookups_auth_delete ON public.lookups;
CREATE POLICY admin_delete ON public.lookups FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS auth_delete ON public.passengers;
CREATE POLICY admin_delete ON public.passengers FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can delete own receipts" ON public.payment_receipts;
CREATE POLICY admin_delete ON public.payment_receipts FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS auth_delete ON public.saudi_visas;
CREATE POLICY admin_delete ON public.saudi_visas FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS auth_delete ON public.tickets;
CREATE POLICY admin_delete ON public.tickets FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS auth_delete ON public.vendor_ledger;
CREATE POLICY admin_delete ON public.vendor_ledger FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS auth_delete ON public.vendors;
CREATE POLICY admin_delete ON public.vendors FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
