CREATE OR REPLACE FUNCTION public.rename_party(p_kind text, p_old_name text, p_new_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text := trim(p_old_name);
  v_new text := trim(p_new_name);
BEGIN
  IF v_new IS NULL OR length(v_new) = 0 THEN
    RAISE EXCEPTION 'New name cannot be empty';
  END IF;
  IF v_old IS NULL OR length(v_old) = 0 OR v_old = v_new THEN
    RETURN;
  END IF;

  IF p_kind = 'customer' THEN
    UPDATE public.tickets        SET agency_sold = v_new WHERE btrim(agency_sold) = v_old;
    UPDATE public.bmet_cards     SET agency_sold = v_new WHERE btrim(agency_sold) = v_old;
    UPDATE public.saudi_visas    SET agency_sold = v_new WHERE btrim(agency_sold) = v_old;
    UPDATE public.kuwait_visas   SET agency_sold = v_new WHERE btrim(agency_sold) = v_old;
    UPDATE public.others         SET agency_sold = v_new WHERE btrim(agency_sold) = v_old;
    UPDATE public.extra_services SET agency_sold = v_new WHERE btrim(agency_sold) = v_old;
    UPDATE public.agency_ledger  SET agent_name  = v_new WHERE btrim(agent_name)  = v_old;
    UPDATE public.payment_receipts SET agent_name = v_new WHERE btrim(agent_name) = v_old;
    UPDATE public.agents SET name = v_new WHERE btrim(name) = v_old;
    INSERT INTO public.lookups (kind, value)
    SELECT 'sub_agency', v_new
    WHERE NOT EXISTS (
      SELECT 1 FROM public.lookups WHERE kind = 'sub_agency' AND value = v_new
    );
    DELETE FROM public.lookups WHERE kind = 'sub_agency' AND btrim(value) = v_old AND value <> v_new;
  ELSIF p_kind = 'vendor' THEN
    UPDATE public.tickets        SET vendor_bought = v_new WHERE btrim(vendor_bought) = v_old;
    UPDATE public.bmet_cards     SET vendor_bought = v_new WHERE btrim(vendor_bought) = v_old;
    UPDATE public.saudi_visas    SET vendor_bought = v_new WHERE btrim(vendor_bought) = v_old;
    UPDATE public.kuwait_visas   SET vendor_bought = v_new WHERE btrim(vendor_bought) = v_old;
    UPDATE public.others         SET vendor_bought = v_new WHERE btrim(vendor_bought) = v_old;
    UPDATE public.extra_services SET vendor_name   = v_new WHERE btrim(vendor_name)   = v_old;
    UPDATE public.vendor_ledger  SET vendor_name   = v_new WHERE btrim(vendor_name)   = v_old;
    UPDATE public.payment_receipts SET vendor_name = v_new WHERE btrim(vendor_name) = v_old;
    UPDATE public.vendors SET name = v_new WHERE btrim(name) = v_old;
    INSERT INTO public.lookups (kind, value)
    SELECT 'vendor', v_new
    WHERE NOT EXISTS (
      SELECT 1 FROM public.lookups WHERE kind = 'vendor' AND value = v_new
    );
    DELETE FROM public.lookups WHERE kind = 'vendor' AND btrim(value) = v_old AND value <> v_new;
  ELSE
    RAISE EXCEPTION 'Invalid kind: %', p_kind;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_party(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rename_party(text, text, text) TO authenticated;