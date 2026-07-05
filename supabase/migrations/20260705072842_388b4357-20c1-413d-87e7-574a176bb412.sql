CREATE OR REPLACE FUNCTION public.sync_vendor_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vendor text;
  v_passenger text;
  v_cost numeric;
  v_paid numeric;
  v_sold numeric;
  v_profit numeric;
  v_service text;
  v_date date;
  v_new_id text;
  v_country_route text;
  v_is_ticket_book boolean := false;
BEGIN
  v_vendor    := NEW.vendor_bought;
  v_passenger := NEW.passenger_name;
  v_cost      := COALESCE(NEW.cost_price, 0);
  v_sold      := COALESCE(NEW.sold_price, 0);
  v_profit    := v_sold - v_cost;

  IF TG_TABLE_NAME = 'saudi_visas' THEN
    v_paid := COALESCE(NEW.received_vendor, 0);
  ELSE
    v_paid := 0;
  END IF;

  v_date    := COALESCE(NEW.entry_date, CURRENT_DATE);
  v_service := TG_TABLE_NAME;
  v_country_route := NULL;

  IF TG_TABLE_NAME = 'tickets' THEN
    v_country_route := NEW.trip_road;
    IF UPPER(COALESCE(NEW.status, '')) = 'BOOK' THEN
      v_is_ticket_book := true;
    END IF;
    -- Cancelled & refunded ticket: vendor keeps only the refund fee.
    IF COALESCE(NEW.cancelled, false) THEN
      v_cost   := COALESCE(NEW.vendor_refund_fee, 0);
      v_profit := COALESCE(NEW.office_refund_fee, 0) - COALESCE(NEW.vendor_refund_fee, 0);
    END IF;
  ELSIF TG_TABLE_NAME = 'bmet_cards' THEN
    v_country_route := NEW.country_name;
  ELSIF TG_TABLE_NAME = 'kuwait_visas' THEN
    v_country_route := 'Kuwait';
  ELSIF TG_TABLE_NAME = 'saudi_visas' THEN
    v_country_route := 'Saudi Arabia';
  ELSIF TG_TABLE_NAME = 'others' THEN
    v_country_route := NEW.service_name;
  END IF;

  IF v_is_ticket_book OR v_vendor IS NULL OR length(trim(v_vendor)) = 0 THEN
    IF TG_OP = 'UPDATE' THEN
      DELETE FROM public.vendor_ledger WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.vendor_ledger WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id) THEN
    UPDATE public.vendor_ledger SET
      entry_date = v_date,
      vendor_name = v_vendor,
      passenger_name = v_passenger,
      service_type = v_service,
      country_route = COALESCE(v_country_route, country_route),
      total_payable = v_cost,
      -- Saudi visas mirror received_vendor directly. For every other source
      -- bill, cap paid_amount at the (possibly lowered) cost so a downward
      -- cost correction can never leave a phantom overpayment on the bill.
      -- Cancelled/refunded tickets are excluded: their vendor refund is
      -- managed by the dedicated refund flow, which intentionally keeps
      -- paid_amount above the small refund-fee "cost".
      paid_amount = CASE
        WHEN TG_TABLE_NAME = 'saudi_visas' THEN v_paid
        WHEN TG_TABLE_NAME = 'tickets' AND COALESCE(NEW.cancelled, false) THEN paid_amount
        ELSE LEAST(COALESCE(paid_amount, 0), v_cost)
      END,
      passport = NEW.passport,
      mobile = NEW.mobile,
      profit = v_profit,
      created_by = COALESCE(created_by, NEW.created_by),
      updated_at = now()
    WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id;
  ELSE
    v_new_id := public.next_module_id('VDL', 'vendor_ledger', 'ledger_id');
    INSERT INTO public.vendor_ledger
      (ledger_id, entry_date, vendor_name, passenger_name, service_type,
       country_route, total_payable, paid_amount, passport, mobile, profit,
       source_table, source_id, created_by)
    VALUES
      (v_new_id, v_date, v_vendor, v_passenger, v_service,
       v_country_route, v_cost, v_paid, NEW.passport, NEW.mobile, v_profit,
       TG_TABLE_NAME, NEW.id, NEW.created_by);
  END IF;

  RETURN NEW;
END;
$function$;

-- One-time correction of existing phantom overpayments on non-cancelled
-- source-backed vendor bills (cost was corrected downward after payment).
UPDATE public.vendor_ledger vl
SET paid_amount = vl.total_payable,
    updated_at = now()
WHERE vl.source_table IN ('tickets','bmet_cards','kuwait_visas','others','extra_services')
  AND UPPER(COALESCE(vl.service_type,'')) NOT IN ('ADVANCE','OPENING','PAYMENT')
  AND vl.paid_amount > vl.total_payable + 0.5
  AND NOT EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.id = vl.source_id AND vl.source_table = 'tickets' AND COALESCE(t.cancelled, false) = true
  );