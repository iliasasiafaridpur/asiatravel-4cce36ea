
DROP TRIGGER IF EXISTS auto_apply_vendor_advance_trg ON public.vendor_ledger;
DROP TRIGGER IF EXISTS auto_apply_agent_advance_trg  ON public.agency_ledger;

DELETE FROM public.cash_expenses
 WHERE category = 'Vendor Payment'
   AND linked_source_id IS NULL
   AND COALESCE(remarks,'') ILIKE '%Alloc:%';

DELETE FROM public.payment_receipts
 WHERE source = 'manual'
   AND service_type ILIKE 'Agent%'
   AND service_row_id IS NULL
   AND COALESCE(remarks,'') ILIKE '%Alloc:%';

CREATE OR REPLACE FUNCTION public.get_vendor_balances()
 RETURNS TABLE(vendor_name text, total_payable numeric, total_paid numeric, balance_due numeric, advance_balance numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
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
  )
  SELECT n.vendor_name,
         COALESCE(b.bill,0)          AS total_payable,
         COALESCE(b.paid_on_bills,0) AS total_paid,
         GREATEST(COALESCE(b.bill,0) - COALESCE(b.paid_on_bills,0), 0) AS balance_due,
         COALESCE(a.advance_in,0)    AS advance_balance
    FROM names n
    LEFT JOIN bills b ON b.vendor_name = n.vendor_name
    LEFT JOIN adv   a ON a.vendor_name = n.vendor_name;
$$;

CREATE OR REPLACE FUNCTION public.get_agent_balances()
 RETURNS TABLE(agent_name text, total_bill numeric, total_received numeric, balance_due numeric, advance_balance numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH bills AS (
    SELECT agent_name,
           COALESCE(SUM(total_bill),0)       AS bill,
           COALESCE(SUM(received_amount),0)  AS paid_on_bills
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
  )
  SELECT n.agent_name,
         COALESCE(b.bill,0)          AS total_bill,
         COALESCE(b.paid_on_bills,0) AS total_received,
         GREATEST(COALESCE(b.bill,0) - COALESCE(b.paid_on_bills,0), 0) AS balance_due,
         COALESCE(a.advance_in,0)    AS advance_balance
    FROM names n
    LEFT JOIN bills b ON b.agent_name = n.agent_name
    LEFT JOIN adv   a ON a.agent_name = n.agent_name;
$$;
