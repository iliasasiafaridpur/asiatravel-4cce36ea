CREATE OR REPLACE FUNCTION public.guard_locked_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_submitted_expense_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_submitted_handover_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_locked_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_acct uuid;
  v_date date;
  v_locked_until date;
BEGIN
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF public.has_role(auth.uid(),'admin') THEN
    RETURN NEW;
  END IF;

  v_acct := NEW.account_id;
  v_date := NEW.entry_date;

  IF v_acct IS NULL OR v_date IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT MAX(closing_date) INTO v_locked_until
    FROM public.daily_cash_closings
    WHERE account_id = v_acct AND is_locked = true;

  IF v_locked_until IS NOT NULL AND v_date <= v_locked_until THEN
    RAISE EXCEPTION 'Date % is locked by day-end closing (locked through %). Admin only.', v_date, v_locked_until
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;