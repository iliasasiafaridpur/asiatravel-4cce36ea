# Activity Hub — Implementation Plan

A central monitoring dashboard that tracks every event, transaction and user action across the system. No quick-action buttons — pure observation, filtering, and analytics.

---

## 1. Database — new `activity_logs` table + auto-capture triggers

Currently there is no audit table, so events cannot be reconstructed reliably from existing rows (deletes leave no trace, updates overwrite history). We add a dedicated log table and database triggers that automatically write to it whenever rows change in the operational tables.

**New table `public.activity_logs`** (columns):
- `actor_id` (uuid) — who did it (auth.uid())
- `actor_name`, `actor_role` — snapshot for fast display
- `action` — enum-like text: `CREATED | UPDATED | DELETED | PAYMENT_RECEIVED | HANDOVER | EXPENSE`
- `module` — `tickets | bmet | saudi_visa | kuwait_visa | vendor_ledger | agency_ledger | payment | handover | expense | passenger | agent | vendor`
- `entity_id` (text) — e.g. ticket_id, bmet_id, receipt_id
- `entity_label` — human summary (e.g. "Passport AB123 → Submitting")
- `summary` — full sentence ("Imran updated status of Passport AB123 to Submitting")
- `changes` (jsonb) — diff of changed fields for UPDATEs
- `amount` (numeric, nullable) — for payments/expenses
- `created_at` (timestamptz)

**RLS:** `authenticated` SELECT (all staff see all logs — this is an internal back-office app). INSERT only via SECURITY DEFINER trigger function. No UPDATE/DELETE for anyone.

**Triggers** on: `tickets`, `bmet_cards`, `saudi_visas`, `kuwait_visas`, `vendor_ledger`, `agency_ledger`, `payment_receipts`, `cash_handovers`, `cash_expenses`, `passengers`, `agents`, `vendors`.

A single shared `log_activity()` function:
- reads `auth.uid()` + profile name/role
- computes action (INSERT/UPDATE/DELETE → CREATED/UPDATED/DELETED; special-case payment_receipts → PAYMENT_RECEIVED, cash_handovers → HANDOVER, cash_expenses → EXPENSE)
- builds `summary` from per-table key columns
- writes diff for UPDATEs (only changed columns)

**Realtime:** `ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_logs;`

---

## 2. New route `/activity-hub` + sidebar entry

`src/routes/activity-hub.tsx` (file-based route, added to sidebar under monitoring/admin area).

---

## 3. Page layout

```text
┌─────────────────────────────────────────────────────────────┐
│  Activity Hub                          [Live ●]  [Refresh]  │
├─────────────────────────────────────────────────────────────┤
│  ┌─ User Productivity (Today) ──┐ ┌─ Hourly Traffic ─────┐  │
│  │  Bar chart: actions / user   │ │ Line chart: per hour │  │
│  └──────────────────────────────┘ └──────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  [User ▾] [Module ▾] [Action ▾] [Date: Today/Week/Custom]   │
│  [Search…]                                                  │
├─────────────────────────────────────────────────────────────┤
│  Timeline feed (infinite scroll, 50 per page)               │
│   ● Avatar  Imran (Staff)   [UPDATED] tickets               │
│     Updated status of Passport AB123 → Submitting           │
│     18 May 2026, 10:15 AM                                   │
│   ● ...                                                     │
└─────────────────────────────────────────────────────────────┘
```

**Components:**
- **Charts:** Recharts `BarChart` (per-user today) and `LineChart` (hourly volume today). Uses semantic tokens (`hsl(var(--primary))`, etc.) — dark/light compatible.
- **Filters:** shadcn `Select` for User (from profiles), Module, Action; `Popover + Calendar` for custom date range; quick chips for Today / Yesterday / Week.
- **Feed:** Card list with color-coded badges per action (green=CREATED, blue=UPDATED, red=DELETED, emerald=PAYMENT_RECEIVED, amber=EXPENSE, violet=HANDOVER). Uses the locked row-tint palette for soft alternating rows. Avatar = initials of actor.
- **Realtime:** `supabase.channel('activity_logs').on('postgres_changes', INSERT)` prepends new entries live with a subtle slide-in.
- **Pagination:** Initial 50, "Load more" button + IntersectionObserver for infinite scroll.

---

## 4. Data flow

- Initial load: query `activity_logs` filtered + ordered `created_at desc limit 50`.
- Filters re-query on change (debounced 250ms for search).
- Charts: separate queries grouped by `actor_name` and by hour bucket (client-side reduce of last 24h rows).
- New rows pushed via realtime channel merge into the head of the feed (if they pass current filters).

---

## 5. Files to create / edit

**Create:**
- Migration: `activity_logs` table + RLS + `log_activity()` function + 12 triggers + realtime publication.
- `src/routes/activity-hub.tsx` — full page.
- `src/components/activity/ActivityFeed.tsx`, `ActivityFilters.tsx`, `ActivityCharts.tsx` (split for clarity).

**Edit:**
- `src/components/AppSidebar.tsx` — add "Activity Hub" link.

---

## Notes

- Existing tables are not modified — triggers are purely additive.
- Historical actions (before this migration) cannot be reconstructed; the feed starts from deployment time. This is called out in an empty-state note on the page for the first hours after release.
- No write actions are exposed on this page per your explicit requirement.

Reply **approve** to proceed (I'll run the migration first, wait for your confirmation, then build the UI).
