# Plan: Delete rules, notifications, offline, bug sweep

## 1. Data Reset সরানো + "নিজের এন্ট্রি" ভিত্তিক ডিলিট

### Data Reset (Admin) সম্পূর্ণ রিমুভ
- `src/routes/settings.tsx` থেকে পুরো "Data Reset (Admin)" কার্ড, `RESET_GROUPS`, এবং সংশ্লিষ্ট state/ফাংশন মুছে ফেলা হবে। Profile, Password, Maintenance কার্ড থাকবে।

### নতুন ডিলিট নিয়ম (সব মডিউলে)
নিয়ম: যেকোনো লগইন করা user ডিলিট করতে পারবে, **কিন্তু কেবল নিজের তৈরি করা এন্ট্রি** (entry / payment receive / delivery / status — যা নিজে করেছে)। অন্য user-এর এন্ট্রি কেউ ডিলিট করতে পারবে না। প্রতিটি ডিলিট নিজের **login পাসওয়ার্ড** দিয়ে নিশ্চিত করতে হবে।

**Database (migration):**
- প্রতিটি অপারেশনাল টেবিলের DELETE policy বদলে হবে: `created_by = auth.uid() OR created_by IS NULL`
  (পুরোনো owner-হীন রো গুলো আটকে না যাওয়ার জন্য `IS NULL` ফলব্যাক)।
  টেবিল: tickets, bmet_cards, saudi_visas, kuwait_visas, others, extra_services, payment_receipts, cash_handovers, cash_expenses, fund_transfers, agency_ledger, vendor_ledger।
- `passengers` (Action Board) টেবিলে `created_by uuid` যোগ হবে; DELETE policy owner-ভিত্তিক হবে।
- `delete_payment_receipt_and_revert` RPC এখন admin/md-কেও অন্যের রসিদ মুছতে দেয় — এটি **owner-only** করা হবে (নিয়ম অনুযায়ী কেউ অন্যের এন্ট্রি মুছতে পারবে না)।
- শেয়ার্ড রেফারেন্স টেবিল (agents, vendors, accounts, lookups, daily_cash_closings) — এগুলো ব্যক্তিগত "এন্ট্রি" নয়, তাই এগুলোর ডিলিট আগের মতোই admin-only থাকবে।

**Frontend:**
- `ConfirmDeleteButton` — `isAdmin` চেক বাদ দিয়ে owner চেক (`ownerId` prop) + পাসওয়ার্ড নিশ্চিতকরণ ধাপ যুক্ত হবে।
- `ActionBoard` ইনলাইন ডিলিট — `created_by` মালিকানা চেক + পাসওয়ার্ড।
- `ModulePage` (Ticket/BMET/Visa/Other) — ইতিমধ্যে পাসওয়ার্ড নিশ্চিতকরণ আছে; শুধু owner চেক যোগ হবে (অন্যের রো হলে বার্তা: "অন্য ইউজারের এন্ট্রি ডিলিট করা যাবে না")।
- `LedgerPage`, `StatusChangeDrawer`, `BmetQuickManage` — যেখানে ডিলিট আছে সেখানে একই owner + পাসওয়ার্ড নিয়ম।
- নতুন এন্ট্রিতে `created_by`/`passengers.created_by` সঠিকভাবে সেট হচ্ছে কিনা নিশ্চিত করা হবে।

## 2. অপ্রয়োজনীয় নোটিফিকেশন বন্ধ
- বর্তমানে প্রতিটি toast (saved/updated/deleted সহ) নোটিফিকেশন বেলে জমা হয় — খুব noisy।
- `toast-interceptor.ts` শুধু **error** ও **warning** বেলে রাখবে; রুটিন success/info আর জমবে না।
- alert-scanner-এর গুরুত্বপূর্ণ সতর্কতা (বকেয়া / ডেলিভারি বিলম্ব) থাকবে।

## 3. অফলাইন: পড়া, এন্ট্রি ও ১-মাসের প্রি-লোড বাটন
- **যাচাই:** অফলাইন এন্ট্রি (resilientInsert/Update + global-fetch-interceptor + auto-sync) ও পঠন (localStorage + react-query persist) ঠিক আছে কিনা পরীক্ষা করে নিশ্চিত করা হবে।
- **নতুন বাটন (নোটিফিকেশন বেলের ভিতরে):** "একমাসের ডাটা সেভ করুন (অফলাইন)" — ক্লিক করলে সব মডিউল (Ticket/BMET/Saudi/Kuwait/Other), ledger, receipts, passengers ও dashboard-এর সর্বশেষ ~১ মাসের ডাটা একবারে এনে প্রতিটি মডিউলের `cache_v2_*` localStorage cache-এ সেভ করবে — ফলে যে পেইজে আগে ঢুকিনি সেটিও নেট ছাড়া পড়া যাবে। প্রগ্রেস ও সফল/ব্যর্থ টোস্ট দেখানো হবে।

## 4. সম্পূর্ণ চেক ও বাগ ফিক্স
- বিল্ড/টাইপচেক চালিয়ে error ঠিক করা।
- নতুন owner-RLS-এ কোনো বৈধ ডিলিট আটকে যাচ্ছে কিনা পরীক্ষা।
- preview-তে delete + password flow, নোটিফিকেশন ফিল্টার, ও অফলাইন প্রি-লোড বাটন যাচাই।
- security scanner চালিয়ে নতুন RLS নিরাপদ কিনা নিশ্চিত করা।

## প্রশ্ন
- Admin-রাও অন্যের এন্ট্রি মুছতে পারবে না — কঠোরভাবে owner-only ধরে এগোচ্ছি (আপনার নির্দেশ অনুযায়ী)। ঠিক আছে তো?
