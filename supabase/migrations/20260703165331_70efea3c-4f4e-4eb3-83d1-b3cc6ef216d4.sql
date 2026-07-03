-- Fix historical BMET card statuses so "Delivered" and "Delivery But Due"
-- are two distinct states, matching the actual outstanding due of each card.
-- Delivered cards that still have an outstanding balance become "Delivery But Due".
UPDATE public.bmet_cards
SET status = 'Delivery But Due'
WHERE cancelled IS NOT TRUE
  AND delivery_date IS NOT NULL
  AND status = 'Delivered'
  AND (COALESCE(sold_price,0) - COALESCE(received_amount,0) - COALESCE(discount_amount,0)) > 0;

-- Cards marked "Delivery But Due" that are now fully paid become "Delivered".
UPDATE public.bmet_cards
SET status = 'Delivered'
WHERE cancelled IS NOT TRUE
  AND delivery_date IS NOT NULL
  AND status = 'Delivery But Due'
  AND (COALESCE(sold_price,0) - COALESCE(received_amount,0) - COALESCE(discount_amount,0)) <= 0;