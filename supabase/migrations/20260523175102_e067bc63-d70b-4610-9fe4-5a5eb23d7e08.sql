CREATE OR REPLACE FUNCTION public.guard_submitted_handover_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.submitted_amount IS NOT NULL
      OR OLD.closing_date IS NOT NULL
      OR COALESCE(OLD.status, 'approved') = 'pending')
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'এই cash handover MD-কে submit করা হয়েছে, তাই ডিলেট করা যাবে না।';
  END IF;
  RETURN OLD;
END;
$$;