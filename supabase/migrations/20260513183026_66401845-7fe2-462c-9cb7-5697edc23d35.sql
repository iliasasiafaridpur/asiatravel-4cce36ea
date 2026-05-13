
CREATE OR REPLACE FUNCTION public.next_module_id(_prefix text, _table text, _column text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  full_prefix TEXT;
  last_seq BIGINT;
  next_id TEXT;
  q TEXT;
BEGIN
  full_prefix := _prefix || '-' || to_char(now(), 'YYMM') || '-';
  q := format(
    'SELECT COALESCE(MAX(CASE WHEN split_part(%I, ''-'', 3) ~ ''^[0-9]+$'' AND length(split_part(%I, ''-'', 3)) <= 6 THEN CAST(split_part(%I, ''-'', 3) AS BIGINT) ELSE 0 END), 0) FROM public.%I WHERE %I LIKE $1',
    _column, _column, _column, _table, _column
  );
  EXECUTE q INTO last_seq USING full_prefix || '%';
  next_id := full_prefix || lpad((last_seq + 1)::TEXT, 3, '0');
  RETURN next_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.next_simple_id(_prefix text, _table text, _column text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  last_seq BIGINT;
  q TEXT;
BEGIN
  q := format(
    'SELECT COALESCE(MAX(CASE WHEN split_part(%I, ''-'', 2) ~ ''^[0-9]+$'' AND length(split_part(%I, ''-'', 2)) <= 6 THEN CAST(split_part(%I, ''-'', 2) AS BIGINT) ELSE 0 END), 0) FROM public.%I WHERE %I LIKE $1',
    _column, _column, _column, _table, _column
  );
  EXECUTE q INTO last_seq USING _prefix || '-%';
  RETURN _prefix || '-' || lpad((last_seq + 1)::TEXT, 3, '0');
END;
$function$;
