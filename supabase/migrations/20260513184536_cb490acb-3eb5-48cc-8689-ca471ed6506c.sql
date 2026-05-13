CREATE OR REPLACE FUNCTION public.next_module_id(_prefix text, _table text, _column text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  full_prefix text;
  last_seq integer;
  next_seq integer;
  q text;
BEGIN
  full_prefix := _prefix || '-' || to_char(now(), 'YYMM') || '-';
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
$$;

CREATE OR REPLACE FUNCTION public.next_simple_id(_prefix text, _table text, _column text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_seq integer;
  next_seq integer;
  q text;
BEGIN
  q := format(
    'SELECT COALESCE(MAX(CAST(split_part(%I, ''-'', 2) AS integer)), 0)
       FROM public.%I
      WHERE %I LIKE $1
        AND split_part(%I, ''-'', 2) ~ ''^[0-9]{3}$''',
    _column, _table, _column, _column
  );
  EXECUTE q INTO last_seq USING _prefix || '-%';
  next_seq := LEAST(last_seq + 1, 999);
  RETURN _prefix || '-' || lpad(next_seq::text, 3, '0');
END;
$$;