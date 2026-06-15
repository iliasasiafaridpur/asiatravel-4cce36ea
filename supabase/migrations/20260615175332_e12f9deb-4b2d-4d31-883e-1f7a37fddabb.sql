CREATE OR REPLACE FUNCTION public.recalculate_vendor_advance(_vendor_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Reset every applied advance so we can redistribute cleanly below.
  UPDATE public.vendor_ledger
     SET advance_applied = 0,
         updated_at = now()
   WHERE vendor_name = _vendor_name
     AND UPPER(COALESCE(service_type, '')) NOT IN ('ADVANCE', 'OPENING', 'PAYMENT')
     AND COALESCE(advance_applied, 0) <> 0;

  -- Apply advance ONLY to eligible bills: bills already received from the
  -- vendor (so they actually count in the balance), and never to
  -- account-adjustment / opening rows. This keeps the advance distribution in
  -- lock-step with get_vendor_balances, eliminating phantom shortfalls.
  FOR v_bill IN
    SELECT vl.id, vl.total_payable, vl.paid_amount
      FROM public.vendor_ledger vl
     WHERE vl.vendor_name = _vendor_name
       AND UPPER(COALESCE(vl.service_type, '')) NOT IN ('ADVANCE', 'OPENING', 'PAYMENT')
       AND COALESCE(vl.service_type, '') <> 'Account Adjustment'
       AND CASE
             WHEN vl.source_table = 'bmet_cards'   THEN EXISTS (SELECT 1 FROM public.bmet_cards   bc WHERE bc.id = vl.source_id AND bc.received_date IS NOT NULL)
             WHEN vl.source_table = 'saudi_visas'  THEN EXISTS (SELECT 1 FROM public.saudi_visas  sv WHERE sv.id = vl.source_id AND sv.received_date IS NOT NULL)
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
$function$;

-- One-time re-distribution for every existing vendor so current data is correct.
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN SELECT DISTINCT vendor_name FROM public.vendor_ledger WHERE vendor_name IS NOT NULL LOOP
    PERFORM public.recalculate_vendor_advance(v_name);
  END LOOP;
END $$;