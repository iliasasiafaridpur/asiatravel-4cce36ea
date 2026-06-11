-- 1) Stop creating "opening" marker rows when a new agent/vendor account is created.
--    These zero-value rows are no longer wanted anywhere in the app.
CREATE OR REPLACE FUNCTION public.open_agent_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Account-open marker rows are intentionally not created anymore.
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.open_vendor_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Account-open marker rows are intentionally not created anymore.
  RETURN NEW;
END;
$function$;

-- 1b) Remove all existing "opening" marker rows (zero bill / zero received).
DELETE FROM public.agency_ledger WHERE service_type = 'opening';
DELETE FROM public.vendor_ledger WHERE service_type = 'opening';

-- 5) Route the MD's own receipts through the cash-handover flow, exactly like any
--    other user. Previously MD receipts were auto-approved and bypassed handover,
--    so the MD could not hand over (and self-approve) cash they received directly
--    from customers. Now every fresh receipt is pending until handover approval.
CREATE OR REPLACE FUNCTION public.set_receipt_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Locked into a handover: keep its existing approval untouched.
  IF NEW.handover_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  NEW.approval_status := 'pending_md';
  NEW.approved_by := NULL;
  NEW.approved_at := NULL;
  RETURN NEW;
END;
$function$;