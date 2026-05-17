
-- ============================================================
-- 1. Vendor wallet helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_vendor_wallet(_vendor_name text)
RETURNS TABLE(advance_balance numeric, payable_due numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    GREATEST(COALESCE(SUM(paid_amount),0) - COALESCE(SUM(total_payable),0), 0) AS advance_balance,
    GREATEST(COALESCE(SUM(total_payable),0) - COALESCE(SUM(paid_amount),0), 0) AS payable_due
  FROM public.vendor_ledger
  WHERE vendor_name = _vendor_name;
$$;

-- ============================================================
-- 2. Agent wallet helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_agent_wallet(_agent_name text)
RETURNS TABLE(advance_balance numeric, current_due numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    GREATEST(COALESCE(SUM(received_amount),0) - COALESCE(SUM(total_bill),0), 0) AS advance_balance,
    GREATEST(COALESCE(SUM(total_bill),0) - COALESCE(SUM(received_amount),0), 0) AS current_due
  FROM public.agency_ledger
  WHERE agent_name = _agent_name;
$$;

-- ============================================================
-- 3. Updated balance summaries (add advance_balance column)
-- ============================================================
DROP FUNCTION IF EXISTS public.get_vendor_balances();
CREATE OR REPLACE FUNCTION public.get_vendor_balances()
RETURNS TABLE(vendor_name text, total_payable numeric, total_paid numeric, balance_due numeric, advance_balance numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    vendor_name,
    COALESCE(SUM(total_payable),0),
    COALESCE(SUM(paid_amount),0),
    GREATEST(COALESCE(SUM(total_payable),0) - COALESCE(SUM(paid_amount),0), 0),
    GREATEST(COALESCE(SUM(paid_amount),0) - COALESCE(SUM(total_payable),0), 0)
  FROM vendor_ledger
  GROUP BY vendor_name;
$$;

DROP FUNCTION IF EXISTS public.get_agent_balances();
CREATE OR REPLACE FUNCTION public.get_agent_balances()
RETURNS TABLE(agent_name text, total_bill numeric, total_received numeric, balance_due numeric, advance_balance numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    agent_name,
    COALESCE(SUM(total_bill),0),
    COALESCE(SUM(received_amount),0),
    GREATEST(COALESCE(SUM(total_bill),0) - COALESCE(SUM(received_amount),0), 0),
    GREATEST(COALESCE(SUM(received_amount),0) - COALESCE(SUM(total_bill),0), 0)
  FROM agency_ledger
  GROUP BY agent_name;
$$;

-- ============================================================
-- 4. Auto-adjust advance on new agency-ledger booking insert
--    Runs AFTER sync_agency_ledger inserts a real booking row;
--    consumes ADVANCE entries (FIFO) by reducing their received_amount
--    and topping up this new booking's received_amount.
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_apply_agent_advance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_advance numeric;
  v_due numeric;
  v_take numeric;
  v_applied numeric := 0;
  v_adv record;
  v_remaining numeric;
BEGIN
  -- Skip ADVANCE entries themselves, and payment-only entries
  IF UPPER(COALESCE(NEW.service_type, '')) IN ('ADVANCE','PAYMENT','OPENING') THEN
    RETURN NEW;
  END IF;

  v_due := COALESCE(NEW.total_bill,0) - COALESCE(NEW.received_amount,0);
  IF v_due <= 0 THEN RETURN NEW; END IF;

  -- Total available advance for this agent
  SELECT GREATEST(COALESCE(SUM(received_amount),0) - COALESCE(SUM(total_bill),0), 0)
    INTO v_advance
  FROM public.agency_ledger
  WHERE agent_name = NEW.agent_name
    AND id <> NEW.id;

  IF v_advance <= 0 THEN RETURN NEW; END IF;

  v_take := LEAST(v_advance, v_due);
  v_remaining := v_take;

  -- FIFO drain from advance entries with leftover credit
  FOR v_adv IN
    SELECT id, total_bill, received_amount,
           (COALESCE(received_amount,0) - COALESCE(total_bill,0)) AS credit
    FROM public.agency_ledger
    WHERE agent_name = NEW.agent_name
      AND id <> NEW.id
      AND COALESCE(received_amount,0) > COALESCE(total_bill,0)
    ORDER BY entry_date ASC, created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    DECLARE
      v_chunk numeric := LEAST(v_adv.credit, v_remaining);
    BEGIN
      UPDATE public.agency_ledger
        SET received_amount = COALESCE(received_amount,0) - v_chunk,
            updated_at = now()
      WHERE id = v_adv.id;
      v_remaining := v_remaining - v_chunk;
    END;
  END LOOP;

  v_applied := v_take - v_remaining;
  IF v_applied > 0 THEN
    UPDATE public.agency_ledger
      SET received_amount = COALESCE(received_amount,0) + v_applied,
          remarks = COALESCE(remarks || ' · ', '') || 'Auto-adjusted from advance: ৳' || v_applied::text,
          updated_at = now()
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_apply_agent_advance_trg ON public.agency_ledger;
CREATE TRIGGER auto_apply_agent_advance_trg
  AFTER INSERT ON public.agency_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_apply_agent_advance();

-- ============================================================
-- 5. Auto-adjust advance on new vendor-ledger booking insert
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_apply_vendor_advance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_advance numeric;
  v_due numeric;
  v_take numeric;
  v_applied numeric := 0;
  v_adv record;
  v_remaining numeric;
BEGIN
  IF UPPER(COALESCE(NEW.service_type, '')) IN ('ADVANCE','PAYMENT','OPENING') THEN
    RETURN NEW;
  END IF;

  v_due := COALESCE(NEW.total_payable,0) - COALESCE(NEW.paid_amount,0);
  IF v_due <= 0 THEN RETURN NEW; END IF;

  SELECT GREATEST(COALESCE(SUM(paid_amount),0) - COALESCE(SUM(total_payable),0), 0)
    INTO v_advance
  FROM public.vendor_ledger
  WHERE vendor_name = NEW.vendor_name
    AND id <> NEW.id;

  IF v_advance <= 0 THEN RETURN NEW; END IF;

  v_take := LEAST(v_advance, v_due);
  v_remaining := v_take;

  FOR v_adv IN
    SELECT id, total_payable, paid_amount,
           (COALESCE(paid_amount,0) - COALESCE(total_payable,0)) AS credit
    FROM public.vendor_ledger
    WHERE vendor_name = NEW.vendor_name
      AND id <> NEW.id
      AND COALESCE(paid_amount,0) > COALESCE(total_payable,0)
    ORDER BY entry_date ASC, created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    DECLARE
      v_chunk numeric := LEAST(v_adv.credit, v_remaining);
    BEGIN
      UPDATE public.vendor_ledger
        SET paid_amount = COALESCE(paid_amount,0) - v_chunk,
            updated_at = now()
      WHERE id = v_adv.id;
      v_remaining := v_remaining - v_chunk;
    END;
  END LOOP;

  v_applied := v_take - v_remaining;
  IF v_applied > 0 THEN
    UPDATE public.vendor_ledger
      SET paid_amount = COALESCE(paid_amount,0) + v_applied,
          remarks = COALESCE(remarks || ' · ', '') || 'Auto-adjusted from advance: ৳' || v_applied::text,
          updated_at = now()
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_apply_vendor_advance_trg ON public.vendor_ledger;
CREATE TRIGGER auto_apply_vendor_advance_trg
  AFTER INSERT ON public.vendor_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_apply_vendor_advance();
