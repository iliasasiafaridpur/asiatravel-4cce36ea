DO $$
DECLARE
  t text;
  tables text[] := ARRAY['tickets','bmet_cards','saudi_visas','kuwait_visas','vendor_ledger','agency_ledger','payment_receipts','cash_handovers','cash_expenses','passengers','agents','vendors'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_log_activity ON public.%I', t);
  END LOOP;
END $$;

ALTER PUBLICATION supabase_realtime DROP TABLE public.activity_logs;
DROP FUNCTION IF EXISTS public.log_activity() CASCADE;
DROP TABLE IF EXISTS public.activity_logs;