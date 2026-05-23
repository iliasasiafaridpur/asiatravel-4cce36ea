# Multi-Role Cash Handover & MD Verification Workflow

Build a 3-tier role system (Admin / Staff / MD) with cash handover, MD approval, day-locking, and approval-aware passenger payment timeline.

## 1. Roles & Permission Model

Extend the existing `app_role` enum and `user_roles` table to support **three roles**:
- `admin` — software officer, no participation in cash flow. Hidden from cash drawer / handover lists. Keeps existing schema-edit / RLS-bypass privileges.
- `staff` — creates entries, receives payments. Receipts default to **Pending MD Approval**. Must submit daily handover.
- `md` — owner. Self-transactions auto-approved. Sees the MD Cash Control Panel.

Update `handle_new_user()` / role helpers so the first user becomes `md` (instead of `admin`) — actual admin role is assigned manually. Add a `has_any_role` helper and a small `useRole()` hook on the client.

## 2. Database changes (single migration)

- **`payment_receipts`** — add:
  - `approval_status text` — `'auto_approved' | 'pending_md' | 'approved' | 'rejected'`, default `'pending_md'`
  - `approved_by uuid`, `approved_at timestamptz`
  - `handover_id uuid` (FK to `cash_handovers.id`, nullable)
- **`cash_handovers`** — add:
  - `status text` — `'pending' | 'approved' | 'rejected'`, default `'pending'`
  - `submitted_amount numeric` (what staff declared)
  - `confirmed_amount numeric` (what MD counted)
  - `approved_by uuid`, `approved_at timestamptz`
  - `closing_date date` — locks all that staff's receipts on/before this date
- **`day_locks`** table (new): `(user_id, locked_date, handover_id)` — used by RLS / triggers to block edits/deletes on locked-day receipts and service rows for that staff.
- **Trigger** `set_receipt_approval`: on insert into `payment_receipts`, if `received_by` has role `md` → `auto_approved`; else → `pending_md`.
- **Trigger** `guard_locked_receipt`: block UPDATE/DELETE on a receipt whose owning staff has a `day_locks` row covering its `entry_date`, unless caller is `md` or `admin`.
- **`get_accounts_overview` / `get_cash_drawer` / dashboard totals**: only count receipts with `approval_status IN ('auto_approved','approved')` toward **Global Cash in Hand**. Pending amounts surface separately as "Awaiting MD Approval".

## 3. Staff: Submit Daily Cash Handover

- New button **"Submit Daily Cash Handover"** in the staff cash drawer / Accounts page header (visible only when role = `staff`).
- Opens modal showing:
  - Auto-computed total of today's `pending_md` receipts (system count).
  - Input: **Physical cash counted** by staff.
  - Optional remarks.
- On submit: insert a `cash_handovers` row with `status='pending'`, `submitted_amount`, `closing_date = today`, links all today's pending receipts via `handover_id`, and inserts a `day_locks` row. Staff loses edit/delete on those receipts and same-day service rows.

## 4. MD Cash Control Panel

New route `/_authenticated/md-panel` (guarded — redirect non-MD).

**Tab A — Pending Staff Handovers**
- Table: date, staff name, system total, declared cash, variance, remarks.
- Expand row → see itemized receipts in that handover.
- Actions: **Confirm & Approve** (sets `confirmed_amount`, flips handover + linked receipts to `approved`, moves money into Global Cash) or **Reject** (unlocks day, receipts revert to `pending_md` for resubmission).

**Tab B — All Activity / Logs**
- Read-only feed of receipts with their `approval_status` badge, filterable by staff/date.

MD's own receipts never appear in Tab A (already `auto_approved`).

## 5. Passenger Profile Timeline (approval-aware)

In `PassengerProfileDrawer` Payment History rows, render:

```
22-MAY-2026  ৳15,000  Cash  Staff: Sabbir   [Pending MD Approval]
23-MAY-2026  ৳10,000  Cash  MD: Owner       [Self-Approved]
10-MAY-2026  ৳20,000  Cash  Staff: Rakib    [Approved by MD]
```

Status badge color: amber (pending), emerald (approved/self-approved), rose (rejected). Outstanding Due math already uses `received` on the service row — keep as-is; pending receipts still count toward the customer's paid balance (they owe nothing more), but **Global Cash in Hand** excludes them until MD approves.

## 6. UI changes summary

- `src/hooks/useRole.ts` — new helper exposing `isMd / isStaff / isAdmin`.
- `src/components/StaffHandoverDialog.tsx` — new modal (step 3).
- `src/routes/_authenticated/md-panel.tsx` — new MD control panel route + sidebar link gated by role.
- `src/components/AppSidebar.tsx` — show "MD Panel" link only for `md`; hide "Submit Handover" button for non-staff.
- `src/components/PassengerProfileDrawer.tsx` — payment history shows receiver + approval badge.
- `src/routes/accounts.tsx`, `src/routes/index.tsx`, `src/lib/alert-scanner.ts` — split totals into **Confirmed Cash** vs **Pending Approval**.
- `src/components/StatusChangeDrawer.tsx`, `src/components/DueReceiveDialog.tsx` — no behavior change needed; trigger sets `approval_status` server-side based on payer's role.

## Technical notes

- All approval-state transitions happen via SECURITY DEFINER RPCs (`approve_handover`, `reject_handover`, `submit_handover`) so RLS stays simple and locked-day enforcement lives in one trigger.
- "Confirmed Cash" = sum where `approval_status IN ('auto_approved','approved')`. "Pending" surfaces separately — never inflates owner's reported cash.
- Existing `Md Al Amin` / `Arshad Mollah` records are unaffected: legacy receipts get `approval_status='auto_approved'` in the migration backfill (treat historical data as already settled).
- Admin role retains technical access (SQL, settings) but is excluded from cash dashboards and handover queues.
