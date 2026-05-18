-- Auto-apply Advance to bills in vendor/agent balance calculations (Option A)
-- Pure calculation — no data mutation. Advance is consumed FIFO conceptually
-- by outstanding bill dues; the dashboard reflects the net state.

CREATE OR REPLACE FUNCTION public.get_vendor_balances()
 RETURNS TABLE(vendor_name text, total_payable numeric, total_paid numeric, balance_due numeric, advance_balance numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH bills AS (
    SELECT vendor_name,
           COALESCE(SUM(total_payable),0) AS bill,
           COALESCE(SUM(paid_amount),0)   AS paid_on_bills
      FROM public.vendor_ledger
     WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','OPENING')
     GROUP BY vendor_name
  ),
  adv AS (
    SELECT vendor_name,
           COALESCE(SUM(paid_amount),0) AS advance_in
      FROM public.vendor_ledger
     WHERE UPPER(COALESCE(service_type,'')) = 'ADVANCE'
     GROUP BY vendor_name
  ),
  names AS (
    SELECT vendor_name FROM bills UNION SELECT vendor_name FROM adv
  ),
  calc AS (
    SELECT n.vendor_name,
           COALESCE(b.bill,0) AS bill,
           COALESCE(b.paid_on_bills,0) AS paid_on_bills,
           COALESCE(a.advance_in,0) AS advance_in,
           GREATEST(COALESCE(b.bill,0) - COALESCE(b.paid_on_bills,0), 0) AS bill_due_raw
      FROM names n
      LEFT JOIN bills b ON b.vendor_name = n.vendor_name
      LEFT JOIN adv   a ON a.vendor_name = n.vendor_name
  )
  SELECT c.vendor_name,
         c.bill                                                AS total_payable,
         c.paid_on_bills + LEAST(c.advance_in, c.bill_due_raw) AS total_paid,
         c.bill_due_raw - LEAST(c.advance_in, c.bill_due_raw)  AS balance_due,
         c.advance_in - LEAST(c.advance_in, c.bill_due_raw)    AS advance_balance
    FROM calc c;
$function$;

CREATE OR REPLACE FUNCTION public.get_agent_balances()
 RETURNS TABLE(agent_name text, total_bill numeric, total_received numeric, balance_due numeric, advance_balance numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH bills AS (
    SELECT agent_name,
           COALESCE(SUM(total_bill),0)      AS bill,
           COALESCE(SUM(received_amount),0) AS paid_on_bills
      FROM public.agency_ledger
     WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','OPENING')
     GROUP BY agent_name
  ),
  adv AS (
    SELECT agent_name,
           COALESCE(SUM(received_amount),0) AS advance_in
      FROM public.agency_ledger
     WHERE UPPER(COALESCE(service_type,'')) = 'ADVANCE'
     GROUP BY agent_name
  ),
  names AS (
    SELECT agent_name FROM bills UNION SELECT agent_name FROM adv
  ),
  calc AS (
    SELECT n.agent_name,
           COALESCE(b.bill,0) AS bill,
           COALESCE(b.paid_on_bills,0) AS paid_on_bills,
           COALESCE(a.advance_in,0) AS advance_in,
           GREATEST(COALESCE(b.bill,0) - COALESCE(b.paid_on_bills,0), 0) AS bill_due_raw
      FROM names n
      LEFT JOIN bills b ON b.agent_name = n.agent_name
      LEFT JOIN adv   a ON a.agent_name = n.agent_name
  )
  SELECT c.agent_name,
         c.bill                                                AS total_bill,
         c.paid_on_bills + LEAST(c.advance_in, c.bill_due_raw) AS total_received,
         c.bill_due_raw - LEAST(c.advance_in, c.bill_due_raw)  AS balance_due,
         c.advance_in - LEAST(c.advance_in, c.bill_due_raw)    AS advance_balance
    FROM calc c;
$function$;