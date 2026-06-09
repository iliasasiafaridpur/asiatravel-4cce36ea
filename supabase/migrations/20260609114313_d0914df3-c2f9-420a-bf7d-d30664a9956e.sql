CREATE OR REPLACE FUNCTION public.rename_party(p_kind text, p_old_name text, p_new_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text := p_old_name;
  v_new text := trim(p_new_name);
BEGIN
  IF v_new IS NULL OR length(v_new) = 0 THEN
    RAISE EXCEPTION 'New name cannot be empty';
  END IF;
  IF v_old IS NULL OR v_old = v_new THEN
    RETURN;
  END IF;

  IF p_kind = 'customer' THEN
    UPDATE public.tickets        SET agency_sold = v_new WHERE agency_sold = v_old;
    UPDATE public.bmet_cards     SET agency_sold = v_new WHERE agency_sold = v_old;
    UPDATE public.saudi_visas    SET agency_sold = v_new WHERE agency_sold = v_old;
    UPDATE public.kuwait_visas   SET agency_sold = v_new WHERE agency_sold = v_old;
    UPDATE public.others         SET agency_sold = v_new WHERE agency_sold = v_old;
    UPDATE public.extra_services SET agency_sold = v_new WHERE agency_sold = v_old;
    UPDATE public.agency_ledger  SET agent_name  = v_new WHERE agent_name  = v_old;
  ELSIF p_kind = 'vendor' THEN
    UPDATE public.tickets        SET vendor_bought = v_new WHERE vendor_bought = v_old;
    UPDATE public.bmet_cards     SET vendor_bought = v_new WHERE vendor_bought = v_old;
    UPDATE public.saudi_visas    SET vendor_bought = v_new WHERE vendor_bought = v_old;
    UPDATE public.kuwait_visas   SET vendor_bought = v_new WHERE vendor_bought = v_old;
    UPDATE public.others         SET vendor_bought = v_new WHERE vendor_bought = v_old;
    UPDATE public.extra_services SET vendor_name   = v_new WHERE vendor_name   = v_old;
    UPDATE public.vendor_ledger  SET vendor_name   = v_new WHERE vendor_name   = v_old;
  ELSE
    RAISE EXCEPTION 'Invalid kind: %', p_kind;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rename_party(text, text, text) TO authenticated;