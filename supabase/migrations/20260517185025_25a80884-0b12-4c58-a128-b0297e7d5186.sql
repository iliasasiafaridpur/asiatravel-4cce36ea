-- Partial unique indexes: only enforced when passport is provided (non-empty)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tickets_passport_date
  ON public.tickets (passport, entry_date)
  WHERE passport IS NOT NULL AND length(trim(passport)) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_bmet_passport_date
  ON public.bmet_cards (passport, entry_date)
  WHERE passport IS NOT NULL AND length(trim(passport)) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_saudi_passport_date
  ON public.saudi_visas (passport, entry_date)
  WHERE passport IS NOT NULL AND length(trim(passport)) > 0;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_kuwait_passport_date
  ON public.kuwait_visas (passport, entry_date)
  WHERE passport IS NOT NULL AND length(trim(passport)) > 0;