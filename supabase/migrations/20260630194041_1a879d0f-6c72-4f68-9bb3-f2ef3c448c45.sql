CREATE OR REPLACE FUNCTION public.sync_agency_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_agency text;
  v_passenger text;
  v_sold numeric;
  v_recv numeric;
  v_discount numeric;
  v_cost numeric;
  v_profit numeric;
  v_service text;
  v_date date;
  v_pay_date date;
  v_new_id text;
  v_country_route text;
  v_billable boolean;
BEGIN
  v_agency    := NEW.agency_sold;
  v_passenger := NEW.passenger_name;
  v_sold      := COALESCE(NEW.sold_price, 0);
  v_discount  := COALESCE(NEW.discount_amount, 0);
  v_cost      := COALESCE(NEW.cost_price, 0);

  IF TG_TABLE_NAME IN ('tickets','kuwait_visas') THEN
    v_recv := COALESCE(NEW.received, 0);
  ELSE
    v_recv := COALESCE(NEW.received_amount, 0);
  END IF;

  v_profit := v_sold - v_discount - v_cost;
  v_date := COALESCE(NEW.entry_date, CURRENT_DATE);
  v_pay_date := NEW.payment_date;
  v_service := TG_TABLE_NAME;
  v_country_route := NULL;

  IF TG_TABLE_NAME = 'tickets' THEN
    v_country_route := NEW.trip_road;
    IF COALESCE(NEW.cancelled, false) THEN
      v_sold := COALESCE(NEW.office_refund_fee, 0);
      v_recv := COALESCE(NEW.office_refund_fee, 0);
      v_discount := 0;
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

  IF v_agency IS NULL OR length(trim(v_agency)) = 0 THEN
    IF TG_OP = 'UPDATE' THEN
      DELETE FROM public.agency_ledger WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  -- A job only counts toward the agency due once it becomes "billable":
  --   BMET card  -> received from vendor (received_date set) OR agency paid part (received_amount > 0)
  --   Air ticket -> ticket has been ISSUED (status reached issue stage) OR real money received
  --   (discount alone never makes it billable). Cancelled tickets keep their refund row.
  --   Other services (visas, others) remain billable on entry as before.
  v_billable := true;
  IF TG_TABLE_NAME = 'bmet_cards' THEN
    v_billable := (NEW.received_date IS NOT NULL) OR (COALESCE(NEW.received_amount, 0) > 0);
  ELSIF TG_TABLE_NAME = 'tickets' THEN
    IF COALESCE(NEW.cancelled, false) THEN
      v_billable := true;
    ELSE
      v_billable := (COALESCE(NEW.status, '') IN ('ISSUE', 'DELIVERED', 'Delivery But Due'))
                    OR (COALESCE(NEW.received, 0) > 0);
    END IF;
  END IF;

  IF NOT v_billable THEN
    IF TG_OP = 'UPDATE' THEN
      DELETE FROM public.agency_ledger WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.agency_ledger WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id) THEN
    UPDATE public.agency_ledger SET
      entry_date = v_date,
      payment_date = v_pay_date,
      agent_name = v_agency,
      passenger_name = v_passenger,
      service_type = v_service,
      country_route = COALESCE(v_country_route, country_route),
      total_bill = v_sold,
      received_amount = v_recv,
      discount_amount = v_discount,
      passport = NEW.passport,
      mobile = NEW.mobile,
      profit = v_profit,
      received_by = NEW.received_by,
      created_by = COALESCE(created_by, NEW.created_by),
      updated_at = now()
    WHERE source_table = TG_TABLE_NAME AND source_id = NEW.id;
  ELSE
    v_new_id := public.next_module_id('AGL', 'agency_ledger', 'ledger_id');
    INSERT INTO public.agency_ledger
      (ledger_id, entry_date, payment_date, agent_name, passenger_name, service_type,
       country_route, total_bill, received_amount, discount_amount, passport, mobile, profit,
       source_table, source_id, created_by, received_by)
    VALUES
      (v_new_id, v_date, v_pay_date, v_agency, v_passenger, v_service,
       v_country_route, v_sold, v_recv, v_discount, NEW.passport, NEW.mobile, v_profit,
       TG_TABLE_NAME, NEW.id, NEW.created_by, NEW.received_by);
  END IF;

  RETURN NEW;
END;
$function$;