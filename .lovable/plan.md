## সমস্যা
এখন service entry (Ticket / BMET / Saudi / Kuwait) delete করলে কেবল ঐ row যায়, কিন্তু `agency_ledger`, `vendor_ledger`, `payment_receipts` এ পুরনো রেকর্ড থেকে যায় — তাই Ledger / Accounts / Report এ ভুল হিসাব দেখায়। Day Book ও Reports সরাসরি service টেবিল থেকে পড়ে, তাই triggers বসালে সেগুলো এমনিতেই পরিষ্কার হবে।

ডাটাবেইজে cleanup function আছে (`cleanup_ledgers_on_delete`, `cleanup_service_receipts`) কিন্তু trigger attached নেই।

## সমাধান

### ১) Database migration — সব service টেবিলে trigger যুক্ত
চারটি টেবিলেই (`tickets`, `bmet_cards`, `saudi_visas`, `kuwait_visas`):
- `BEFORE DELETE` → `cleanup_ledgers_on_delete` (agency + vendor ledger মুছবে)
- `BEFORE DELETE` → `cleanup_service_receipts` (payment_receipts মুছবে)
- পাশাপাশি `AFTER INSERT/UPDATE` sync triggers ও নিশ্চিত করা — যাতে নতুন entry লিখলে ledger/receipt ঠিকমতো তৈরি হয়

ফলাফল: একটা service row delete করলেই Day Book, Agency Ledger, Vendor Ledger, Accounts, Report — সব জায়গা থেকে স্বয়ংক্রিয়ভাবে মুছে যাবে।

### ২) Frontend — কনফার্মেশন popup
`src/components/ModulePage.tsx` এর delete handler এ AlertDialog যোগ করব:
> "আপনি কি নিশ্চিত? এই এন্ট্রি delete করলে সংশ্লিষ্ট ledger ও payment receipt ও মুছে যাবে। এটি ফেরানো যাবে না।"
> [বাতিল]  [হ্যাঁ, Delete করো]

### ফাইল পরিবর্তন
- নতুন migration (triggers attach)
- edit: `src/components/ModulePage.tsx` (confirmation dialog)

অনুমোদন দিলে শুরু করব।