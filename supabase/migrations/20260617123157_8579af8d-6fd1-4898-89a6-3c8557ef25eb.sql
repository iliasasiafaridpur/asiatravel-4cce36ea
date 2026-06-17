ALTER TABLE public.cash_handovers
  ADD COLUMN IF NOT EXISTS accept_token text;

UPDATE public.cash_handovers
   SET accept_token = encode(gen_random_bytes(16), 'hex')
 WHERE accept_token IS NULL;

ALTER TABLE public.cash_handovers
  ALTER COLUMN accept_token SET DEFAULT encode(gen_random_bytes(16), 'hex');

CREATE UNIQUE INDEX IF NOT EXISTS cash_handovers_accept_token_key
  ON public.cash_handovers(accept_token);

CREATE OR REPLACE FUNCTION public.approve_handover_by_token(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_h public.cash_handovers%ROWTYPE;
  v_md uuid;
BEGIN
  IF _token IS NULL OR length(btrim(_token)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
  END IF;

  SELECT * INTO v_h FROM public.cash_handovers WHERE accept_token = _token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_h.status = 'approved' THEN
    RETURN jsonb_build_object(
      'ok', true, 'already', true,
      'from_name', v_h.from_name, 'handover_id', v_h.handover_id,
      'amount', COALESCE(v_h.confirmed_amount, v_h.submitted_amount, v_h.amount),
      'closing_date', v_h.closing_date
    );
  END IF;

  IF v_h.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending');
  END IF;

  SELECT user_id INTO v_md FROM public.profiles WHERE role = 'md' LIMIT 1;

  UPDATE public.cash_handovers
     SET status = 'approved',
         confirmed_amount = COALESCE(submitted_amount, amount),
         amount = COALESCE(submitted_amount, amount),
         approved_by = v_md,
         approved_at = now(),
         updated_at = now()
   WHERE id = v_h.id;

  UPDATE public.payment_receipts
     SET approval_status = 'approved',
         approved_by = v_md,
         approved_at = now(),
         updated_at = now()
   WHERE handover_id = v_h.id;

  RETURN jsonb_build_object(
    'ok', true, 'already', false,
    'from_name', v_h.from_name, 'handover_id', v_h.handover_id,
    'amount', COALESCE(v_h.submitted_amount, v_h.amount),
    'closing_date', v_h.closing_date
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.approve_handover_by_token(text) TO service_role;