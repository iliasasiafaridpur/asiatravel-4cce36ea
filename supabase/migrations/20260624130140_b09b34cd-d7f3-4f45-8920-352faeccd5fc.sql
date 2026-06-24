CREATE OR REPLACE FUNCTION public.get_vendor_balances()
RETURNS TABLE(
  vendor_name text,
  total_payable numeric,
  total_paid numeric,
  balance_due numeric,
  advance_balance numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH eligible AS (
    SELECT vl.*,
           CASE
             WHEN vl.source_table = 'bmet_cards'   THEN EXISTS (SELECT 1 FROM public.bmet_cards bc  WHERE bc.id = vl.source_id AND bc.received_date IS NOT NULL)
             WHEN vl.source_table = 'saudi_visas'  THEN EXISTS (SELECT 1 FROM public.saudi_visas sv WHERE sv.id = vl.source_id AND sv.received_date IS NOT NULL)
             WHEN vl.source_table = 'kuwait_visas' THEN EXISTS (SELECT 1 FROM public.kuwait_visas kv WHERE kv.id = vl.source_id AND kv.received_date IS NOT NULL)
             ELSE true
           END AS counts
      FROM public.vendor_ledger vl
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
$$;

CREATE OR REPLACE FUNCTION public.recalculate_vendor_advance(_vendor_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_remaining numeric;
  v_bill record;
  v_due numeric;
  v_take numeric;
BEGIN
  IF _vendor_name IS NULL OR length(trim(_vendor_name)) = 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(paid_amount), 0)
    INTO v_remaining
  FROM public.vendor_ledger
  WHERE vendor_name = _vendor_name
    AND UPPER(COALESCE(service_type, '')) = 'ADVANCE';

  UPDATE public.vendor_ledger
     SET advance_applied = 0,
         updated_at = now()
   WHERE vendor_name = _vendor_name
     AND UPPER(COALESCE(service_type, '')) NOT IN ('ADVANCE', 'OPENING', 'PAYMENT')
     AND COALESCE(advance_applied, 0) <> 0;

  FOR v_bill IN
    SELECT vl.id, vl.total_payable, vl.paid_amount
      FROM public.vendor_ledger vl
     WHERE vl.vendor_name = _vendor_name
       AND UPPER(COALESCE(vl.service_type, '')) NOT IN ('ADVANCE', 'OPENING', 'PAYMENT')
       AND COALESCE(vl.service_type, '') NOT IN ('Account Adjustment', 'Opening Due')
       AND CASE
             WHEN vl.source_table = 'bmet_cards'   THEN EXISTS (SELECT 1 FROM public.bmet_cards bc  WHERE bc.id = vl.source_id AND bc.received_date IS NOT NULL)
             WHEN vl.source_table = 'saudi_visas'  THEN EXISTS (SELECT 1 FROM public.saudi_visas sv WHERE sv.id = vl.source_id AND sv.received_date IS NOT NULL)
             WHEN vl.source_table = 'kuwait_visas' THEN EXISTS (SELECT 1 FROM public.kuwait_visas kv WHERE kv.id = vl.source_id AND kv.received_date IS NOT NULL)
             ELSE true
           END
     ORDER BY vl.entry_date ASC, vl.created_at ASC, vl.id ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_due := GREATEST(COALESCE(v_bill.total_payable, 0) - COALESCE(v_bill.paid_amount, 0), 0);
    IF v_due <= 0 THEN
      CONTINUE;
    END IF;

    v_take := LEAST(v_remaining, v_due);
    UPDATE public.vendor_ledger
       SET advance_applied = v_take,
           updated_at = now()
     WHERE id = v_bill.id;
    v_remaining := v_remaining - v_take;
  END LOOP;
END;
$$;