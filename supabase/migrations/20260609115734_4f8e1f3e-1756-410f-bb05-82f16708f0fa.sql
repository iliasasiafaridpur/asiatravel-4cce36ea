REVOKE ALL ON FUNCTION public.rename_party(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rename_party(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rename_party(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_party(text, text, text) TO service_role;