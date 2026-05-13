-- 1) Allow multiple due-receive payments per service row.
--    The old unique constraint blocked the 2nd payment with "duplicate key" error.
ALTER TABLE public.payment_receipts
  DROP CONSTRAINT IF EXISTS payment_receipts_source_unique;

-- 2) Cascade delete: when a service row is removed, also remove its payment receipts.
CREATE OR REPLACE FUNCTION public.cleanup_service_receipts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.payment_receipts
   WHERE service_row_id = OLD.id;
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