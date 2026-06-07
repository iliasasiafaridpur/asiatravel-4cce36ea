ALTER TABLE public.others
  ADD COLUMN IF NOT EXISTS airline text,
  ADD COLUMN IF NOT EXISTS trip_road text,
  ADD COLUMN IF NOT EXISTS flight_date date;