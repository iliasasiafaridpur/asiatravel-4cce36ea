CREATE OR REPLACE FUNCTION public.assign_agent_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('public.agents.serial_no'));

  IF NEW.serial_no IS NULL THEN
    SELECT COALESCE(MAX(serial_no), 0) + 1
      INTO NEW.serial_no
      FROM public.agents;
  END IF;

  NEW.agent_code := 'AGT-' || lpad(NEW.serial_no::text, 3, '0');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_vendor_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('public.vendors.serial_no'));

  IF NEW.serial_no IS NULL THEN
    SELECT COALESCE(MAX(serial_no), 0) + 1
      INTO NEW.serial_no
      FROM public.vendors;
  END IF;

  NEW.vendor_code := 'VND-' || lpad(NEW.serial_no::text, 3, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agents_serial ON public.agents;
CREATE TRIGGER trg_agents_serial
BEFORE INSERT ON public.agents
FOR EACH ROW
EXECUTE FUNCTION public.assign_agent_identity();

DROP TRIGGER IF EXISTS trg_vendors_serial ON public.vendors;
CREATE TRIGGER trg_vendors_serial
BEFORE INSERT ON public.vendors
FOR EACH ROW
EXECUTE FUNCTION public.assign_vendor_identity();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agents TO authenticated;
GRANT ALL ON public.agents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendors TO authenticated;
GRANT ALL ON public.vendors TO service_role;
GRANT EXECUTE ON FUNCTION public.assign_agent_identity() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_vendor_identity() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_agent_balances()
RETURNS TABLE(agent_name text, total_bill numeric, total_received numeric, balance_due numeric, advance_balance numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH party_names AS (
    SELECT name AS agent_name
      FROM public.agents
     WHERE NULLIF(btrim(name), '') IS NOT NULL
  ), bills AS (
    SELECT agent_name,
           COALESCE(SUM(total_bill),0) AS bill,
           COALESCE(SUM(received_amount),0) AS cash_received,
           COALESCE(SUM(discount_amount),0) AS discount_given,
           COALESCE(SUM(advance_applied),0) AS advance_used
      FROM public.agency_ledger
     WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','OPENING','PAYMENT')
       AND NULLIF(btrim(agent_name), '') IS NOT NULL
     GROUP BY agent_name
  ), adv AS (
    SELECT agent_name,
           COALESCE(SUM(received_amount),0) AS advance_in
      FROM public.agency_ledger
     WHERE UPPER(COALESCE(service_type,'')) = 'ADVANCE'
       AND NULLIF(btrim(agent_name), '') IS NOT NULL
     GROUP BY agent_name
  ), names AS (
    SELECT agent_name FROM party_names
    UNION
    SELECT agent_name FROM bills
    UNION
    SELECT agent_name FROM adv
  )
  SELECT n.agent_name,
         COALESCE(b.bill,0) AS total_bill,
         COALESCE(b.cash_received,0) + COALESCE(b.advance_used,0) AS total_received,
         GREATEST(COALESCE(b.bill,0) - COALESCE(b.cash_received,0) - COALESCE(b.discount_given,0) - COALESCE(b.advance_used,0), 0) AS balance_due,
         GREATEST(COALESCE(a.advance_in,0) - COALESCE(b.advance_used,0), 0) AS advance_balance
    FROM names n
    LEFT JOIN bills b ON b.agent_name = n.agent_name
    LEFT JOIN adv a ON a.agent_name = n.agent_name;
$function$;

CREATE OR REPLACE FUNCTION public.get_vendor_balances()
RETURNS TABLE(vendor_name text, total_payable numeric, total_paid numeric, balance_due numeric, advance_balance numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH party_names AS (
    SELECT name AS vendor_name
      FROM public.vendors
     WHERE NULLIF(btrim(name), '') IS NOT NULL
  ), eligible AS (
    SELECT vl.*,
           CASE
             WHEN vl.source_table = 'bmet_cards'   THEN EXISTS (SELECT 1 FROM public.bmet_cards bc  WHERE bc.id = vl.source_id AND bc.received_date IS NOT NULL)
             WHEN vl.source_table = 'saudi_visas'  THEN EXISTS (SELECT 1 FROM public.saudi_visas sv WHERE sv.id = vl.source_id AND sv.received_date IS NOT NULL)
             WHEN vl.source_table = 'kuwait_visas' THEN EXISTS (SELECT 1 FROM public.kuwait_visas kv WHERE kv.id = vl.source_id AND kv.received_date IS NOT NULL)
             ELSE true
           END AS counts
      FROM public.vendor_ledger vl
     WHERE NULLIF(btrim(vendor_name), '') IS NOT NULL
  ), bills AS (
    SELECT vendor_name,
           COALESCE(SUM(total_payable), 0) AS bill,
           COALESCE(SUM(paid_amount), 0) AS cash_paid,
           COALESCE(SUM(advance_applied), 0) AS advance_used
      FROM eligible
     WHERE UPPER(COALESCE(service_type, '')) NOT IN ('ADVANCE', 'OPENING', 'PAYMENT')
       AND COALESCE(counts, true) = true
     GROUP BY vendor_name
  ), adv AS (
    SELECT vendor_name,
           COALESCE(SUM(paid_amount), 0) AS advance_in
      FROM eligible
     WHERE UPPER(COALESCE(service_type, '')) = 'ADVANCE'
     GROUP BY vendor_name
  ), names AS (
    SELECT vendor_name FROM party_names
    UNION
    SELECT vendor_name FROM bills
    UNION
    SELECT vendor_name FROM adv
  )
  SELECT n.vendor_name,
         COALESCE(b.bill, 0) AS total_payable,
         COALESCE(b.cash_paid, 0) + COALESCE(b.advance_used, 0) AS total_paid,
         GREATEST(COALESCE(b.bill, 0) - COALESCE(b.cash_paid, 0) - COALESCE(b.advance_used, 0), 0) AS balance_due,
         GREATEST(COALESCE(a.advance_in, 0) - COALESCE(b.advance_used, 0), 0) AS advance_balance
    FROM names n
    LEFT JOIN bills b ON b.vendor_name = n.vendor_name
    LEFT JOIN adv a ON a.vendor_name = n.vendor_name;
$function$;

GRANT EXECUTE ON FUNCTION public.get_agent_balances() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_vendor_balances() TO authenticated, service_role;