ALTER TABLE public.bmet_cards ADD COLUMN IF NOT EXISTS without_passport boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.bmet_without_passport_autodeliver()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_due numeric;
BEGIN
  -- For "Without Passport" BMET jobs there is no card to hand over, so
  -- receiving a payment itself completes the job (delivery status auto-set).
  IF NEW.without_passport IS TRUE
     AND COALESCE(NEW.cancelled, false) = false
     AND COALESCE(NEW.received_amount, 0) > 0
     AND NEW.delivery_date IS NULL THEN
    NEW.delivery_date := CURRENT_DATE;
    v_due := COALESCE(NEW.sold_price, 0) - COALESCE(NEW.received_amount, 0) - COALESCE(NEW.discount_amount, 0);
    NEW.status := CASE WHEN v_due > 0 THEN 'Delivery But Due' ELSE 'Delivered' END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bmet_without_passport_autodeliver ON public.bmet_cards;
CREATE TRIGGER trg_bmet_without_passport_autodeliver
BEFORE INSERT OR UPDATE ON public.bmet_cards
FOR EACH ROW EXECUTE FUNCTION public.bmet_without_passport_autodeliver();