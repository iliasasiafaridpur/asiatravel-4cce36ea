পরিকল্পনা — চারটি ফিচার একসাথে যোগ করা হবে।

## ১. Database — Dynamic Lookup table

নতুন একটি `lookups` টেবিল তৈরি হবে যেখানে ডাইনামিক ড্রপডাউন অপশনগুলো জমা থাকবে:

```
lookups (id, kind, value, created_at)
kind = 'country' | 'airline' | 'sub_agency' | 'vendor'
unique (kind, value)
```

পাবলিক RLS (insert/select/delete) থাকবে। কিছু ডিফল্ট কান্ট্রি/এয়ারলাইন seed করা হবে।

কোনো বিদ্যমান টেবিলের কলাম পরিবর্তন/মুছে ফেলা হবে না — শুধু লেবেল পরিবর্তন:
- `agency_sold` কলামে এখনো ডেটা সেভ হবে, কিন্তু UI-তে দেখাবে **Sub Agency / Reference**
- `vendor_bought` কলামে vendor নাম সেভ হবে, UI ড্রপডাউন থেকে
- BMET-এর `received_date` লেবেল হবে **Received Date From Vendor**

## ২. modules.ts schema পরিবর্তন

প্রতিটি ফিল্ডে নতুন optional প্রপার্টি:
- `lookup?: 'country' | 'airline' | 'sub_agency' | 'vendor'` — ডাইনামিক ড্রপডাউন
- `format?: 'name' | 'passport' | 'mobile'` — ইনপুট ফরম্যাটিং
- `section?: 'passenger' | 'agency' | 'vendor'` — ফর্মে গ্রুপিং

ফিল্ডের ক্রম রিঅর্ডার (Tickets, BMET, Saudi/Kuwait Visa, Manpower):
1. **Passenger section** — entry_date, passenger_name, passport, mobile, [airline/visa_no/country], flight_date, sold_price, status
2. **Sub Agency / Reference section** — sub_agency (dropdown), received (পেমেন্ট)
3. **Vendor section** — vendor (dropdown), cost_price, vendor_sent_date, received_date_from_vendor, pnr/visa_no, notes

লেবেল পরিবর্তন: "Agency Sold" → "Sub Agency / Reference", "Vendor Bought" → "Vendor", "Received Date" → "Received Date From Vendor"।

## ৩. ModulePage ফর্ম পরিবর্তন

- **Section heading**: ফর্মে তিনটি সেকশন হেডার দেখাবে — Passenger Details, Sub Agency / Reference, Vendor Information
- **LookupSelect কম্পোনেন্ট**: ড্রপডাউন + পাশে ছোট `+` বাটন। `+` চাপলে inline dialog খোলে নতুন value যোগ করার জন্য, save হলে তাৎক্ষণিক list-এ যুক্ত হয় ও সিলেক্ট হয়
- **Input ফরম্যাটিং**:
  - `format='name'` → প্রতিটি শব্দের প্রথম অক্ষর Capitalize on blur
  - `format='passport'` → অক্ষর uppercase, on input
  - `format='mobile'` → শুধু digit রাখে, ৫টি digit-এর পর `-` insert (mask), max 12 chars (`01711-XXXXXX`)
- তারিখ display সর্বত্র `formatDate()` (DD-MMM-YYYY) — এটি `modules.ts`-এ আছে, list view-তে ইতিমধ্যে ব্যবহৃত

## ৪. Smart Dashboard — `src/routes/index.tsx` পুনর্নির্মাণ

নতুন কন্ট্রোল:
- **Date Range Picker** (Popover + shadcn Calendar): "All / This Month / This Year / Custom" preset + custom date range
- **Module ফিল্টার** চিপ-গ্রুপ (Tickets, BMET, Saudi Visa, Kuwait Visa, Manpower)
- **Country ফিল্টার** ড্রপডাউন — শুধু Tickets+BMET সিলেক্ট থাকলে দেখাবে; দেশ অনুযায়ী চার্ট/স্ট্যাট ফিল্টার করবে (Tickets-এ এয়ারলাইন/route ডেটা; BMET-এ `country_name`)
- চারটি গ্রাফ:
  1. **Pie chart** — মডিউলভিত্তিক এন্ট্রি ভাগ
  2. **Bar chart** — মাসিক এন্ট্রি (ফিল্টার অনুযায়ী)
  3. **Pie chart** — Status distribution
  4. **Bar chart** — Top countries (BMET) বা Top airlines (Tickets)
- উপরে স্ট্যাট কার্ড (মোট entries, মোট sold, মোট received, due) — ফিল্টার হিসেবে আপডেট হবে
- সাম্প্রতিক এন্ট্রি লিস্ট — DD-MMM-YYYY ফরম্যাটে

সব চার্ট recharts দিয়ে interactive (tooltip, color cells)।

## ফাইল পরিবর্তনসমূহ

- **নতুন migration**: `lookups` টেবিল + RLS + কিছু seed data
- **নতুন**: `src/components/LookupSelect.tsx`
- **নতুন**: `src/lib/format.ts` (input formatters)
- **এডিট**: `src/lib/modules.ts` (field section/lookup/format meta + reorder)
- **এডিট**: `src/components/ModulePage.tsx` (section heading + LookupSelect + formatter integration)
- **এডিট**: `src/routes/index.tsx` (Smart Dashboard বানানো)

ডেটাবেস স্কিমাতে কোনো destructive পরিবর্তন নেই; পুরনো ডেটা অক্ষুন্ন থাকবে।
