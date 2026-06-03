UPDATE public.agency_ledger
   SET payment_date = DATE '2026-05-18',
       updated_at = now()
 WHERE ledger_id = 'AGL-2606-028'
   AND passenger_name = 'Mohammad Sabbir Ahmed'
   AND COALESCE(received_amount, 0) = 5000
   AND payment_method = 'Bank Transfer';

UPDATE public.payment_receipts
   SET entry_date = DATE '2026-05-18',
       remarks = concat_ws(' · ', remarks, 'Date corrected from payment receive screenshot'),
       updated_at = now()
 WHERE ref_id = 'AGL-2606-028'
   AND passenger_name = 'Mohammad Sabbir Ahmed'
   AND COALESCE(amount, 0) = 5000
   AND method = 'Bank Transfer'
   AND source = 'agency_ledger_payment';