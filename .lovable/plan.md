
# Action Board ফর্ম — Compact ও Fast Entry পরিকল্পনা (পরামর্শ)

বর্তমানে `FormSections` (ModulePage.tsx) প্রতি field কে আলাদা row + label সহ 2-column grid এ দেখায়, gap-3, py-2, section heading সহ। ফলে পেইজ অনেক লম্বা হয় এবং মাউস স্ক্রল বেশি লাগে। নিচে কী কী পরিবর্তন করব ও কেন তা ব্যাখ্যা করছি — তোমার সম্মতি পেলে implement করব।

## ১. Layout — পেইজ ছোট করা

- **3-column grid** (sm:2, lg:3) — এখন 2-column; বড় স্ক্রিনে 3 কলাম দিলে উচ্চতা ~33% কমবে।
- **Compact spacing** — `space-y-5 py-2` → `space-y-3`, grid `gap-3` → `gap-2`, Input/Select height `h-9` → `h-8`, Label `text-sm` → `text-xs`, Label-input gap `space-y-1.5` → `space-y-0.5`.
- **Floating / inline label** — Label কে input এর উপরে আলাদা row না দিয়ে input এর ভিতর placeholder + ছোট uppercase caption হিসেবে দেখানো। প্রতি field-এ ~20px সাশ্রয়।
- **Section header inline** — section heading আলাদা border-b row না, একটা ছোট pill/chip হিসেবে first field এর সাথে। অথবা section কে collapsible accordion।
- **Textarea (Note/Remarks) ছোট** — `rows={2}` → `rows={1}` auto-grow।
- **Boolean field গুলো একটা row তে** চেকবক্স group আকারে।

## ২. Smart Entry — কম keystroke, কম স্ক্রল

- **Keyboard navigation** — Enter চাপলে পরের field এ যাবে (textarea বাদে), শেষ field থেকে Enter → Save। Tab order ঠিক রাখা।
- **Global shortcuts** — `Ctrl+S` Save, `Ctrl+K` Search, `Ctrl+R` Clear, `Alt+1..9` Service Category দ্রুত পরিবর্তন।
- **Service Category কে chip/tab bar** — dropdown না, top এ horizontal scroll chip গুলো (Ticket/BMET/Saudi/Kuwait...) — এক click এ পরিবর্তন, কীবোর্ড-friendly।
- **Auto-focus** — category পরিবর্তন বা save পরে cursor সরাসরি প্রথম মুখ্য field (passenger_name বা passport) এ।
- **Smart defaults** — entry_date=today, sub_agency=Self, entry_by=current user (আগেই আছে), status=first; বাকি optional field গুলো folded।
- **Passport scan + OCR fast-path** — এখন আছে; scan সফল হলে auto-focus পরের খালি field এ।
- **Number field UX** — focus এ auto-select (আছে), 0 হলে placeholder; Tab চাপলে empty → 0 না করে skip।
- **Money quick-keys** — amount field এ `5k`, `10k`, `1.5l` লিখলে সংখ্যায় রূপান্তর।
- **Mobile field** — auto-format, 11 digit হলে next field এ auto-jump।
- **Sub-Agent / Vendor LookupSelect** — type-ahead এ Enter চাপলে first match select।

## ৩. Progressive Disclosure — অপ্রয়োজনীয় field লুকানো

- **"Essentials" mode (default)** — শুধু required + frequently-used field দেখাবে (passport, name, mobile, sold price, cost price, vendor, status, entry_date)।
- **"More fields" toggle** — বাকি field (remarks, secondary contacts, optional dates) এক click এ expand।
- প্রতি module-এ `essential: true` ফ্ল্যাগ দিয়ে কনফিগ করা হবে `modules.ts` এ।

## ৪. Sticky Action Bar

- উপরের Category selector + Save/Search/Clear button কে **sticky top bar** করা। স্ক্রল করলেও সবসময় হাতের কাছে — Save এর জন্য নিচে যেতে হবে না।
- নিচের duplicate Save button সরিয়ে দেয়া (sticky bar যথেষ্ট) → আরো ছোট পেইজ।

## ৫. Edit Dialog — একই compact layout

Edit এর `Dialog` এর ভিতরেও `FormSections` use হয়, তাই উপরের সব পরিবর্তন এডিট ফর্মেও স্বয়ংক্রিয়ভাবে আসবে। অতিরিক্ত:
- Dialog এর width `max-w-3xl` রেখে height সীমিত, ভিতরে scroll এর বদলে compact grid এ পুরোটা একসাথে।
- Footer Save button sticky।

## ৬. ফলাফল (অনুমিত)

| পরিবর্তন | Impact |
|---|---|
| 3-column + compact spacing | পেইজ উচ্চতা ~40-50% কম |
| Essentials mode | প্রথম দর্শনে ~60% কম field |
| Sticky save bar + Enter-to-next | স্ক্রল ~80% কম, মাউস click ~70% কম |
| Shortcuts + chip category | কীবোর্ডেই পুরো এন্ট্রি possible |

## জিজ্ঞাসা

implement শুরু করার আগে কনফার্ম করো:

1. **Layout** — 3-column compact + sticky save bar OK?
2. **Essentials mode** ডিফল্ট চাও, না কি সব field সবসময় visible (শুধু compact)?
3. **Service Category** — dropdown রাখব নাকি chip/tab bar এ পরিবর্তন করব?
4. **Keyboard shortcut** (Enter→next, Ctrl+S save) যোগ করব?

তোমার উত্তর পেলে এই অনুযায়ী `FormSections`, `FormField`, `action-board.tsx` ও edit dialog refactor করব। কোনো business logic / data পরিবর্তন হবে না — শুধু UI/UX।
