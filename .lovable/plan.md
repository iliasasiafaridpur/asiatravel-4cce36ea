# My Accounts — সম্পূর্ণ নতুন ডিজাইন

পুরনো `/day-book` ও `/accounts` দুইটি পেইজ ডিলেট করে একটি একক, আধুনিক, প্রফেশনাল **My Accounts** পেইজ তৈরি করব।

## মূল উদ্দেশ্য
1. বর্তমান ব্যবহারকারীর **আয়** (services থেকে received টাকা) দেখা
2. **ব্যয়** (cash expense) দেখা ও যোগ করা
3. দিন শেষে **কতৃপক্ষের কাছে জমা** (handover) দেওয়া
4. **লাইভ ব্যালেন্স** (হাতে কত টাকা আছে) দেখা

## পেইজ স্ট্রাকচার

```text
┌─────────────────────────────────────────────────────────────┐
│  Hero Header: "আমার হিসাব"  +  আজকের তারিখ  +  Refresh    │
├─────────────────────────────────────────────────────────────┤
│  ৪টি Stat Card (gradient, large numbers):                  │
│   💰 হাতে আছে    📥 মোট আয়    📤 মোট জমা    🧾 মোট খরচ   │
│   (current bal)  (received)   (handover)    (expense)      │
├─────────────────────────────────────────────────────────────┤
│  Quick Action Bar (sticky):                                │
│   [ + জমা দিন ]   [ + খরচ যোগ ]   Period: [আজ|মাস|বছর|সব]│
├─────────────────────────────────────────────────────────────┤
│  Tabs: [ Timeline ]  [ আয় ]  [ খরচ ]  [ জমা ]              │
│                                                             │
│  ▸ Timeline: তারিখ অনুযায়ী আয়/খরচ/জমা একসাথে               │
│    (Stacked Row Content style — service, party, amount,    │
│     running balance)                                        │
│  ▸ আয়: payment_receipts (filtered by user)                 │
│  ▸ খরচ: cash_expenses (filtered by user)                   │
│  ▸ জমা: cash_handovers (filtered by user)                  │
└─────────────────────────────────────────────────────────────┘
```

## ডিজাইন ভাষা
- **Stat Cards**: gradient background (`--gradient-hero`, `--gradient-primary`), বড় টাইপোগ্রাফি, আইকন সহ
- **Stacked Row Content** (যেমন BMET/Saudi Visa-তে): প্রতিটি entry-তে date+id বামে, party+description মাঝে, amount+running ডানে — কোনো বড় টেবিল নয়, কার্ড-স্টাইল রো
- **Quick Action Dialogs**: জমা/খরচ যোগ করার জন্য সুন্দর modal (Dialog) — পেইজে বড় ফর্ম থাকবে না
- **Sticky filter bar** — টাইপ অনুযায়ী filter
- **Empty states** ও **loading skeletons** সহ
- সব semantic tokens (`bg-card`, `text-foreground`, `text-emerald-600` ইত্যাদি existing pattern অনুসরণ করে)

## ডেটা সোর্স (existing tables)
- `payment_receipts` (received_by = user.id) → আয়
- `cash_expenses` (spent_by = user.id) → খরচ
- `cash_handovers` (from_user = user.id) → জমা
- `get_user_account` RPC → সরাসরি ব্যালেন্স summary
- Realtime subscription → তিনটি table-এ `postgres_changes`

## ফাইল পরিবর্তন

1. **Delete**: `src/routes/day-book.tsx`
2. **Rewrite from scratch**: `src/routes/accounts.tsx` (নতুন কম্পোনেন্ট, ক্লিন কোড, ~400 lines)
3. **Update**: `src/components/AppSidebar.tsx`
   - "Day Book" এন্ট্রি বাদ
   - "My Accounts" সাইডবারে একই জায়গায় রাখা (icon: Wallet)
4. **Check**: `src/lib/modules.ts` ও অন্য কোথাও `/day-book` লিঙ্ক থাকলে রিমুভ

## কী **থাকবে না** (পুরনো accounts.tsx থেকে বাদ)
- "Manual Receive" form — services already auto-create receipts; manual entry confusing
- "Daily Report" giant table — Timeline tab এতেই ঢাকা
- "Staff Overview" — admin-only, এই পেইজ user-centric
- Day Book-এর সব service entries listing (ওটার জন্য আলাদা service pages আছে)

ফলে পেইজ হবে personal cash drawer + journal — exactly user যা চেয়েছেন।