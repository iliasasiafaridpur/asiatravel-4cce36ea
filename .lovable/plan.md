
## কাজের পরিকল্পনা — বড় আপগ্রেড (৭টি অংশ)

কাজটি বড় হওয়ায় ৭টি ধাপে ভাগ করেছি। সবগুলো একই সাথে বাস্তবায়ন করব।

---

### ১) Sound System সরানো (Settings রাখা হবে)
- `src/lib/voice.ts` থেকে সব speak কলগুলো no-op করে দেব
- `ModulePage.tsx`, `AuthGate.tsx`, `action-board.tsx` থেকে voice কল সরাব
- `Settings` পেইজ থেকে Sound section সরিয়ে শুধু **Profile**, **Password**, **Maintenance** রাখব

---

### ২) Login + Sign-Up + Admin User Activation

**Sign-Up Page (নতুন):** Full Name, Mobile Number, পদবি (Designation), Email, Password
- নতুন user signup করলে **`is_active = false`** স্ট্যাটাসে থাকবে
- লগইন এর সময় চেক হবে — inactive হলে message: "Admin activation প্রয়োজন"

**Profiles টেবিলে নতুন কলাম:**
- `mobile` (text)
- `designation` (text)
- `is_active` (boolean, default false)
- প্রথম user যিনি signup করবেন তিনি auto admin + active হবেন (trigger দিয়ে)

**Admin → User Management পেইজ (নতুন `/users` route):**
- সব user list, Active toggle, Role assign (admin/staff)
- শুধু admin দেখতে/edit করতে পারবে

---

### ৩) Invoice আপগ্রেড

**Lookups টেবিল ব্যবহার করে dropdown:**
- `airline` (Salam Air, Biman, Emirates ইত্যাদি)
- `route` / `airport` (DAC, JED, RUH, KWI, DXB ইত্যাদি — From/To)
- `service_item` (AIR TICKET, BMET, SAUDI VISA, KUWAIT VISA, MEDICAL, ATTESTATION ইত্যাদি)

প্রতিটি dropdown এর পাশে **+ Add** ও **🗑 Delete** বাটন থাকবে — instant lookup add/remove।

**Item editor পরিবর্তন:**
- "Description" → **Service Item dropdown**
- নতুন কলাম: **From (dropdown)** → **To (dropdown)**, **Airline (dropdown)**
- Passenger name আর item description এ আসবে না
- "Status" / "Class" (Economy/Pending) ফিল্ড সরানো হবে

**Header ফন্ট বড় করা:**
- Travel name: text-2xl → **text-3xl/4xl bold**
- Address + Phone: text-xs → **text-sm/base**

---

### ৪) Day Book আপগ্রেড — Advanced Filter

`/day-book` পেইজে নতুন filter bar:
- **Date Range** — Start Date + End Date (দুটো আলাদা)
- **Service Type** dropdown (All / Tickets / BMET / Saudi / Kuwait)
- **Agent** dropdown
- **Vendor** dropdown
- **Received By (User)** dropdown
- **Status** dropdown
- "Reset" + "Apply" বাটন
- Summary cards (Total sales, received, due) filter অনুযায়ী আপডেট হবে

---

### ৫) Service Entry Detail View — সম্পূর্ণ তথ্য

বর্তমানে list এ সব column দেখায় না। সমাধান:
- প্রতিটা module list row এ ক্লিক করলে **Detail Dialog** খুলবে
- entry form এর **সব ফিল্ড** দেখাবে (read-only) + Edit/Delete বাটন
- ModulePage এ একটি universal `<EntryDetailDialog>` কম্পোনেন্ট

---

### ৬) BMET Tracking System

`bmet_cards` টেবিলে নতুন কলাম:
- `submitted_date` (কাজ কবে জমা দেওয়া হয়েছে)
- `current_stage` (text: 'Submitted', 'Under Process', 'Fingerprint Done', 'Approved', 'Card Ready', 'Delivered')
- `stage_updated_at` (timestamp)
- `stage_history` (jsonb — প্রতিটা stage change এর log)

BMET form এ:
- **Tracking section** যোগ করব — Stage timeline দেখাবে
- Stage update করলে history তে save হবে (কে, কখন)

---

### ৭) Payment Receiver Tracking

ইতোমধ্যে `payment_receipts` টেবিলে `received_by` + `received_by_name` আছে।

উন্নতি:
- প্রতিটা service module এর list এ **"Received By"** column যোগ করব
- Day Book এ filter হিসেবে আসবে (#৪ এ যুক্ত)
- Accounts page এ user-wise breakdown ইতিমধ্যে আছে — শুধু link/view যোগ করব

---

### Database Migration সারাংশ
```
profiles: + mobile, + designation, + is_active
bmet_cards: + submitted_date, + current_stage, + stage_updated_at, + stage_history
+ trigger: প্রথম signup auto admin+active
+ trigger: BMET stage change history log
+ lookup kinds: airline, route, service_item (existing lookups টেবিলেই)
```

---

### ফাইল পরিবর্তন (আনুমানিক)
- Edit: `voice.ts`, `AuthGate.tsx`, `ModulePage.tsx`, `action-board.tsx`, `settings.tsx`, `invoice.tsx`, `day-book.tsx`, `AppSidebar.tsx`, `accounts.tsx`
- New: `routes/signup.tsx`, `routes/users.tsx` (admin), `components/EntryDetailDialog.tsx`, `components/LookupManager.tsx`, `components/BmetTracking.tsx`
- Migration: ১টি বড় SQL migration

---

### সতর্কতা
এটি একটি বড় কাজ — সব একসাথে করলে ১৫-২০টি ফাইল পরিবর্তন হবে। build/test এর পর কিছু polish লাগতে পারে।

**অনুমোদন দিলে শুরু করব। কোনো অংশ বাদ/পরিবর্তন চাইলে এখনই বলুন।**
