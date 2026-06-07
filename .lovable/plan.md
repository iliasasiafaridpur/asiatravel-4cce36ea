## লক্ষ্য

1. প্রতিটি সার্ভিস মডিউলের (Air Ticket, BMET, Saudi Visa, Kuwait Visa) এডিট/এন্ট্রি ফর্মে একটি **Extra Service** বাটন যোগ করা। ক্লিক করলে ঐ passenger-এর জন্য বাড়তি সার্ভিস যোগ করার ঘর খুলবে — প্রতিটিতে: service name (ড্রপডাউন, `+` দিয়ে নতুন যোগ ও Manage দিয়ে rename/delete), service price, ও service vendor cost। vendor cost ঐ row-এ আগে থেকে সিলেক্ট করা vendor-এর হিসাবেই যুক্ত হবে। data পেইজে `+` চিহ্ন দিয়ে দেখানো হবে।
2. নতুন **Other** মডিউল তৈরি করা — service name ড্রপডাউন (`+`/Manage সহ), service price, service vendor cost, এবং বাকি সব অন্য মডিউলের মতই (passenger, agency, received, vendor ইত্যাদি)।

## যা তৈরি হবে / বদলাবে

### ১. ডাটাবেস — `extra_services` টেবিল (Extra Service-এর জন্য)
নতুন টেবিল যা প্রতিটি extra সার্ভিসকে তার মূল entry-র সাথে যুক্ত রাখে:
- `source_table` + `source_id` (মূল row), `entry_date`
- `service_name`, `service_price` (কাস্টমার বিল), `vendor_cost`
- `vendor_name`, `agency_sold`, `passenger_name`, `passport`, `mobile` (ledger sync-এর জন্য denormalized — সেভ করার সময় মূল row থেকে কপি হবে)

এই টেবিলে trigger বসবে যা প্রতিটি extra সার্ভিসকে স্বয়ংক্রিয়ভাবে mirror করবে:
- **Vendor Data**-তে → `vendor_cost` ঐ সিলেক্ট করা vendor-এর payable হিসেবে যুক্ত হবে (বিদ্যমান নিয়ম অনুযায়ী)।
- **Customers Data**-তে → agency/reference থাকলে `service_price` কাস্টমারের বিল হিসেবে আলাদা লাইনে যুক্ত হবে (যাতে customer profile-এ দেখা যায়)।
মূল row delete হলে তার extra সার্ভিস ও তাদের mirror লাইনও মুছে যাবে।

### ২. শেয়ারড ফর্ম (`ModulePage.tsx`) — Extra Service UI
- হেডারে **Extra Service** বাটন যোগ হবে (বর্তমান close বাটনের সাথে সংঘর্ষ এড়িয়ে)।
- ক্লিক করলে একটি সেকশন খুলবে: প্রতিটি সারিতে `service name` (LookupSelect — `+`/Manage সহ), `service price`, `vendor cost`, ও remove বাটন; নিচে "আরও যোগ করুন" বাটন।
- vendor cost-এর জন্য আলাদা vendor নির্বাচন নেই — এটি ঐ row-এ ইতিমধ্যে সিলেক্ট করা vendor-এর হিসাবেই যাবে (আপনার নির্দেশ অনুযায়ী)।
- এডিট খুললে ঐ row-এর বিদ্যমান extra সার্ভিস লোড হবে; সেভ করলে নতুন/পরিবর্তিত/মুছে ফেলা extra সার্ভিস upsert/delete হবে (মূল row সেভ হওয়ার পরে, তার vendor/agency/passenger তথ্য কপি করে)।

### ৩. ডাটা পেইজে `+` চিহ্ন
- প্রতিটি মডিউল লিস্টে কোন row-এর extra সার্ভিস আছে তা গুনে passenger নামের পাশে ছোট `+N` ব্যাজ দেখানো হবে।

### ৪. নতুন **Other** মডিউল
- নতুন টেবিল `others` (অন্য সার্ভিস টেবিলের মতই কলাম: passenger, passport, mobile, `service_name` (lookup), sold_price, agency_sold, received_amount, discount, vendor_bought, cost_price, status, entry_by, notes ইত্যাদি) — GRANT + RLS (শুধু authenticated, পূর্ণ CRUD) সহ।
- বিদ্যমান sync trigger (vendor ledger, customer ledger, receipt) `others` টেবিলের জন্যও কাজ করবে।
- `modules.ts`-এ নতুন স্কিমা (key `other`, prefix `OTH`), route `src/routes/other.tsx`, এবং সাইডবারে "Other" আইটেম যোগ হবে।
- Other মডিউলেও উপরের Extra Service সুবিধা থাকবে।

## টেকনিক্যাল বিবরণ
- **Migration**: `extra_services` ও `others` টেবিল (GRANT → RLS → policy ক্রমে); `extra_services`-এর জন্য নতুন sync trigger function; বিদ্যমান `sync_vendor_ledger` / `sync_agency_ledger` / `sync_service_receipt` ও cleanup function-এ `others` ব্রাঞ্চ যোগ; `others`-এ একই trigger সংযুক্তি।
- **নতুন entry-তে extra সার্ভিস**: parent insert-এর পরে generated id দিয়ে extra rows যুক্ত হবে (insert-এর পর id রিড করে)।
- **Lookup kinds**: `extra_service` ও `other_service` (LookupSelect বিদ্যমান `+`/Manage সাপোর্ট ব্যবহার করবে); `LABELS`-এ যুক্ত হবে।
- **প্রভাবিত ফাইল**: `src/lib/modules.ts`, `src/components/ModulePage.tsx`, `src/components/LookupSelect.tsx` (শুধু label), `src/components/AppSidebar.tsx`, নতুন `src/routes/other.tsx`, এবং DB migration।
- বিদ্যমান কোনো accounting/সিঙ্ক ভাঙবে না — সব নতুন লাইন আলাদা `source_table='extra_services'`/`'others'` দিয়ে আইসোলেটেড থাকবে।

অনুমোদন দিলে আমি ধাপে ধাপে সাবধানে বাস্তবায়ন করব।