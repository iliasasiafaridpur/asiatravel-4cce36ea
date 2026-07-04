CREATE OR REPLACE FUNCTION public.trg_recalculate_agent_advance_on_agent_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.name IS DISTINCT FROM NEW.name THEN
      PERFORM public.recalculate_agent_advance(OLD.name);
    END IF;
    IF OLD.name IS DISTINCT FROM NEW.name OR OLD.settle_mode IS DISTINCT FROM NEW.settle_mode THEN
      PERFORM public.recalculate_agent_advance(NEW.name);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recalculate_agent_advance_on_agent_mode ON public.agents;
CREATE TRIGGER trg_recalculate_agent_advance_on_agent_mode
AFTER UPDATE OF name, settle_mode ON public.agents
FOR EACH ROW
EXECUTE FUNCTION public.trg_recalculate_agent_advance_on_agent_mode();