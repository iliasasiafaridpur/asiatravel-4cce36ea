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

  -- Reset every applied advance (including any that mistakenly landed on
  -- adjustment rows) so we can redistribute cleanly below.
  UPDATE public.vendor_ledger
     SET advance_applied = 0,
         updated_at = now()
   WHERE vendor_name = _vendor_name
     AND UPPER(COALESCE(service_type, '')) NOT IN ('ADVANCE', 'OPENING', 'PAYMENT')
     AND COALESCE(advance_applied, 0) <> 0;

  FOR v_bill IN
    SELECT id, total_payable, paid_amount
      FROM public.vendor_ledger
     WHERE vendor_name = _vendor_name
       AND UPPER(COALESCE(service_type, '')) NOT IN ('ADVANCE', 'OPENING', 'PAYMENT')
       AND COALESCE(service_type, '') <> 'Account Adjustment'
     ORDER BY entry_date ASC, created_at ASC, id ASC
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

CREATE OR REPLACE FUNCTION public.auto_apply_vendor_advance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Account-adjustment (opening / old-due) entries must never absorb advance.
  IF COALESCE(NEW.service_type, '') = 'Account Adjustment' THEN
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
$function$;