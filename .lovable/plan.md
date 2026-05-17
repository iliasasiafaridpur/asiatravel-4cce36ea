# Advance Payment & Wallet System

দুই দিকেই (Vendor ও Agency/Customer) Advance Wallet যোগ করব, যাতে booking ছাড়াও টাকা নেওয়া/দেওয়া যায় এবং নতুন booking এলে wallet থেকে auto adjust হয়।

## 1. Database (একটি migration)

বর্তমানে `vendor_ledger` / `agency_ledger`-এ already `service_type`, `total_payable`/`total_bill`, `paid_amount`/`received_amount` কলাম আছে — wallet balance এগুলো থেকেই derived (SUM)। আলাদা wallet table দরকার নেই; শুধু **ADVANCE** টাইপের entry আর কয়েকটা helper function/trigger চাই।

### A. Advance entry pattern
- **Vendor advance (আমরা vendor কে advance দিচ্ছি)**: `vendor_ledger` row যেখানে `service_type='ADVANCE'`, `total_payable=0`, `paid_amount=<amount>` → balance negative হয়ে advance credit তৈরি করে।
- **Agency advance (agent আমাদের advance দিচ্ছে)**: `agency_ledger` row যেখানে `service_type='ADVANCE'`, `total_bill=0`, `received_amount=<amount>` → received বেশি, bill কম → negative due মানে advance।

### B. Two new RPC functions
```sql
get_vendor_wallet(vendor_name) → { advance_balance, payable_due }
get_agent_wallet(agent_name)   → { advance_balance, current_due }
```
যেখানে `advance_balance = GREATEST(paid - payable, 0)` এবং `due = GREATEST(payable - paid, 0)`।

### C. Auto-adjustment trigger
`sync_vendor_ledger` / `sync_agency_ledger` trigger-এ extension: নতুন booking insert হলে সংশ্লিষ্ট vendor/agent-এর advance balance check করে অটোমেটিক `paid_amount` / `received_amount`-এ allocate করব (advance balance যত আছে তত পর্যন্ত)। বাকিটা স্বাভাবিকভাবে due হবে।

বিদ্যমান source-table receive কলাম (tickets.received ইত্যাদি) overwrite করব না — শুধু ledger row-এর `paid_amount`/`received_amount` বাড়িয়ে দেব এবং `remarks`-এ "Auto-adjusted from advance: ৳X" লিখব। এতে cash drawer / source form-এর সাথে কোনো conflict হবে না।

## 2. UI Changes

### A. `src/components/LedgerPage.tsx` — Pay/Receive dialog
- "Mark as Advance Payment" checkbox যোগ করব।
- Checked থাকলে: কোনো specific booking select করতে হবে না; শুধু amount + method + remarks নিয়ে একটি `service_type='ADVANCE'` ledger row insert করবে এবং cash drawer mirror (payment_receipts / cash_expenses) লিখবে।
- Group header-এ এখন যে balance দেখায় তার পাশে **"Advance: ৳X"** badge (positive হলে সবুজ)।

### B. `src/routes/vendors.tsx` ও `src/routes/agents.tsx` — list table
- নতুন কলাম: **Advance Balance** (সবুজ, যদি > 0)। `get_vendor_balances` / `get_agent_balances` RPC-তে `total_advance` যোগ করব।

### C. New booking form (tickets/bmet/saudi/kuwait)
কোনো UI change দরকার নেই — trigger নিজেই auto-adjust করবে। তবে toast দেখাব: "৳X advance থেকে adjust হয়েছে"।  
*(এটা optional — চাইলে পরে যোগ করব। প্রথম iteration-এ skip করব যাতে scope ছোট থাকে।)*

## 3. Files to change

1. **migration** — `get_vendor_wallet`, `get_agent_wallet` functions; `get_vendor_balances` / `get_agent_balances` -এ advance কলাম যোগ; `sync_*_ledger` trigger-এ advance auto-allocate logic।
2. **`src/components/LedgerPage.tsx`** — Advance checkbox + advance-mode submit branch + group header-এ advance badge।
3. **`src/routes/vendors.tsx`** ও **`src/routes/agents.tsx`** — Advance Balance কলাম।

## টেকনিক্যাল নোট
- Advance allocation FIFO — আগে যে booking-এ due আছে সেখান থেকে নয়, বরং নতুন booking insert হওয়ার সময়েই pre-fill হবে। পুরাতন due আলাদাভাবে আগের "Pay" flow দিয়েই clear করতে হবে (যেটা ইতিমধ্যে আছে)।
- Advance balance কখনো negative হবে না — UI-তে only positive value show করব।
- RLS-এ change নেই; existing `authenticated` policies কাজ করবে।
- কোনো নতুন column বা table যোগ করছি না — শুধু `service_type` value হিসেবে `'ADVANCE'` ব্যবহার করছি, তাই data migration লাগবে না।

Approve করলে migration আগে চালাব, তারপর UI updates করব।
