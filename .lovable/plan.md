## লক্ষ্য

পুরো সফটওয়্যারে হালকা রঙিন থিম যোগ করা — Soft Cool Tones প্যালেট (নীল, বেগুনি, পিঙ্ক, লেভেন্ডার)। প্রতিটি ID রো-তে আলাদা হালকা কালার। **শুধু কালার পরিবর্তন, অন্য কোনো logic/structure/UI behavior পরিবর্তন হবে না।**

## প্যালেট (নির্বাচিত)

```
#e0f2fe  হালকা আকাশি
#ede9fe  হালকা লেভেন্ডার
#fce7f3  হালকা পিঙ্ক
#f0f9ff  হিম-নীল
#f5f3ff  সফট ভায়োলেট
#fdf2f8  সফট রোজ
```

## পরিবর্তন

### ১) Global background (`src/styles.css`)
- `--background` টোকেনকে হালকা multi-color gradient/tint-এ আপডেট করা (light mode)। Dark mode অপরিবর্তিত।
- `--card` সামান্য সাদাটে রেখে gradient background-এর উপরে বসবে।
- নতুন CSS utility class `.row-tint-0` থেকে `.row-tint-5` যোগ করা হবে — প্রতিটি প্যালেট থেকে একটি হালকা ব্যাকগ্রাউন্ড দেবে। Hover state ও print mode-এ এই tint মৃদু হবে।

### ২) Row coloring (প্রতি ID-তে আলাদা কালার)

নিচের ফাইলগুলোতে data table-এর প্রতিটি `<TableRow key=...>`-এ index-based class যোগ করা হবে: `row-tint-${index % 6}`। **শুধু className যোগ — আর কিছু না।**

- `src/components/ModulePage.tsx` (line 773 — সকল service module: tickets, bmet, saudi-visa, kuwait-visa)
- `src/components/LedgerPage.tsx` (line 953 — agency-ledger, vendor-ledger)
- `src/routes/accounts.tsx` (Accounts table এর body rows)
- `src/routes/agents.tsx` (line 40)
- `src/routes/vendors.tsx` (line 40)
- `src/components/AccountingModule.tsx` (lines 404, 446, 469)
- `src/routes/invoice.tsx` (যদি list থাকে)

### ৩) Print preserve
`@media print`-এ row tint হালকা রাখা হবে (যাতে প্রিন্টে রঙ না আসলেও সমস্যা না হয়), অপশনাল `-webkit-print-color-adjust: exact` যোগ করে রঙিন প্রিন্ট সক্ষম রাখা।

## কী পরিবর্তন হবে না (গ্যারান্টি)

- কোনো logic, query, filter, form, validation, RLS, route, navigation, business rule অপরিবর্তিত
- কোনো column add/remove নেই
- কোনো text/