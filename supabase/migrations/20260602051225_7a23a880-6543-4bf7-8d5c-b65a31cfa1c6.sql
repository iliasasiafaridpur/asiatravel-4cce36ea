CREATE OR REPLACE FUNCTION public.get_vendor_balances()
 RETURNS TABLE(vendor_name text, total_payable numeric, total_paid numeric, balance_due numeric, advance_balance numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH eligible AS (
    -- A sourced bill (BMET/Saudi/Kuwait) counts only once received from the
    -- vendor (Received Date From Vendor set). Non-sourced rows always count.
    SELECT vl.*,
           CASE
             WHEN vl.source_table = 'bmet_cards'   THEN (SELECT bc.received_date IS NOT NULL FROM public.bmet_cards bc  WHERE bc.id = vl.source_id)
             WHEN vl.source_table = 'saudi_visas'  THEN (SELECT sv.received_date IS NOT NULL FROM public.saudi_visas sv WHERE sv.id = vl.source_id)
             WHEN vl.source_table = 'kuwait_visas' THEN (SELECT kv.received_date IS NOT NULL FROM public.kuwait_visas kv WHERE kv.id = vl.source_id)
             ELSE true
           END AS counts
      FROM public.vendor_ledger vl
  ), bills AS (
    SELECT vendor_name,
           COALESCE(SUM(total_payable),0) AS bill,
           COALESCE(SUM(paid_amount),0) AS cash_paid,
           COALESCE(SUM(advance_applied),0) AS advance_used
      FROM eligible
     WHERE UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','OPENING','PAYMENT')
       AND COALESCE(counts, true) = true
     GROUP BY vendor_name
  ), adv AS (
    SELECT vendor_name,
           COALESCE(SUM(paid_amount),0) AS advance_in
      FROM eligible
     WHERE UPPER(COALESCE(service_type,'')) = 'ADVANCE'
     GROUP BY vendor_name
  ), names AS (
    SELECT vendor_name FROM bills UNION SELECT vendor_name FROM adv
  )
  SELECT n.vendor_name,
         COALESCE(b.bill,0) AS total_payable,
         COALESCE(b.cash_paid,0) + COALESCE(b.advance_used,0) AS total_paid,
         GREATEST(COALESCE(b.bill,0) - COALESCE(b.cash_paid,0) - COALESCE(b.advance_used,0), 0) AS balance_due,
         GREATEST(COALESCE(a.advance_in,0) - COALESCE(b.advance_used,0), 0) AS advance_balance
    FROM names n
    LEFT JOIN bills b ON b.vendor_name = n.vendor_name
    LEFT JOIN adv a ON a.vendor_name = n.vendor_name;
$function$;