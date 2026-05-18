
-- =========================================================
-- 1. ACCOUNTS TABLE
-- =========================================================
CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  type text NOT NULL DEFAULT 'cash', -- cash | bank | mobile | crypto | other
  opening_balance numeric NOT NULL DEFAULT 0,
  current_balance numeric NOT NULL DEFAULT 0,
  allow_negative boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_select_accounts" ON public.accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_insert_accounts" ON public.accounts FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin_update_accounts" ON public.accounts FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin_delete_accounts" ON public.accounts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_accounts_updated_at BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed default accounts
INSERT INTO public.accounts (account_code, name, type, sort_order) VALUES
  ('ACC-001', 'Cash Box',     'cash',   1),
  ('ACC-002', 'BRAC Bank',    'bank',   2),
  ('ACC-003', 'bKash',        'mobile', 3),
  ('ACC-004', 'Nagad',        'mobile', 4),
  ('ACC-005', 'Rocket',       'mobile', 5),
  ('ACC-006', 'RedotPay',     'crypto', 6),
  ('ACC-007', 'Binance P2P',  'crypto', 7)
ON CONFLICT (account_code) DO NOTHING;

-- =========================================================
-- 2. FUND TRANSFERS
-- =========================================================
CREATE TABLE public.fund_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id text NOT NULL UNIQUE,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  from_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  to_account_id   uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  remarks text,
  category text NOT NULL DEFAULT 'INTERNAL_TRANSFER',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_account_id <> to_account_id)
);

ALTER TABLE public.fund_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_fund_transfers" ON public.fund_transfers FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_fund_transfers_updated_at BEFORE UPDATE ON public.fund_transfers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- 3. ADD account_id TO TRANSACTIONAL TABLES
-- =========================================================
ALTER TABLE public.cash_expenses    ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id);
ALTER TABLE public.payment_receipts ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id);
ALTER TABLE public.cash_handovers   ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id);

-- Backfill: map by name from existing payment_method/category/method text
UPDATE public.cash_expenses ce SET account_id = a.id FROM public.accounts a
 WHERE ce.account_id IS NULL AND lower(coalesce(ce.category,'')) = lower(a.name);
UPDATE public.cash_expenses SET account_id = (SELECT id FROM public.accounts WHERE name='Cash Box' LIMIT 1)
 WHERE account_id IS NULL;

UPDATE public.payment_receipts pr SET account_id = a.id FROM public.accounts a
 WHERE pr.account_id IS NULL AND lower(coalesce(pr.method,'')) = lower(a.name);
UPDATE public.payment_receipts SET account_id = (SELECT id FROM public.accounts WHERE name='Cash Box' LIMIT 1)
 WHERE account_id IS NULL;

UPDATE public.cash_handovers SET account_id = (SELECT id FROM public.accounts WHERE name='Cash Box' LIMIT 1)
 WHERE account_id IS NULL;

-- =========================================================
-- 4. DAILY CASH CLOSINGS
-- =========================================================
CREATE TABLE public.daily_cash_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_date date NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  opening_balance numeric NOT NULL DEFAULT 0,
  total_received numeric NOT NULL DEFAULT 0,
  total_paid numeric NOT NULL DEFAULT 0,
  expected_closing numeric NOT NULL DEFAULT 0,
  actual_closing numeric NOT NULL DEFAULT 0,
  discrepancy numeric GENERATED ALWAYS AS (actual_closing - expected_closing) STORED,
  notes text,
  is_locked boolean NOT NULL DEFAULT true,
  closed_by uuid,
  closed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (closing_date, account_id)
);

ALTER TABLE public.daily_cash_closings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_select_closings" ON public.daily_cash_closings FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_closings" ON public.daily_cash_closings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "admin_update_closings" ON public.daily_cash_closings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin_delete_closings" ON public.daily_cash_closings FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_daily_cash_closings_updated_at BEFORE UPDATE ON public.daily_cash_closings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- 5. BALANCE RECALCULATION
-- =========================================================
CREATE OR REPLACE FUNCTION public.recalc_account_balance(_account_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_open numeric;
  v_in numeric;
  v_out numeric;
  v_xfer_in numeric;
  v_xfer_out numeric;
BEGIN
  IF _account_id IS NULL THEN RETURN; END IF;
  SELECT opening_balance INTO v_open FROM public.accounts WHERE id = _account_id;
  IF v_open IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(amount),0) INTO v_in
    FROM public.payment_receipts WHERE account_id = _account_id;
  SELECT COALESCE(SUM(amount),0) INTO v_out
    FROM public.cash_expenses WHERE account_id = _account_id;
  SELECT COALESCE(SUM(amount),0) INTO v_xfer_in
    FROM public.fund_transfers WHERE to_account_id = _account_id;
  SELECT COALESCE(SUM(amount),0) INTO v_xfer_out
    FROM public.fund_transfers WHERE from_account_id = _account_id;

  UPDATE public.accounts
    SET current_balance = v_open + v_in + v_xfer_in - v_out - v_xfer_out,
        updated_at = now()
  WHERE id = _account_id;
END $$;

CREATE OR REPLACE FUNCTION public.trg_recalc_account_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'fund_transfers' THEN
      PERFORM public.recalc_account_balance(OLD.from_account_id);
      PERFORM public.recalc_account_balance(OLD.to_account_id);
    ELSE
      PERFORM public.recalc_account_balance(OLD.account_id);
    END IF;
    RETURN OLD;
  ELSE
    IF TG_TABLE_NAME = 'fund_transfers' THEN
      PERFORM public.recalc_account_balance(NEW.from_account_id);
      PERFORM public.recalc_account_balance(NEW.to_account_id);
      IF TG_OP = 'UPDATE' THEN
        IF OLD.from_account_id <> NEW.from_account_id THEN
          PERFORM public.recalc_account_balance(OLD.from_account_id);
        END IF;
        IF OLD.to_account_id <> NEW.to_account_id THEN
          PERFORM public.recalc_account_balance(OLD.to_account_id);
        END IF;
      END IF;
    ELSE
      PERFORM public.recalc_account_balance(NEW.account_id);
      IF TG_OP = 'UPDATE' AND OLD.account_id IS DISTINCT FROM NEW.account_id THEN
        PERFORM public.recalc_account_balance(OLD.account_id);
      END IF;
    END IF;
    RETURN NEW;
  END IF;
END $$;

-- Also recalc on opening_balance change
CREATE OR REPLACE FUNCTION public.trg_recalc_on_opening_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.opening_balance IS DISTINCT FROM NEW.opening_balance THEN
    PERFORM public.recalc_account_balance(NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_recalc_payment_receipts AFTER INSERT OR UPDATE OR DELETE ON public.payment_receipts
  FOR EACH ROW EXECUTE FUNCTION public.trg_recalc_account_balance();
CREATE TRIGGER trg_recalc_cash_expenses AFTER INSERT OR UPDATE OR DELETE ON public.cash_expenses
  FOR EACH ROW EXECUTE FUNCTION public.trg_recalc_account_balance();
CREATE TRIGGER trg_recalc_fund_transfers AFTER INSERT OR UPDATE OR DELETE ON public.fund_transfers
  FOR EACH ROW EXECUTE FUNCTION public.trg_recalc_account_balance();
CREATE TRIGGER trg_recalc_accounts_opening AFTER INSERT OR UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.trg_recalc_on_opening_change();

-- =========================================================
-- 6. NEGATIVE BALANCE GUARD
-- =========================================================
CREATE OR REPLACE FUNCTION public.guard_negative_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_allow boolean;
  v_bal numeric;
  v_name text;
  v_acct uuid;
BEGIN
  IF TG_TABLE_NAME = 'fund_transfers' THEN
    v_acct := NEW.from_account_id;
  ELSE
    v_acct := NEW.account_id;
    -- only outflow tables need guarding
    IF TG_TABLE_NAME <> 'cash_expenses' THEN RETURN NEW; END IF;
  END IF;

  IF v_acct IS NULL THEN RETURN NEW; END IF;
  SELECT allow_negative, current_balance, name INTO v_allow, v_bal, v_name
    FROM public.accounts WHERE id = v_acct;
  IF v_allow THEN RETURN NEW; END IF;
  IF public.has_role(auth.uid(),'admin') THEN RETURN NEW; END IF;

  -- Recalculate prospective balance after this row
  PERFORM public.recalc_account_balance(v_acct);
  SELECT current_balance INTO v_bal FROM public.accounts WHERE id = v_acct;
  IF v_bal < 0 THEN
    RAISE EXCEPTION 'Account "%" balance would go negative (৳%). Admin override required.', v_name, v_bal
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER trg_guard_neg_expenses
  AFTER INSERT OR UPDATE ON public.cash_expenses
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION public.guard_negative_balance();
CREATE CONSTRAINT TRIGGER trg_guard_neg_transfers
  AFTER INSERT OR UPDATE ON public.fund_transfers
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION public.guard_negative_balance();

-- =========================================================
-- 7. LOCKED DATE GUARD
-- =========================================================
CREATE OR REPLACE FUNCTION public.guard_locked_date()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_acct uuid;
  v_date date;
  v_locked_until date;
BEGIN
  IF public.has_role(auth.uid(),'admin') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_acct := OLD.account_id;
    v_date := OLD.entry_date;
  ELSE
    v_acct := NEW.account_id;
    v_date := NEW.entry_date;
  END IF;

  IF v_acct IS NULL OR v_date IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT MAX(closing_date) INTO v_locked_until
    FROM public.daily_cash_closings
    WHERE account_id = v_acct AND is_locked = true;

  IF v_locked_until IS NOT NULL AND v_date <= v_locked_until THEN
    RAISE EXCEPTION 'Date % is locked by day-end closing (locked through %). Admin only.', v_date, v_locked_until
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE TRIGGER trg_lock_payment_receipts
  BEFORE INSERT OR UPDATE OR DELETE ON public.payment_receipts
  FOR EACH ROW EXECUTE FUNCTION public.guard_locked_date();
CREATE TRIGGER trg_lock_cash_expenses
  BEFORE INSERT OR UPDATE OR DELETE ON public.cash_expenses
  FOR EACH ROW EXECUTE FUNCTION public.guard_locked_date();

-- =========================================================
-- 8. INITIAL BALANCE COMPUTE
-- =========================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.accounts LOOP
    PERFORM public.recalc_account_balance(r.id);
  END LOOP;
END $$;
