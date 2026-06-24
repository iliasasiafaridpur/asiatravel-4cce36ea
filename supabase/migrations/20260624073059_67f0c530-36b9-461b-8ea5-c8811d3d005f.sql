-- 1) If any duplicate-name row chose 'one_by_one', apply that choice to all siblings (explicit choice wins over default 'total').
UPDATE public.agents a SET settle_mode = 'one_by_one'
WHERE a.settle_mode <> 'one_by_one'
  AND EXISTS (SELECT 1 FROM public.agents b WHERE b.name = a.name AND b.settle_mode = 'one_by_one');

UPDATE public.vendors a SET settle_mode = 'one_by_one'
WHERE a.settle_mode <> 'one_by_one'
  AND EXISTS (SELECT 1 FROM public.vendors b WHERE b.name = a.name AND b.settle_mode = 'one_by_one');

-- 2) Carry phone/address onto the row we will KEEP (the one with the most data / earliest created).
--    Keep rule: rows with phone or address first, then earliest created_at.
WITH ranked AS (
  SELECT id, name,
    row_number() OVER (
      PARTITION BY name
      ORDER BY ((phone IS NOT NULL) OR (address IS NOT NULL)) DESC, created_at ASC
    ) AS rn
  FROM public.agents
),
merged AS (
  SELECT name,
    (array_remove(array_agg(phone) FILTER (WHERE phone IS NOT NULL), NULL))[1] AS phone,
    (array_remove(array_agg(address) FILTER (WHERE address IS NOT NULL), NULL))[1] AS address
  FROM public.agents GROUP BY name
)
UPDATE public.agents a
SET phone = COALESCE(a.phone, m.phone), address = COALESCE(a.address, m.address)
FROM ranked r JOIN merged m ON m.name = r.name
WHERE a.id = r.id AND r.rn = 1;

WITH ranked AS (
  SELECT id, name,
    row_number() OVER (
      PARTITION BY name
      ORDER BY ((phone IS NOT NULL) OR (address IS NOT NULL)) DESC, created_at ASC
    ) AS rn
  FROM public.vendors
),
merged AS (
  SELECT name,
    (array_remove(array_agg(phone) FILTER (WHERE phone IS NOT NULL), NULL))[1] AS phone,
    (array_remove(array_agg(address) FILTER (WHERE address IS NOT NULL), NULL))[1] AS address
  FROM public.vendors GROUP BY name
)
UPDATE public.vendors a
SET phone = COALESCE(a.phone, m.phone), address = COALESCE(a.address, m.address)
FROM ranked r JOIN merged m ON m.name = r.name
WHERE a.id = r.id AND r.rn = 1;

-- 3) Delete the extra duplicate rows (keep rn = 1).
DELETE FROM public.agents WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (
      PARTITION BY name
      ORDER BY ((phone IS NOT NULL) OR (address IS NOT NULL)) DESC, created_at ASC
    ) AS rn
    FROM public.agents
  ) t WHERE t.rn > 1
);

DELETE FROM public.vendors WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (
      PARTITION BY name
      ORDER BY ((phone IS NOT NULL) OR (address IS NOT NULL)) DESC, created_at ASC
    ) AS rn
    FROM public.vendors
  ) t WHERE t.rn > 1
);

-- 4) Prevent future duplicate names.
CREATE UNIQUE INDEX IF NOT EXISTS agents_name_unique ON public.agents (name);
CREATE UNIQUE INDEX IF NOT EXISTS vendors_name_unique ON public.vendors (name);