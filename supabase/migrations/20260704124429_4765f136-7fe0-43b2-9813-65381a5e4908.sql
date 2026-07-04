CREATE OR REPLACE FUNCTION public.recalculate_agent_advance(_agent_name text)
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
  v_settle_mode text;
BEGIN
  IF _agent_name IS NULL OR length(trim(_agent_name)) = 0 THEN
    RETURN;
  END IF;

  SELECT CASE WHEN bool_or(settle_mode = 'one_by_one') THEN 'one_by_one' ELSE 'total' END
    INTO v_settle_mode
  FROM public.agents
  WHERE name = _agent_name;

  -- Bill-by-bill agents must not silently receive FIFO advance allocations.
  -- Their advance stays visible as an advance balance, and each bill remains
  -- individually due until that exact bill receives payment.
  IF COALESCE(v_settle_mode, 'total') = 'one_by_one' THEN
    UPDATE public.agency_ledger
       SET advance_applied = 0,
           updated_at = now()
     WHERE agent_name = _agent_name
       AND COALESCE(advance_applied, 0) <> 0;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(received_amount), 0)
    INTO v_remaining
  FROM public.agency_ledger
  WHERE agent_name = _agent_name
    AND UPPER(COALESCE(service_type, '')) = 'ADVANCE';

  UPDATE public.agency_ledger
     SET advance_applied = 0,
         updated_at = now()
   WHERE agent_name = _agent_name
     AND UPPER(COALESCE(service_type, '')) NOT IN ('ADVANCE', 'PAYMENT')
     AND COALESCE(advance_applied, 0) <> 0;

  FOR v_bill IN
    SELECT id, total_bill, received_amount, discount_amount
      FROM public.agency_ledger
     WHERE agent_name = _agent_name
       AND UPPER(COALESCE(service_type, '')) NOT IN ('ADVANCE', 'PAYMENT')
     ORDER BY entry_date ASC, created_at ASC, id ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_due := GREATEST(COALESCE(v_bill.total_bill, 0) - COALESCE(v_bill.received_amount, 0) - COALESCE(v_bill.discount_amount, 0), 0);
    IF v_due <= 0 THEN
      CONTINUE;
    END IF;

    v_take := LEAST(v_remaining, v_due);
    UPDATE public.agency_ledger
       SET advance_applied = v_take,
           updated_at = now()
     WHERE id = v_bill.id;
    v_remaining := v_remaining - v_take;
  END LOOP;
END;
$function$;

-- Recalculate existing agents once so old auto-FIFO allocations follow the
-- saved হিসাব ধরন immediately.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT agent_name
    FROM public.agency_ledger
    WHERE NULLIF(btrim(agent_name), '') IS NOT NULL
  LOOP
    PERFORM public.recalculate_agent_advance(r.agent_name);
  END LOOP;
END $$;