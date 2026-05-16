
# Dual Payment Allocation: Auto-FIFO + Bill-by-Bill

Add two payment modes to both Vendor Ledger and Agency/Customer Ledger so that lump-sum payments either auto-distribute across oldest bookings or apply only to specifically picked bookings.

## What changes for the user

In `/vendor-ledger` and `/agency-ledger`, the existing "পেমেন্ট পরিশোধ / গ্রহণ" dialog (opened from the per-group "Pay" button) gets a **mode switcher** at the top:

1. **Auto FIFO (পুরাতন থেকে নতুন)** — default
   - Show agent/vendor name + total outstanding
   - One amount field (e.g. 75,000)
   - Live preview table below: which bookings will be touched, how much each gets, what stays due
   - On submit, allocate oldest → newest until amount runs out

2. **Bill-by-Bill (নির্দিষ্ট বিল)**
   - Checklist of all unpaid bookings for that agent/vendor (oldest first), each with: date, ref id, passenger, bill, paid, due, and an editable amount field
   - User ticks the bookings to pay and adjusts per-line amounts (defaults to that line's due)
   - Total of selected lines shown at bottom; submit pays exactly those

Both modes use the same Method (Cash/bKash/…), Date, Remarks fields already in the dialog.

The single-row "Pay" button on each table row keeps working as today (it's effectively a one-line Bill-by-Bill).

## Allocation rules

A "booking" = any ledger row for the selected agent/vendor where `service_type != 'PAYMENT'` and `bill - paid > 0`, sorted by `entry_date ASC, created_at ASC`.

- **FIFO**: walk the sorted list; for each booking take `min(remaining_amount, line_due)`, stop when `remaining_amount == 0`. If amount exceeds total due, block with an error (no overpayment).
- **Bill-by-Bill**: per selected line, validate `0 < line_amount ≤ line_due`. Sum is the total payment.
- After allocation, each affected booking's `paid_amount` / `received_amount` is increased by its share.

## Data layer

Per allocation we:

1. For each affected booking row in `agency_ledger` / `vendor_ledger`:
   - If the row has `source_table` + `source_id` (auto-synced from tickets/bmet/saudi/kuwait), update the **source service row's** receive column (`received` / `received_amount` / `received_vendor`). The existing `sync_agency_ledger` / `sync_vendor_ledger` triggers will refresh the ledger row.
   - Otherwise (manual ledger entry), update the ledger row's `paidCol` directly.

2. Mirror the **total** payment into the cash drawer exactly once:
   - Agency → insert one `payment_receipts` row (source: `agency_ledger`, method, remarks, received_by)
   - Vendor → insert one `cash_expenses` row (category `Vendor Payment`, purpose `Vendor: <name>`)

3. Insert one `remarks`-tagged log line on the oldest touched ledger row (or a small JSON in remarks) listing which refs got how much, so audit history survives.

No schema migration is required — all needed columns already exist (`source_table`, `source_id`, `entry_date`, `created_at`, the per-source receive columns).

## Files to change

- `src/components/LedgerPage.tsx`
  - Add `payMode: "fifo" | "specific"` state and `selectedLines: Map<rowId, amount>` state
  - Replace the body of the existing payment Dialog (around the `payOpen` block, ~lines 1100+) with a Tabs UI: FIFO tab (current single amount + preview table) and Bill-by-Bill tab (checklist table)
  - Add helper `getOpenBookings(groupKey)` that returns sorted unpaid rows from `rows`
  - Replace `submitPayment` group-level branch (lines 587–662) with `submitFifo()` and `submitSpecific()` that loop the allocation, do the source-row updates, then write the single cash-drawer mirror entry
  - Keep `payRow` (row-specific) path unchanged

No other files need to change. The row-level "Pay" button, totals, filters, CSV export, and DB triggers stay as-is.

## Technical notes

- All updates run client-side via the existing `supabase` browser client (RLS already permits authenticated CRUD on these tables).
- Allocation loops use `Promise.all` per-booking updates for speed but wrap in try/catch so a partial failure surfaces to the user via toast (DB triggers keep ledger consistent regardless).
- Live preview in FIFO mode recomputes whenever `payAmount` changes — pure UI, no DB calls.
- Bill-by-Bill table reuses the existing shadcn `<Table>` + `<Checkbox>` components.
