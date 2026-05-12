DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Users can view own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.user_roles (user_id, role)
SELECT p.user_id, 'admin'::public.app_role
FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin')
ORDER BY p.created_at ASC
LIMIT 1
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.payment_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id TEXT NOT NULL UNIQUE,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  service_type TEXT NOT NULL,
  service_table TEXT,
  service_row_id UUID,
  ref_id TEXT,
  passenger_name TEXT NOT NULL DEFAULT '',
  received_by UUID NOT NULL,
  received_by_name TEXT,
  amount NUMERIC NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'Cash',
  source TEXT NOT NULL DEFAULT 'manual',
  remarks TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_receipts_amount_nonnegative CHECK (amount >= 0),
  CONSTRAINT payment_receipts_source_unique UNIQUE (service_table, service_row_id, source)
);

ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own receipts" ON public.payment_receipts;
DROP POLICY IF EXISTS "Users can create own receipts" ON public.payment_receipts;
DROP POLICY IF EXISTS "Users can update own receipts" ON public.payment_receipts;
DROP POLICY IF EXISTS "Users can delete own receipts" ON public.payment_receipts;
CREATE POLICY "Users can view own receipts"
ON public.payment_receipts
FOR SELECT
TO authenticated
USING (received_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can create own receipts"
ON public.payment_receipts
FOR INSERT
TO authenticated
WITH CHECK (received_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can update own receipts"
ON public.payment_receipts
FOR UPDATE
TO authenticated
USING (received_by = auth.uid() OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (received_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can delete own receipts"
ON public.payment_receipts
FOR DELETE
TO authenticated
USING (received_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_payment_receipts_updated ON public.payment_receipts;
CREATE TRIGGER trg_payment_receipts_updated
BEFORE UPDATE ON public.payment_receipts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_payment_receipts_user_date ON public.payment_receipts (received_by, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_ref ON public.payment_receipts (ref_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_service ON public.payment_receipts (service_table, service_row_id);

CREATE OR REPLACE FUNCTION public.sync_service_receipt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  amt NUMERIC := 0;
  rid TEXT;
  svc TEXT;
  ref TEXT;
  pname TEXT;
  receiver UUID;
  receiver_name TEXT;
BEGIN
  IF TG_TABLE_NAME = 'tickets' THEN
    amt := COALESCE(NEW.received, 0);
    svc := 'AIR TICKET'; ref := NEW.ticket_id; pname := NEW.passenger_name;
  ELSIF TG_TABLE_NAME = 'bmet_cards' THEN
    amt := COALESCE(NEW.received_amount, 0);
    svc := 'BMET'; ref := NEW.bmet_id; pname := NEW.passenger_name;
  ELSIF TG_TABLE_NAME = 'saudi_visas' THEN
    amt := COALESCE(NEW.received_amount, 0);
    svc := 'Saudi Visa'; ref := NEW.saudi_id; pname := NEW.passenger_name;
  ELSIF TG_TABLE_NAME = 'kuwait_visas' THEN
    amt := COALESCE(NEW.received, 0);
    svc := 'Kuwait Visa'; ref := NEW.kuwait_id; pname := NEW.passenger_name;
  ELSE
    RETURN NEW;
  END IF;

  receiver := COALESCE(NEW.received_by, NEW.created_by);
  IF receiver IS NULL THEN RETURN NEW; END IF;

  SELECT full_name INTO receiver_name FROM public.profiles WHERE user_id = receiver;

  IF amt <= 0 THEN
    DELETE FROM public.payment_receipts
    WHERE service_table = TG_TABLE_NAME AND service_row_id = NEW.id AND source = 'service_form';
    RETURN NEW;
  END IF;

  rid := 'RCV-' || to_char(CURRENT_DATE, 'YYYYMM') || '-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 8));

  INSERT INTO public.payment_receipts (
    receipt_id, entry_date, service_type, service_table, service_row_id, ref_id,
    passenger_name, received_by, received_by_name, amount, method, source, created_by
  ) VALUES (
    rid, NEW.entry_date, svc, TG_TABLE_NAME, NEW.id, ref,
    COALESCE(pname, ''), receiver, receiver_name, amt, 'Cash', 'service_form', NEW.created_by
  )
  ON CONFLICT (service_table, service_row_id, source) DO UPDATE SET
    entry_date = EXCLUDED.entry_date,
    service_type = EXCLUDED.service_type,
    ref_id = EXCLUDED.ref_id,
    passenger_name = EXCLUDED.passenger_name,
    received_by = EXCLUDED.received_by,
    received_by_name = EXCLUDED.received_by_name,
    amount = EXCLUDED.amount,
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tickets_sync_receipt ON public.tickets;
CREATE TRIGGER trg_tickets_sync_receipt AFTER INSERT OR UPDATE OF received, received_by, passenger_name, entry_date, ticket_id ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.sync_service_receipt();
DROP TRIGGER IF EXISTS trg_bmet_sync_receipt ON public.bmet_cards;
CREATE TRIGGER trg_bmet_sync_receipt AFTER INSERT OR UPDATE OF received_amount, received_by, passenger_name, entry_date, bmet_id ON public.bmet_cards FOR EACH ROW EXECUTE FUNCTION public.sync_service_receipt();
DROP TRIGGER IF EXISTS trg_saudi_sync_receipt ON public.saudi_visas;
CREATE TRIGGER trg_saudi_sync_receipt AFTER INSERT OR UPDATE OF received_amount, received_by, passenger_name, entry_date, saudi_id ON public.saudi_visas FOR EACH ROW EXECUTE FUNCTION public.sync_service_receipt();
DROP TRIGGER IF EXISTS trg_kuwait_sync_receipt ON public.kuwait_visas;
CREATE TRIGGER trg_kuwait_sync_receipt AFTER INSERT OR UPDATE OF received, received_by, passenger_name, entry_date, kuwait_id ON public.kuwait_visas FOR EACH ROW EXECUTE FUNCTION public.sync_service_receipt();

INSERT INTO public.payment_receipts (receipt_id, entry_date, service_type, service_table, service_row_id, ref_id, passenger_name, received_by, received_by_name, amount, method, source, created_by)
SELECT 'RCV-' || to_char(CURRENT_DATE, 'YYYYMM') || '-' || upper(substr(replace(t.id::text, '-', ''), 1, 8)), t.entry_date, 'AIR TICKET', 'tickets', t.id, t.ticket_id, COALESCE(t.passenger_name, ''), t.received_by, p.full_name, COALESCE(t.received, 0), 'Cash', 'service_form', t.created_by
FROM public.tickets t LEFT JOIN public.profiles p ON p.user_id = t.received_by
WHERE COALESCE(t.received, 0) > 0 AND t.received_by IS NOT NULL
ON CONFLICT (service_table, service_row_id, source) DO UPDATE SET amount = EXCLUDED.amount, passenger_name = EXCLUDED.passenger_name, entry_date = EXCLUDED.entry_date;

INSERT INTO public.payment_receipts (receipt_id, entry_date, service_type, service_table, service_row_id, ref_id, passenger_name, received_by, received_by_name, amount, method, source, created_by)
SELECT 'RCV-' || to_char(CURRENT_DATE, 'YYYYMM') || '-' || upper(substr(replace(b.id::text, '-', ''), 1, 8)), b.entry_date, 'BMET', 'bmet_cards', b.id, b.bmet_id, COALESCE(b.passenger_name, ''), b.received_by, p.full_name, COALESCE(b.received_amount, 0), 'Cash', 'service_form', b.created_by
FROM public.bmet_cards b LEFT JOIN public.profiles p ON p.user_id = b.received_by
WHERE COALESCE(b.received_amount, 0) > 0 AND b.received_by IS NOT NULL
ON CONFLICT (service_table, service_row_id, source) DO UPDATE SET amount = EXCLUDED.amount, passenger_name = EXCLUDED.passenger_name, entry_date = EXCLUDED.entry_date;

INSERT INTO public.payment_receipts (receipt_id, entry_date, service_type, service_table, service_row_id, ref_id, passenger_name, received_by, received_by_name, amount, method, source, created_by)
SELECT 'RCV-' || to_char(CURRENT_DATE, 'YYYYMM') || '-' || upper(substr(replace(s.id::text, '-', ''), 1, 8)), s.entry_date, 'Saudi Visa', 'saudi_visas', s.id, s.saudi_id, COALESCE(s.passenger_name, ''), s.received_by, p.full_name, COALESCE(s.received_amount, 0), 'Cash', 'service_form', s.created_by
FROM public.saudi_visas s LEFT JOIN public.profiles p ON p.user_id = s.received_by
WHERE COALESCE(s.received_amount, 0) > 0 AND s.received_by IS NOT NULL
ON CONFLICT (service_table, service_row_id, source) DO UPDATE SET amount = EXCLUDED.amount, passenger_name = EXCLUDED.passenger_name, entry_date = EXCLUDED.entry_date;

INSERT INTO public.payment_receipts (receipt_id, entry_date, service_type, service_table, service_row_id, ref_id, passenger_name, received_by, received_by_name, amount, method, source, created_by)
SELECT 'RCV-' || to_char(CURRENT_DATE, 'YYYYMM') || '-' || upper(substr(replace(k.id::text, '-', ''), 1, 8)), k.entry_date, 'Kuwait Visa', 'kuwait_visas', k.id, k.kuwait_id, COALESCE(k.passenger_name, ''), k.received_by, p.full_name, COALESCE(k.received, 0), 'Cash', 'service_form', k.created_by
FROM public.kuwait_visas k LEFT JOIN public.profiles p ON p.user_id = k.received_by
WHERE COALESCE(k.received, 0) > 0 AND k.received_by IS NOT NULL
ON CONFLICT (service_table, service_row_id, source) DO UPDATE SET amount = EXCLUDED.amount, passenger_name = EXCLUDED.passenger_name, entry_date = EXCLUDED.entry_date;

CREATE OR REPLACE FUNCTION public.get_user_account(_user_id UUID)
RETURNS TABLE(
  user_id UUID, full_name TEXT,
  total_received NUMERIC, total_received_today NUMERIC,
  total_handed_over NUMERIC, total_expenses NUMERIC, current_balance NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF auth.uid() <> _user_id AND NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY
  WITH recv AS (
    SELECT COALESCE(SUM(amount),0) AS total,
           COALESCE(SUM(amount) FILTER (WHERE entry_date = CURRENT_DATE),0) AS today
    FROM public.payment_receipts WHERE received_by = _user_id
  ),
  hand AS (SELECT COALESCE(SUM(amount),0) AS total FROM public.cash_handovers WHERE from_user = _user_id),
  exp  AS (SELECT COALESCE(SUM(amount),0) AS total FROM public.cash_expenses WHERE spent_by = _user_id),
  prof AS (SELECT p.full_name FROM public.profiles p WHERE p.user_id = _user_id)
  SELECT _user_id,
         COALESCE((SELECT full_name FROM prof), 'User'),
         (SELECT total FROM recv),
         (SELECT today FROM recv),
         (SELECT total FROM hand),
         (SELECT total FROM exp),
         (SELECT total FROM recv) - (SELECT total FROM hand) - (SELECT total FROM exp);
END $$;

CREATE OR REPLACE FUNCTION public.get_accounts_overview()
RETURNS TABLE(
  user_id UUID, full_name TEXT,
  total_received NUMERIC, total_handed_over NUMERIC, total_expenses NUMERIC, current_balance NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH people AS (
    SELECT p.user_id, COALESCE(p.full_name, 'User') AS full_name
    FROM public.profiles p
    WHERE p.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')
  ), recv AS (
    SELECT received_by AS user_id, SUM(amount) AS total FROM public.payment_receipts GROUP BY received_by
  ), hand AS (
    SELECT from_user AS user_id, SUM(amount) AS total FROM public.cash_handovers GROUP BY from_user
  ), exp AS (
    SELECT spent_by AS user_id, SUM(amount) AS total FROM public.cash_expenses GROUP BY spent_by
  ), summary AS (
    SELECT people.user_id, people.full_name,
           COALESCE(recv.total,0) AS total_received,
           COALESCE(hand.total,0) AS total_handed_over,
           COALESCE(exp.total,0) AS total_expenses,
           COALESCE(recv.total,0) - COALESCE(hand.total,0) - COALESCE(exp.total,0) AS current_balance
    FROM people
    LEFT JOIN recv ON recv.user_id = people.user_id
    LEFT JOIN hand ON hand.user_id = people.user_id
    LEFT JOIN exp ON exp.user_id = people.user_id
  )
  SELECT * FROM summary ORDER BY summary.current_balance DESC, summary.full_name ASC;
$$;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_receipts; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;