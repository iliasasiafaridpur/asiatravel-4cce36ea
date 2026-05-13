CREATE OR REPLACE FUNCTION public.cleanup_service_receipts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  service_ref text;
  service_name text;
BEGIN
  IF TG_TABLE_NAME = 'tickets' THEN
    service_ref := OLD.ticket_id;
    service_name := 'Ticket';
  ELSIF TG_TABLE_NAME = 'bmet_cards' THEN
    service_ref := OLD.bmet_id;
    service_name := 'BMET Card';
  ELSIF TG_TABLE_NAME = 'saudi_visas' THEN
    service_ref := OLD.saudi_id;
    service_name := 'Saudi Visa';
  ELSIF TG_TABLE_NAME = 'kuwait_visas' THEN
    service_ref := OLD.kuwait_id;
    service_name := 'Kuwait Visa';
  END IF;

  DELETE FROM public.payment_receipts
   WHERE service_row_id = OLD.id
      OR (service_ref IS NOT NULL AND ref_id = service_ref)
      OR (service_ref IS NOT NULL AND ref_id = service_ref AND service_type = service_name);

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_receipts ON public.tickets;
CREATE TRIGGER trg_cleanup_receipts
  BEFORE DELETE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_service_receipts();

DROP TRIGGER IF EXISTS trg_cleanup_receipts ON public.bmet_cards;
CREATE TRIGGER trg_cleanup_receipts
  BEFORE DELETE ON public.bmet_cards
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_service_receipts();

DROP TRIGGER IF EXISTS trg_cleanup_receipts ON public.saudi_visas;
CREATE TRIGGER trg_cleanup_receipts
  BEFORE DELETE ON public.saudi_visas
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_service_receipts();

DROP TRIGGER IF EXISTS trg_cleanup_receipts ON public.kuwait_visas;
CREATE TRIGGER trg_cleanup_receipts
  BEFORE DELETE ON public.kuwait_visas
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_service_receipts();