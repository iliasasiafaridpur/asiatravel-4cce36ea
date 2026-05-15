
## লক্ষ্য

`/agency-ledger`-এ একই Agent-এর একাধিক যাত্রী/সার্ভিস লাইনের যেকোনো একটির **Due** amount-এ ক্লিক করলে:
1. পেমেন্ট ডায়লগে শুধু **ঐ যাত্রীর/আইডির due** আসবে (Agent-এর মোট নয়)।
2. পেমেন্ট সেভ করলে শুধু **ঐ নির্দিষ্ট লাইনের** due কমবে এবং ledger-এ ঐ যাত্রীর নামেই entry শো করবে।
3. Agent-এর মোট বিল সারাংশ স্বয়ংক্রিয়ভাবে সমন্বয় হবে।

## এখন কেন ভুল হচ্ছে

`LedgerPage.tsx`-এর `openPayment(groupKey, bal)` ফাংশন `dueForGroup(groupKey)` দিয়ে Agent-এর **মোট outstanding** আবার হিসাব করে — তাই যেকোনো এক যাত্রীর Due-তে ক্লিক করলেও Agent-এর সম্পূর্ণ মোট due ডায়লগে চলে আসে। আবার `submitPayment` agency_ledger-এ একটা নতুন generic row বানায় (passenger_name = "পেমেন্ট গ্রহণ", source_id খালি), যা কোনো নির্দিষ্ট source row-এর সাথে যুক্ত নয়।

সঠিক সমাধান: agency_ledger rows আসে underlying service tables (tickets/bmet_cards/saudi_visas/kuwait_visas) থেকে DB trigger দিয়ে। একটা নির্দিষ্ট passenger-এর due কমানোর একমাত্র টেকসই উপায় হলো ঐ source row-এর `received` / `received_amount` কলাম আপডেট করা — তারপর trigger নিজেই agency_ledger সিঙ্ক করবে। এই কাজটাই `DueReceiveDialog` এবং `payment_receipts` ইতোমধ্যে করে।

## পরিবর্তন (শুধু `src/components/LedgerPage.tsx`)

### 1. নতুন state — কোন row-তে ক্লিক হয়েছে মনে রাখা
```ts
const [payRow, setPayRow] = useState<Row | null>(null);
```

### 2. `openPayment` দুই-মোডে কাজ করবে
- **Row-mode** (passenger-specific): `openPaymentForRow(row, bal)` → due = সেই row-এর নিজস্ব `bill - paid` (Agent total নয়), `payRow = row`, `payTarget = agent name` (display-only, lock)।
- **Agent-mode** (Header-এর "পেমেন্ট গ্রহণ এন্ট্রি" বাটন): আগের মতো `dueForGroup(agent)` ব্যবহার করে, `payRow = null`।

Row-cell এবং Quick-Pay icon (lines 1202-1209, 1248) থেকে `openPaymentForRow(r, bal)` কল হবে।

### 3. `submitPayment` দুই-পথে split
- **`payRow != null` (passenger-specific):**
  - source service detect: `payRow.source_table` + `payRow.source_id` থেকে। যদি না থাকে (legacy row বা manual entry), তাহলে সরাসরি `agency_ledger.received_amount += amt` ঐ row-এ আপডেট।
  - যদি থাকে: ঐ source table-এর `received` / `received_amount` কলামে `amt` যোগ করে UPDATE — DB trigger আপনাআপনি agency_ledger সিঙ্ক করবে এবং ঐ যাত্রীর নামেই থাকবে।
  - `payment_receipts`-এ একটা entry insert (passenger_name = ঐ যাত্রীর নাম, ref_id = source row-এর ref, amount = amt, source = `agency_ledger`) — এতে cash drawer/হিসাব সিঙ্ক থাকবে এবং History-তে দেখাবে।
- **`payRow == null` (legacy agent-level payment):** আগের code অপরিবর্তিত (নতুন agency_ledger row বসে)।

### 4. ডায়লগ UI
- যখন `payRow` সেট, তখন ডায়লগের শিরোনামের নিচে যাত্রীর নাম + ID + service + line-due ছোট কার্ডে দেখাও, এবং Agent dropdown lock।
- Max amount validation: `amt <= payDue` (line-due)।
- ডায়লগ বন্ধ হলে `setPayRow(null)`।

### 5. Realtime / load
পরিবর্তন নেই — trigger-driven sync + existing `postgres_changes` channel UI auto-refresh করবে।

## পরিবর্তন বহির্ভূত

- কোনো DB migration লাগবে না (existing trigger `sync_agency_ledger` যথেষ্ট)।
- Print/CSV/filter কিছুই পরিবর্তন হবে না।
- Vendor-ledger flow (same component, `isAgency=false`)-এও একই pattern কাজ করবে: তখন source table-এ `received_vendor` (saudi) বা manual update fallback ব্যবহার হবে — vendor-ledger তে এখন এটা কম প্রয়োজন বলে শুধু agency-mode-এ প্রথমে enable করব, vendor-mode আগের generic flow-এ থাকবে।

## ঝুঁকি / Edge case

- **Source row পাওয়া যাচ্ছে না** (manual ledger entry): fallback হিসেবে সরাসরি agency_ledger row-এর `received_amount` আপডেট — passenger নাম অপরিবর্তিত থাকবে।
- **Over-payment**: validation `amt > payDue` হলে error toast, save হবে না।
- **Negative balance (Adv)**: Adv lines-এ Due button দেখায় না, তাই ক্লিক হয় না — অপরিবর্তিত।
