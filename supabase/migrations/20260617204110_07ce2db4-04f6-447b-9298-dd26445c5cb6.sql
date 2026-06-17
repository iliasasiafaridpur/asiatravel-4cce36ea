-- Internal system cleanup helpers used by the status-change workflow.
-- These run as SECURITY DEFINER so they bypass the new owner-only DELETE RLS:
-- reverting a file's status is a system accounting action, not a personal
-- "delete someone else's entry" action.

CREATE OR REPLACE FUNCTION public.revert_service_receipts(_service_table text, _service_row_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  DELETE FROM public.payment_receipts
   WHERE service_table = _service_table
     AND service_row_id = _service_row_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_vendor_ledger_by_source(_source_table text, _source_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  DELETE FROM public.vendor_ledger
   WHERE source_table = _source_table
     AND source_id = _source_id;
END;
$function$;