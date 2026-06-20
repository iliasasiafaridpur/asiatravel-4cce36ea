DELETE FROM public.vendor_ledger v
USING public.kuwait_visas k
WHERE v.source_id = k.id AND k.passenger_name ILIKE 'ZZ Debug%';

DELETE FROM public.kuwait_visas WHERE passenger_name ILIKE 'ZZ Debug%';

DELETE FROM public.profiles WHERE user_id = 'c93618ca-496e-4386-a7f6-ed07b791d728';
DELETE FROM auth.users WHERE id = 'c93618ca-496e-4386-a7f6-ed07b791d728';