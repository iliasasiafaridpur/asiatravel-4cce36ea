
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tickets','bmet_cards','saudi_visas','kuwait_visas']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_cleanup_ledgers ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_cleanup_ledgers BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.cleanup_ledgers_on_delete()', t);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_cleanup_receipts ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_cleanup_receipts BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.cleanup_service_receipts()', t);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_agency_ledger ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_sync_agency_ledger AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.sync_agency_ledger()', t);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_vendor_ledger ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_sync_vendor_ledger AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.sync_vendor_ledger()', t);

    EXECUTE format('DROP TRIGGER IF EXISTS trg_sync_service_receipt ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_sync_service_receipt AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.sync_service_receipt()', t);
  END LOOP;
END $$;
