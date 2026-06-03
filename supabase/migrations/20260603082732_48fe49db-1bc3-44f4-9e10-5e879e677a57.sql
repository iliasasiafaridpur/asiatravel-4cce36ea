INSERT INTO public.payment_receipts (
  receipt_id, entry_date, service_type, service_table, service_row_id, ref_id,
  passenger_name, received_by, received_by_name, amount, method, source, remarks, created_by
)
SELECT
  'AGL-' || to_char(COALESCE(al.payment_date, al.entry_date, CURRENT_DATE), 'YYYYMM') || '-' || upper(substr(replace(al.id::text, '-', ''), 1, 8)) AS receipt_id,
  COALESCE(al.payment_date, al.entry_date, CURRENT_DATE) AS entry_date,
  'Service Receipt: ' || COALESCE(al.agent_name, '') AS service_type,
  'agency_ledger' AS service_table,
  al.id AS service_row_id,
  al.ledger_id AS ref_id,
  COALESCE(al.passenger_name, al.agent_name, '') AS passenger_name,
  COALESCE(al.received_by, al.created_by) AS received_by,
  p.full_name AS received_by_name,
  COALESCE(al.received_amount, 0) AS amount,
  COALESCE(NULLIF(al.payment_method, ''), 'Cash') AS method,
  'agency_ledger_payment' AS source,
  concat_ws(' · ',
    'সার্ভিস/কাস্টমার পেমেন্ট রিসিভ',
    CASE
      WHEN lower(COALESCE(al.payment_method, 'Cash')) IN ('cash', 'hand cash')
      THEN 'User cash received'
      ELSE 'MD received via ' || COALESCE(NULLIF(al.payment_method, ''), 'Cash') || ' — staff balance neutral'
    END,
    NULLIF(al.remarks, '')
  ) AS remarks,
  COALESCE(al.created_by, al.received_by) AS created_by
FROM public.agency_ledger al
LEFT JOIN public.profiles p ON p.user_id = COALESCE(al.received_by, al.created_by)
WHERE COALESCE(al.received_amount, 0) > 0
  AND COALESCE(al.received_by, al.created_by) IS NOT NULL
  AND al.source_table IN ('tickets', 'bmet_cards', 'saudi_visas', 'kuwait_visas')
ON CONFLICT (receipt_id) DO UPDATE SET
  entry_date = EXCLUDED.entry_date,
  service_type = EXCLUDED.service_type,
  service_table = EXCLUDED.service_table,
  service_row_id = EXCLUDED.service_row_id,
  ref_id = EXCLUDED.ref_id,
  passenger_name = EXCLUDED.passenger_name,
  received_by = EXCLUDED.received_by,
  received_by_name = EXCLUDED.received_by_name,
  amount = EXCLUDED.amount,
  method = EXCLUDED.method,
  source = EXCLUDED.source,
  remarks = EXCLUDED.remarks,
  created_by = EXCLUDED.created_by,
  updated_at = now();