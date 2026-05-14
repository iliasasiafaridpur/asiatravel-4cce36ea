## Scope

Agency খাতা (`/agency-ledger`) এবং Vendor খাতা (`/vendor-ledger`) — দুটো পেজে আপনার দেওয়া ৪ ধাপের redesign। `ModulePage.tsx` shared হওয়ায় অন্য মডিউল (Tickets, BMET, Visa) এর UI অপরিবর্তিত থাকবে — শুধু ledger module-এর জন্য নতুন behavior চালু হবে (group-by + summaryFields যেগুলোতে আছে)।

## ধাপ ১ — Header + KPI cards

- উপরে title + "মোট N এন্ট্রি" এর পাশে quick action button উপরে-ডানে: `+ নতুন এন্ট্রি` এবং `+ Receive Payment` (DueReceiveDialog open)।
- তার নিচে ৩টি modern KPI card (subtle border, dark-mode-friendly):
  - **Total Bill / Total Payable** — neutral
  - **Total Received / Total Paid** — emerald accent (border + icon)
  - **Total Due** — bright rose accent (highlighted, larger number)
- বর্তমান `summary` block-টি replace করে এই ৩-card grid বানাবো। Summary already computed from filtered rows — শুধু presentation change।

## ধাপ ২ — Sleek single-line filter bar

- বর্তমান grid filter (Start Date, End Date আলাদা, Agent dropdown, Reset) replace হবে এক sticky horizontal bar দিয়ে:
  - **বামে** — search input with leading 🔍 icon (full-width on mobile)
  - **মাঝে** — Date Range Picker (single popover, shadcn Calendar `mode="range"`) → "Last 7 days / This month / Custom" presets
  - **মাঝে** — Agent/Vendor searchable dropdown (Combobox using shadcn Command + Popover, type-to-filter)
  - **ডানে** — শুধু Due toggle + Reset icon button
- Mobile (360px) এ stack হবে; desktop এ এক লাইনে।

## ধাপ ৩ — Modern ledger table

- Row vertical padding বাড়ানো (`py-3.5` per cell), zebra rows subtle।
- **Passenger column merge**: passenger name উপরে (font-medium), নিচে dimmed `text-xs text-muted-foreground` এ PNR/Ticket reference (যদি থাকে — agency_ledger-এ passenger ছাড়া reference নেই তাই শুধু passenger; ticket module-এ pnr merge হবে — কিন্তু আপনি ledger-এ asked, তাই ledger-এ passenger + service_type/country_route merge করবো secondary line হিসেবে)।
- **Balance Due color rule**:
  - `> 0` → light-red (`text-rose-400`) + clickable wallet icon (existing payment behavior preserved)
  - `= 0` → green "Paid" badge
- **Actions column**: clean icon-only buttons → 👁 View (read-only dialog showing all fields), 💳 Quick Pay (opens entry pre-filled with that row's agent + balance), ✏️ Edit, 🗑 Delete (kept)।

## ধাপ ৪ — Export, print, typography

- Group-summary card ও main ledger table এর header-এর right corner-এ icon buttons:
  - **Excel** — CSV/XLSX download of currently-filtered rows (using `xlsx` or simple CSV blob)
  - **PDF** — jsPDF + autoTable with brand header
  - **Print** — `window.print()` + dedicated print stylesheet (hide nav/sidebar, table only)
- Numbers → `font-mono tabular-nums`; labels → existing Bengali stack; subtle border `border-border/60` between table sections for dark-mode separation।

## Technical notes

- New file: `src/components/LedgerPage.tsx` — wraps `ModulePage` logic OR (cleaner) refactor: extract pure data hooks from `ModulePage` and create dedicated `LedgerView` component. To minimize risk, **option A**: keep `ModulePage` as-is, add `variant?: "ledger"` prop + conditional rendering blocks (KPI cards, sleek filter, action column, export). Routes `/agency-ledger` and `/vendor-ledger` will pass `variant="ledger"`.
- New deps: `xlsx` (or skip for CSV), `jspdf` + `jspdf-autotable`. Confirm before installing — CSV+browser print works without deps if you prefer zero new packages।
- New small components: `DateRangePicker.tsx`, `SearchableSelect.tsx` (Command+Popover combo)।
- Print stylesheet additions to `src/styles.css` under `@media print`।
- No DB / RLS / schema changes। Existing `summaryFields`, `groupBy`, `DueReceiveDialog` reused।

## Open questions before build

1. Quick Pay icon → existing entry form pre-fill (current behavior) ঠিক আছে, নাকি DueReceiveDialog open করবে?
2. Export — XLSX দরকার, নাকি CSV যথেষ্ট? (XLSX = +1 dep, CSV = zero dep)
3. PDF এ কোম্পানির logo/header text বসাবো? থাকলে কী লেখা?
