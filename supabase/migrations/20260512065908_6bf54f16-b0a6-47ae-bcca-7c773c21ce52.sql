
DROP TABLE IF EXISTS public.cash_transfers CASCADE;

CREATE TABLE IF NOT EXISTS public.cash_handovers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  handover_id TEXT NOT NULL,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  from_user UUID,
  from_name TEXT,
  to_name TEXT NOT NULL DEFAULT 'MD Sir',
  amount NUMERIC NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'Hand Cash',
  remarks TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cash_handovers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_select" ON public.cash_handovers FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert" ON public.cash_handovers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON public.cash_handovers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete" ON public.cash_handovers FOR DELETE TO authenticated USING (true);
DROP TRIGGER IF EXISTS trg_handovers_updated ON public.cash_handovers;
CREATE TRIGGER trg_handovers_updated BEFORE UPDATE ON public.cash_handovers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.get_user_account(_user_id UUID)
RETURNS TABLE(
  user_id UUID, full_name TEXT,
  total_received NUMERIC, total_received_today NUMERIC,
  total_handed_over NUMERIC, total_expenses NUMERIC, current_balance NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF auth.uid() <> _user_id THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY
  WITH recv AS (
    SELECT COALESCE(SUM(amt),0) AS total,
           COALESCE(SUM(amt) FILTER (WHERE d = CURRENT_DATE),0) AS today
    FROM (
      SELECT COALESCE(received,0) AS amt, entry_date AS d FROM tickets WHERE received_by = _user_id
      UNION ALL
      SELECT COALESCE(received_amount,0), entry_date FROM bmet_cards WHERE received_by = _user_id
      UNION ALL
      SELECT COALESCE(received_amount,0), entry_date FROM saudi_visas WHERE received_by = _user_id
      UNION ALL
      SELECT COALESCE(received,0), entry_date FROM kuwait_visas WHERE received_by = _user_id
    ) x
  ),
  hand AS (SELECT COALESCE(SUM(amount),0) AS total FROM cash_handovers WHERE from_user = _user_id),
  exp  AS (SELECT COALESCE(SUM(amount),0) AS total FROM cash_expenses WHERE spent_by = _user_id),
  prof AS (SELECT p.full_name FROM profiles p WHERE p.user_id = _user_id)
  SELECT _user_id,
         COALESCE((SELECT full_name FROM prof), 'User'),
         (SELECT total FROM recv),
         (SELECT today FROM recv),
         (SELECT total FROM hand),
         (SELECT total FROM exp),
         (SELECT total FROM recv) - (SELECT total FROM hand) - (SELECT total FROM exp);
END $$;

CREATE OR REPLACE FUNCTION public.get_agent_balances()
RETURNS TABLE(agent_name TEXT, total_bill NUMERIC, total_received NUMERIC, balance_due NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT agent_name,
         COALESCE(SUM(total_bill),0),
         COALESCE(SUM(received_amount),0),
         COALESCE(SUM(total_bill),0) - COALESCE(SUM(received_amount),0)
  FROM agency_ledger GROUP BY agent_name;
$$;

CREATE OR REPLACE FUNCTION public.get_vendor_balances()
RETURNS TABLE(vendor_name TEXT, total_payable NUMERIC, total_paid NUMERIC, balance_due NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vendor_name,
         COALESCE(SUM(total_payable),0),
         COALESCE(SUM(paid_amount),0),
         COALESCE(SUM(total_payable),0) - COALESCE(SUM(paid_amount),0)
  FROM vendor_ledger GROUP BY vendor_name;
$$;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.cash_handovers; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.cash_expenses; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
