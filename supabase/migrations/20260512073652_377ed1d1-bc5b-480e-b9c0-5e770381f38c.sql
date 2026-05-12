CREATE INDEX IF NOT EXISTS idx_tickets_created_at_desc ON public.tickets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_entry_date_desc ON public.tickets (entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_received_by_entry_date ON public.tickets (received_by, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_agency_sold ON public.tickets (agency_sold);
CREATE INDEX IF NOT EXISTS idx_tickets_vendor_bought ON public.tickets (vendor_bought);

CREATE INDEX IF NOT EXISTS idx_bmet_cards_created_at_desc ON public.bmet_cards (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bmet_cards_entry_date_desc ON public.bmet_cards (entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_bmet_cards_received_by_entry_date ON public.bmet_cards (received_by, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_bmet_cards_agency_sold ON public.bmet_cards (agency_sold);
CREATE INDEX IF NOT EXISTS idx_bmet_cards_vendor_bought ON public.bmet_cards (vendor_bought);

CREATE INDEX IF NOT EXISTS idx_saudi_visas_created_at_desc ON public.saudi_visas (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saudi_visas_entry_date_desc ON public.saudi_visas (entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_saudi_visas_received_by_entry_date ON public.saudi_visas (received_by, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_saudi_visas_agency_sold ON public.saudi_visas (agency_sold);
CREATE INDEX IF NOT EXISTS idx_saudi_visas_vendor_bought ON public.saudi_visas (vendor_bought);

CREATE INDEX IF NOT EXISTS idx_kuwait_visas_created_at_desc ON public.kuwait_visas (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kuwait_visas_entry_date_desc ON public.kuwait_visas (entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_kuwait_visas_received_by_entry_date ON public.kuwait_visas (received_by, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_kuwait_visas_agency_sold ON public.kuwait_visas (agency_sold);
CREATE INDEX IF NOT EXISTS idx_kuwait_visas_vendor_bought ON public.kuwait_visas (vendor_bought);

CREATE INDEX IF NOT EXISTS idx_cash_handovers_from_user_entry_date ON public.cash_handovers (from_user, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_cash_expenses_spent_by_entry_date ON public.cash_expenses (spent_by, entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_agency_ledger_agent_name ON public.agency_ledger (agent_name);
CREATE INDEX IF NOT EXISTS idx_agency_ledger_entry_date_desc ON public.agency_ledger (entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_ledger_vendor_name ON public.vendor_ledger (vendor_name);
CREATE INDEX IF NOT EXISTS idx_vendor_ledger_entry_date_desc ON public.vendor_ledger (entry_date DESC);

ANALYZE public.tickets;
ANALYZE public.bmet_cards;
ANALYZE public.saudi_visas;
ANALYZE public.kuwait_visas;
ANALYZE public.cash_handovers;
ANALYZE public.cash_expenses;
ANALYZE public.agency_ledger;
ANALYZE public.vendor_ledger;