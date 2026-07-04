CREATE OR REPLACE FUNCTION public.next_yearly_id(_prefix text, _table text, _column text, _entry_date date DEFAULT NULL::date)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  full_prefix text;
  last_seq integer;
  next_seq integer;
  q text;
  base_date date;
BEGIN
  base_date := COALESCE(_entry_date, now()::date);
  full_prefix := _prefix || '-' || to_char(base_date, 'YY') || '-';
  q := format(
    'SELECT COALESCE(MAX(CAST(split_part(%I, ''-'', 3) AS integer)), 0)
       FROM public.%I
      WHERE %I LIKE $1
        AND split_part(%I, ''-'', 3) ~ ''^[0-9]{3}$''',
    _column, _table, _column, _column
  );
  EXECUTE q INTO last_seq USING full_prefix || '%';
  next_seq := LEAST(last_seq + 1, 999);
  RETURN full_prefix || lpad(next_seq::text, 3, '0');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.next_yearly_id(text, text, text, date) TO authenticated, anon, service_role;