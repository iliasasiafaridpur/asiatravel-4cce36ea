DROP POLICY IF EXISTS admin_delete ON public.agents;
CREATE POLICY admin_delete ON public.agents
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_md(auth.uid()));

DROP POLICY IF EXISTS admin_delete ON public.vendors;
CREATE POLICY admin_delete ON public.vendors
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_md(auth.uid()));