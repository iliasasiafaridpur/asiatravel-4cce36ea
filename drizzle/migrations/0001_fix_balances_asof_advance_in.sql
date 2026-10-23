CREATE OR REPLACE FUNCTION public.get_party_balances_asof(p_asof date)
RETURNS TABLE(party_kind text, party_name text, balance_due numeric, advance_balance numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH vendor_eligible AS (
    SELECT vl.vendor_name, vl.service_type, vl.total_payable, vl.paid_amount, vl.advance_applied,
           CASE
             WHEN vl.source_table = 'bmet_cards'   THEN EXISTS (SELECT 1 FROM public.bmet_cards bc  WHERE bc.id = vl.source_id AND bc.received_date IS NOT NULL)
             WHEN vl.source_table = 'saudi_visas'  THEN EXISTS (SELECT 1 FROM public.saudi_visas sv WHERE sv.id = vl.source_id AND sv.received_date IS NOT NULL)
             WHEN vl.source_table = 'kuwait_visas' THEN EXISTS (SELECT 1 FROM public.kuwait_visas kv WHERE kv.id = vl.source_id AND kv.received_date IS NOT NULL)
             ELSE true
           END AS counts
      FROM public.vendor_ledger vl
     WHERE vl.entry_date <= p_asof
       AND NULLIF(btrim(vl.vendor_name), '') IS NOT NULL
  ), vendor_bills AS (
    SELECT vendor_name,
           COALESCE(SUM(total_payable), 0) AS bill,
           COALESCE(SUM(paid_amount), 0) AS cash_paid,
           COALESCE(SUM(advance_applied), 0) AS advance_used
      FROM vendor_eligible
     WHERE UPPER(COALESCE(service_type, '')) NOT IN ('ADVANCE', 'OPENING', 'PAYMENT')
       AND COALESCE(counts, true) = true
     GROUP BY vendor_name
  ), vendor_adv AS (
    -- Advance deposits: entry_date ফিল্টার নেই — অ্যাডভান্স পরে (manual_adjust) ঢুকলেও আগের বিলে apply হয়, তাই সব ডিপোজিট গণ্য।
    SELECT vendor_name,
           COALESCE(SUM(paid_amount), 0) AS advance_in
      FROM public.vendor_ledger
     WHERE UPPER(COALESCE(service_type, '')) = 'ADVANCE'
       AND NULLIF(btrim(vendor_name), '') IS NOT NULL
     GROUP BY vendor_name
  ), vendor_names AS (
    SELECT name AS vendor_name FROM public.vendors WHERE NULLIF(btrim(name), '') IS NOT NULL
    UNION
    SELECT vendor_name FROM vendor_bills
    UNION
    SELECT vendor_name FROM vendor_adv
  ), agent_bills AS (
    SELECT agent_name,
           COALESCE(SUM(total_bill),0) AS bill,
           COALESCE(SUM(received_amount),0) AS cash_received,
           COALESCE(SUM(discount_amount),0) AS discount_given,
           COALESCE(SUM(advance_applied),0) AS advance_used
      FROM public.agency_ledger
     WHERE entry_date <= p_asof
       AND UPPER(COALESCE(service_type,'')) NOT IN ('ADVANCE','PAYMENT')
       AND NULLIF(btrim(agent_name), '') IS NOT NULL
     GROUP BY agent_name
  ), agent_adv AS (
    SELECT agent_name,
           COALESCE(SUM(received_amount),0) AS advance_in
      FROM public.agency_ledger
     WHERE UPPER(COALESCE(service_type,'')) = 'ADVANCE'
       AND NULLIF(btrim(agent_name), '') IS NOT NULL
     GROUP BY agent_name
  ), agent_names AS (
    SELECT name AS agent_name FROM public.agents WHERE NULLIF(btrim(name), '') IS NOT NULL
    UNION
    SELECT agent_name FROM agent_bills
    UNION
    SELECT agent_name FROM agent_adv
  )
  SELECT 'vendor' AS party_kind, n.vendor_name AS party_name,
         GREATEST(COALESCE(b.bill, 0) - COALESCE(b.cash_paid, 0) - COALESCE(b.advance_used, 0), 0) AS balance_due,
         GREATEST(COALESCE(a.advance_in, 0) - COALESCE(b.advance_used, 0), 0) AS advance_balance
    FROM vendor_names n
    LEFT JOIN vendor_bills b ON b.vendor_name = n.vendor_name
    LEFT JOIN vendor_adv a ON a.vendor_name = n.vendor_name
  UNION ALL
  SELECT 'agency', n.agent_name,
         GREATEST(COALESCE(b.bill,0) - COALESCE(b.cash_received,0) - COALESCE(b.discount_given,0) - COALESCE(b.advance_used,0), 0),
         GREATEST(COALESCE(a.advance_in,0) - COALESCE(b.advance_used,0), 0)
    FROM agent_names n
    LEFT JOIN agent_bills b ON b.agent_name = n.agent_name
    LEFT JOIN agent_adv a ON a.agent_name = n.agent_name;
$function$;

GRANT EXECUTE ON FUNCTION public.get_party_balances_asof(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_party_balances_asof(date) TO service_role;