
-- 1) Cash expenses table (office expenses tracked per user)
CREATE TABLE public.cash_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id TEXT NOT NULL UNIQUE,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  spent_by UUID,
  spent_by_name TEXT,
  category TEXT NOT NULL DEFAULT 'Other',
  amount NUMERIC NOT NULL DEFAULT 0,
  purpose TEXT,
  remarks TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cash_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view cash_expenses" ON public.cash_expenses FOR SELECT USING (true);
CREATE POLICY "Public can insert cash_expenses" ON public.cash_expenses FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can update cash_expenses" ON public.cash_expenses FOR UPDATE USING (true);
CREATE POLICY "Public can delete cash_expenses" ON public.cash_expenses FOR DELETE USING (true);
CREATE TRIGGER set_cash_expenses_updated_at BEFORE UPDATE ON public.cash_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Cash Drawer balance function (per user, live)
CREATE OR REPLACE FUNCTION public.get_cash_drawer(_user_id UUID)
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  total_received NUMERIC,
  total_received_today NUMERIC,
  total_handed_over NUMERIC,
  total_received_in NUMERIC,
  total_expenses NUMERIC,
  current_balance NUMERIC
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH recv AS (
    SELECT COALESCE(SUM(amt),0) AS total, COALESCE(SUM(amt) FILTER (WHERE d = CURRENT_DATE),0) AS today
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
  out_xfer AS (
    SELECT COALESCE(SUM(amount),0) AS total FROM cash_transfers WHERE from_user = _user_id
  ),
  in_xfer AS (
    SELECT COALESCE(SUM(amount),0) AS total FROM cash_transfers WHERE to_user = _user_id
  ),
  exp AS (
    SELECT COALESCE(SUM(amount),0) AS total FROM cash_expenses WHERE spent_by = _user_id
  ),
  prof AS (
    SELECT p.user_id, p.full_name FROM profiles p WHERE p.user_id = _user_id
  )
  SELECT
    _user_id,
    COALESCE((SELECT full_name FROM prof), 'User'),
    (SELECT total FROM recv),
    (SELECT today FROM recv),
    (SELECT total FROM out_xfer),
    (SELECT total FROM in_xfer),
    (SELECT total FROM exp),
    (SELECT total FROM recv) + (SELECT total FROM in_xfer) - (SELECT total FROM out_xfer) - (SELECT total FROM exp);
END $$;

GRANT EXECUTE ON FUNCTION public.get_cash_drawer(UUID) TO anon, authenticated;
