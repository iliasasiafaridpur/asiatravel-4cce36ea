## লক্ষ্য
আপনার সফটওয়্যার টিকে একটি সম্পূর্ণ স্মার্ট ট্রাভেল এজেন্সি ম্যানেজমেন্ট সিস্টেমে আপগ্রেড করা — ২ জন ইউজার (Manager + Md sir), সম্পূর্ণ অডিট ট্রেইল, অটো-লেজার, আধুনিক ড্যাশবোর্ড।

---

## ১) ইউজার ও অডিট ট্রেইল (Who did what)

- **প্রোফাইল টেবিল** — `profiles (user_id, full_name, role)` যেখানে আপনি ও Md sir-এর নাম রাখা হবে। লগইন-এর পর App জানবে কোন ইউজার লগইন আছে।
- প্রতিটি মূল টেবিলে (tickets, bmet_cards, saudi_visas, kuwait_visas, agency_ledger, vendor_ledger) যোগ হবে:
  - `created_by uuid` — কে এন্ট্রি করেছে
  - `received_by uuid` — কে টাকা রিসিভ করেছে (received > 0 হলে)
  - `entry_by` কলামটি অটো-পূর্ণ হবে লগইন ইউজারের নাম দিয়ে
- নতুন টেবিল **`cash_transfers`** — Manager → Md sir হ্যান্ড ক্যাশ / ব্যাংক / অন্যান্য খরচের রেকর্ড: তারিখ, from_user, to_user, amount, method (Hand Cash / Bank / Other), purpose, remarks
- নতুন পেজ `/cash-transfers` — এন্ট্রি ও রিপোর্ট

## ২) অটো-লেজার সিস্টেম

- Tickets / BMET / Saudi / Kuwait — যেকোনো এন্ট্রিতে `agency_sold` থাকলে সেটা স্বয়ংক্রিয়ভাবে `agency_ledger`-এ যোগ হবে (DB ট্রিগার দিয়ে)। পরে আপডেটে লেজার সিঙ্ক হবে।
- একইভাবে `vendor_bought` থাকলে `vendor_ledger`-এ অটো এন্ট্রি।
- নতুন `agents` যোগ করলে — `agency_ledger`-এ একটি opening row তৈরি হবে যেন তার নামে হিসাব খোলা থাকে। একইভাবে `vendors` → `vendor_ledger`।
- Agency / Vendor পেজে balance summary দেখাবে (কত পাওনা, কত পরিশোধিত)।

## ৩) আধুনিক ড্যাশবোর্ড (রঙিন, রিয়েল-টাইম)

- সম্পূর্ণ নতুন ড্যাশবোর্ড — সব মডিউলের ডেটা টানবে (এখন শুধু passengers টেবিল টানে — সেজন্যই হালনাগাদ হয় না)
- **Stat Cards** (গ্রেডিয়েন্ট): মোট টিকিট, BMET, Saudi, Kuwait, মোট বিক্রি, মোট রিসিভ, মোট বাকি, মোট লাভ
- **চার্টস**: মাসিক বিক্রি vs রিসিভ (Area chart), সার্ভিস-ভিত্তিক pie, ইউজার-ভিত্তিক রিসিভ bar chart, সর্বশেষ ৭ দিনের এন্ট্রি
- **Realtime** — Supabase realtime subscribe, কেউ নতুন এন্ট্রি দিলে সাথে সাথে ড্যাশবোর্ড আপডেট
- **Quick Actions** — সরাসরি Action Board / Day Book বাটন
- React Query auto-refetch প্রতি ৩০ সেকেন্ডে + window focus-এ

## ৪) Action Board ৩-সেকশন ফর্ম

বর্তমানে Action Board সব ফিল্ড একসাথে দেখায়। এটাকে Edit Dialog-এর মতো ৩ ভাগে দেখাব:
- ১. Passenger Details & Price
- ২. Sub Agency / Reference
- ৩. Vendor Information

`ModulePage`-এর `FormSections` কম্পোনেন্ট রিইউজ করব যেন এক জায়গায় চেঞ্জ → সব জায়গায় কাজ করে।

## ৫) UX ছোট উন্নতি

- লগআউট বাটনে ইউজারের নাম দেখাবে ("Manager", "Md Sir")
- Day Book-এ "Entered By" ও "Received By" কলাম
- প্রতিটি ledger row-এ ইউজার ব্যাজ

---

## টেকনিক্যাল বিবরণ

**DB মাইগ্রেশন:**
1. `profiles` টেবিল + auto-create trigger on auth.users insert
2. `cash_transfers` টেবিল
3. ৬টি মূল টেবিলে `created_by`, `received_by` (uuid, nullable) যোগ
4. ট্রিগার: `sync_agency_ledger()` ও `sync_vendor_ledger()` — INSERT/UPDATE on tickets/bmet/saudi/kuwait
5. ট্রিগার: `agents` INSERT → opening agency_ledger row; `vendors` INSERT → opening vendor_ledger row
6. RLS — সবাইকে read/write দেওয়া হবে (যেহেতু office sharing model)

**ফ্রন্টএন্ড:**
- `src/hooks/useCurrentUser.ts` — লগইন ইউজার + profile
- `src/components/Dashboard.tsx` — সম্পূর্ণ পুনর্লিখন
- `src/components/ActionBoard.tsx` ও `src/routes/action-board.tsx` — ৩-সেকশন ফর্ম (FormSections রিইউজ)
- `src/routes/cash-transfers.tsx` — নতুন পেজ
- `src/lib/modules.ts` — `cash_transfers` মডিউল যোগ
- `src/components/AppSidebar.tsx` — Cash Transfer লিঙ্ক
- `src/components/ModulePage.tsx` — submit-এ created_by/received_by সেট

**Realtime:** Dashboard mount-এ ৬টি টেবিলে subscribe → invalidate queries।

---

## প্রথমবার Admin তৈরি (আপনার করণীয়)

মাইগ্রেশন approve করার পর আমি কোড deploy করব। তারপর:
1. Lovable Cloud → Users → Add User
   - Email: `01XXXXXXXXX@asiatravel.local` (আপনার ফোন)
   - Password + Auto-Confirm ✅
2. একই ভাবে Md sir-এর জন্য আরেকটা
3. Cloud → SQL → প্রতিটি user-এর `profiles` row-এ `full_name` ('Manager' / 'Md Sir') ও `role` সেট করব (আমি instructions দেব)

---

**Approve করলে আমি প্রথমে DB মাইগ্রেশন submit করব, তারপর সব কোড একসাথে আপডেট করব।**