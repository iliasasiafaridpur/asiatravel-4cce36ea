CREATE OR REPLACE FUNCTION public.rename_lookup(p_kind text, p_old_value text, p_new_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text := btrim(p_old_value);
  v_new text := btrim(p_new_value);
BEGIN
  IF v_new IS NULL OR length(v_new) = 0 THEN
    RAISE EXCEPTION 'New value cannot be empty';
  END IF;
  IF v_old IS NULL OR length(v_old) = 0 OR v_old = v_new THEN
    RETURN;
  END IF;

  -- Party kinds (agency / vendor) must go through rename_party, which also
  -- cascades to the agents/vendors identity tables and both ledgers.
  IF p_kind IN ('sub_agency', 'vendor') THEN
    RAISE EXCEPTION 'Use rename_party for party kinds';
  END IF;

  -- 1) Propagate the rename to every data column that stores this text value,
  --    so existing bookings are not left pointing at the old name.
  IF p_kind = 'country' THEN
    UPDATE public.bmet_cards SET country_name = v_new WHERE btrim(country_name) = v_old;

  ELSIF p_kind = 'airline' THEN
    UPDATE public.tickets SET airline = v_new WHERE btrim(airline) = v_old;
    UPDATE public.others  SET airline = v_new WHERE btrim(airline) = v_old;

  ELSIF p_kind = 'route' THEN
    UPDATE public.tickets       SET trip_road     = v_new WHERE btrim(trip_road)     = v_old;
    UPDATE public.others        SET trip_road     = v_new WHERE btrim(trip_road)     = v_old;
    UPDATE public.others        SET country_route = v_new WHERE btrim(country_route) = v_old;
    UPDATE public.agency_ledger SET country_route = v_new WHERE btrim(country_route) = v_old;
    UPDATE public.vendor_ledger SET country_route = v_new WHERE btrim(country_route) = v_old;

  ELSIF p_kind = 'visa_type' THEN
    UPDATE public.saudi_visas SET visa_type = v_new WHERE btrim(visa_type) = v_old;

  ELSIF p_kind = 'medical_status' THEN
    UPDATE public.saudi_visas  SET medical_status = v_new WHERE btrim(medical_status) = v_old;
    UPDATE public.kuwait_visas SET medical_status = v_new WHERE btrim(medical_status) = v_old;

  ELSIF p_kind = 'rl_no' THEN
    UPDATE public.saudi_visas SET rl_no = v_new WHERE btrim(rl_no) = v_old;

  ELSIF p_kind = 'other_service' THEN
    UPDATE public.others         SET service_name = v_new WHERE btrim(service_name) = v_old;
    UPDATE public.extra_services SET service_name = v_new WHERE btrim(service_name) = v_old;
  END IF;
  -- NOTE: status_* and ledger_service_type kinds are intentionally NOT
  -- auto-propagated here, because app + accounting logic keys off specific
  -- status/type strings; renaming their data columns could corrupt state.

  -- 2) Update the lookups table itself (add new, drop old).
  INSERT INTO public.lookups (kind, value)
  SELECT p_kind, v_new
  WHERE NOT EXISTS (
    SELECT 1 FROM public.lookups WHERE kind = p_kind AND value = v_new
  );
  DELETE FROM public.lookups WHERE kind = p_kind AND btrim(value) = v_old AND value <> v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.rename_lookup(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rename_lookup(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rename_lookup(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_lookup(text, text, text) TO service_role;