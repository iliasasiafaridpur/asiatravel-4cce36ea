## Cash Flow & Financial Architecture Upgrade

Build three interconnected accounting modules: **Multi-Account Ledger**, **Inter-Account Fund Transfer**, and **Daily Cash Closing**. All existing cash flows (vendor payments, agent receipts, booking receipts, expenses) will route through a new `accounts` table so every taka has a tracked source.

---

### 1. Multi-Account Ledger Management

**New table `accounts`**:
- `id`, `account_code` (e.g. ACC-001), `name` (Cash Box, BRAC Bank, bKash, Nagad, Rocket, RedotPay, Binance P2P), `type` (cash/bank/mobile/crypto), `opening_balance`, `current_balance` (live, trigger-maintained), `is_active`, `allow_negative` (admin override).
- Seed defaults: Cash Box, BRAC Bank, bKash, Nagad, Rocket, RedotPay, Binance P2P.

**New column `account_id`** added to:
- `cash_expenses`, `payment_receipts`, `cash_handovers`, `agency_ledger`, `vendor_ledger`.

**Balance-update trigger** (`recalc_account_balance`) fires on INSERT/UPDATE/DELETE for each of those tables. Uses transaction date for posting; computes balance as `opening_balance + SUM(inflows) − SUM(outflows)`.

**Negative-balance guard**: BEFORE INSERT/UPDATE trigger blocks any change that would make `current_balance < 0` unless `allow_negative = true` or caller has `admin` role.

**UI**:
- New route `/accounts-manager` with table of accounts + live balance, add/edit/deactivate.
- Add **Account** dropdown (required) to: vendor-ledger form, agency-ledger form, expense form, receipt form. Replaces the loose `payment_method` text.

---

### 2. Inter-Account Fund Transfer

**New table `fund_transfers`**:
- `id`, `transfer_id` (FT-YYMM-###), `entry_date`, `from_account_id`, `to_account_id`, `amount`, `remarks`, `created_by`.
- Trigger writes a paired ledger entry tagged `category = 'INTERNAL_TRANSFER'` so revenue/expense reports filter it out.

**UI**: New tab inside Accounts page — form with From → To → Amount → Date, list of past transfers with delete.

---

### 3. Daily Cash Closing & Audit

**New table `daily_cash_closings`**:
- `id`, `closing_date`, `account_id`, `opening_balance`, `total_received`, `total_paid`, `expected_closing`, `actual_closing`, `discrepancy` (computed), `closed_by`, `closed_at`, `is_locked`.
- Unique on `(closing_date, account_id)`.

**Lock enforcement**: BEFORE INSERT/UPDATE/DELETE trigger on `cash_expenses`/`payment_receipts`/`fund_transfers`/`vendor_ledger`/`agency_ledger` blocks any write whose date ≤ latest locked `closing_date` for that account — unless caller is admin.

**Auto-rollover**: Today's `actual_closing` = tomorrow's `opening_balance` (computed from previous closing if exists, else from account's `opening_balance`).

**UI**: New "Day-End Closing" tab — pick date + account, system shows expected, user enters counted cash, saves and locks.

---

### 4. Dashboard Integration

Update `Dashboard.tsx` cash-in-hand card to sum `accounts.current_balance`, break down per account, and pull realized profit / expenses through the same source.

---

### Technical Details

**Migrations** (one consolidated SQL file):
1. `accounts` table + seed rows + RLS (authenticated CRUD; only admin can edit `allow_negative`).
2. `fund_transfers` + `daily_cash_closings` tables + RLS.
3. `account_id uuid` columns on the 5 transactional tables.
4. Triggers: `recalc_account_balance`, `guard_negative_balance`, `guard_locked_date`.
5. Backfill `current_balance` for existing rows.

**Frontend files**:
- `src/lib/accounts.ts` — typed account helpers + lookup.
- `src/routes/accounts-manager.tsx` — new page with 3 tabs: Accounts, Transfers, Day-End Closing.
- `src/components/AppSidebar.tsx` — add nav entry.
- Update `LedgerPage.tsx`, expense/receipt forms in `accounts.tsx` to include required `account_id` dropdown.
- Update `Dashboard.tsx` cash card.

**Communication**: Account selector replaces the existing freeform `payment_method` select in forms; existing rows keep their text value but new entries require `account_id`.

---

### Scope Note

This is a deep accounting overhaul touching ~8 files and adding 3 tables + 4 triggers + 1 new route. Backfill of existing transactions to the new `account_id` will map by `payment_method` text → matching account name (Cash → Cash Box, bKash → bKash, etc.); unmatched rows default to Cash Box.

Approve to proceed.