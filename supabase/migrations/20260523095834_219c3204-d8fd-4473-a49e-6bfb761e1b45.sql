DROP POLICY IF EXISTS owner_delete_own_handovers ON public.cash_handovers;
DROP POLICY IF EXISTS admin_delete ON public.cash_handovers;

CREATE POLICY admin_delete_unsubmitted_handovers
ON public.cash_handovers
FOR DELETE
TO authenticated
USING (
  submitted_amount IS NULL
  AND closing_date IS NULL
  AND COALESCE(status, 'approved') <> 'pending'
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);