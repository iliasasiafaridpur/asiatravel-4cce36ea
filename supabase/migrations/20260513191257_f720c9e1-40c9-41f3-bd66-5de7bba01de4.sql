CREATE OR REPLACE FUNCTION public.cleanup_deleted_service_accounting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  service_ref text;
BEGIN
  IF TG_TABLE_NAME = 'tickets' THEN
    service_ref := OLD.ticket_id;
  ELSIF TG_TABLE_NAME = 'bmet_cards' THEN
    service_ref := OLD.bmet_id;
  ELSIF TG_TABLE_NAME = 'saudi_visas' THEN
    service_ref := OLD.saudi_id;
  ELSIF TG_TABLE_NAME = 'kuwait_visas' THEN
    service_ref := OLD.kuwait_id;
  ELSE
    service_ref := NULL;
  END IF;

  DELETE FROM public.payment_receipts
   WHERE service_row_id = OLD.id
      OR (service_table = TG_TABLE_NAME AND service_row_id = OLD.id)
      OR (service_ref IS NOT NULL AND ref_id = service_ref);

  DELETE FROM public.agency_ledger
   WHERE (source_table = TG_TABLE_NAME AND source_id = OLD.id)
      OR (service_ref IS NOT NULL AND service_type = TG_TABLE_NAME AND passenger_name = OLD.passenger_name);

  DELETE FROM public.vendor_ledger
   WHERE (source_table = TG_TABLE_NAME AND source_id = OLD.id)
      OR (service_ref IS NOT NULL AND service_type = TG_TABLE_NAME AND passenger_name = OLD.passenger_name);

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tickets_cleanup_deleted_service_accounting ON public.tickets;
CREATE TRIGGER tickets_cleanup_deleted_service_accounting
AFTER DELETE ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_deleted_service_accounting();

DROP TRIGGER IF EXISTS bmet_cards_cleanup_deleted_service_accounting ON public.bmet_cards;
CREATE TRIGGER bmet_cards_cleanup_deleted_service_accounting
AFTER DELETE ON public.bmet_cards
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_deleted_service_accounting();

DROP TRIGGER IF EXISTS saudi_visas_cleanup_deleted_service_accounting ON public.saudi_visas;
CREATE TRIGGER saudi_visas_cleanup_deleted_service_accounting
AFTER DELETE ON public.saudi_visas
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_deleted_service_accounting();

DROP TRIGGER IF EXISTS kuwait_visas_cleanup_deleted_service_accounting ON public.kuwait_visas;
CREATE TRIGGER kuwait_visas_cleanup_deleted_service_accounting
AFTER DELETE ON public.kuwait_visas
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_deleted_service_accounting();