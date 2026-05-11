## লক্ষ্য
আপনার ৪টি বড় চাওয়া একসাথে সমাধান করব — কোনটাই অর্ধেক রাখব না।

---

## ১) Passport OCR (পাসপোর্টের ছবি তুলে অটো-ফিল)

**যেভাবে কাজ করবে:**
- যেকোনো এন্ট্রি ফর্মে (Tickets / BMET / Saudi / Kuwait) উপরে একটা **📷 "পাসপোর্ট স্ক্যান"** বাটন থাকবে
- মোবাইলে ক্যামেরা সরাসরি খুলবে, ছবি তুলবেন → Lovable AI (Gemini Vision) সেটা পড়বে
- অটো-ফিল হবে: **নাম (passenger_name), পাসপোর্ট নাম্বার, জন্ম তারিখ, ইস্যু/মেয়াদ তারিখ, জাতীয়তা**
- ভুল হলে আপনি edit করতে পারবেন — তারপর Save

**টেক:** `supabase/functions/passport-ocr` edge function, Gemini 2.5 Flash (free tier-এ চলবে), MRZ + visual zone দুটোই পড়বে।

---

## ২) PWA (মোবাইলে ইনস্টলযোগ্য, অফলাইনে আংশিক চলবে)

- Manifest + icon + Add-to-Home-Screen prompt
- Service Worker (production-only, dev-এ disabled — যাতে Lovable preview ঠিক থাকে)
- লগইন স্ক্রিনে "📲 হোম স্ক্রিনে যোগ করুন" বাটন
- আইকন আমি generate করে দেব (Asia Travel লোগো স্টাইলে)
- মোবাইলে সব পেজ আরও touch-friendly করব (বড় বাটন, sticky save bar)

---

## ৩) সহজ এন্ট্রি + Auto-Ledger (Agency / Vendor)

**বর্তমান সমস্যা:** ফর্ম বড়, অগোছালো; agency/vendor লিখলেও খাতায় ঠিকমতো যায় না বলে মনে হচ্ছে।

**নতুন সিস্টেম:**
- প্রতিটা এন্ট্রি ফর্মকে **Wizard স্টাইল 3 ধাপে** ভাঙব:
  1. **যাত্রী তথ্য** (পাসপোর্ট OCR বাটন এখানে)
  2. **বিক্রয় (Agency)** — কোন এজেন্সিতে বিক্রি, কত টাকা, কত পেলেন
  3. **ক্রয় (Vendor)** — কোন vendor থেকে নিয়েছেন, কত খরচ, কত দিয়েছেন
- Agency/Vendor dropdown-এ **"+ নতুন যোগ করুন"** inline option (পেজ ছাড়তে হবে না)
- **DB ট্রিগার আগে থেকেই বানানো আছে** (`sync_agency_ledger`, `sync_vendor_ledger`) — শুধু verify করব যে ঠিকমতো ফায়ার হচ্ছে এবং ledger পেজে balance ঠিক দেখাচ্ছে
- প্রতিটা agency/vendor এর কার্ডে **পাওনা / প্রদেয় ব্যালেন্স** badge

---

## ৪) BMET কার্ড — সহজ এন্ট্রি, ট্র্যাকিং ও আপডেট

**নতুন BMET পেজ:**
- **3 status filter tab** উপরে: 🟡 Pending | 🔵 Vendor-এ পাঠানো | 🟢 Delivered
- প্রতিটা card-এ: যাত্রীর নাম, পাসপোর্ট, বর্তমান stage, কত দিন pending
- One-click stage update (Pending → Sent → Received → Delivered) — tap করলে সাথে সাথে date বসবে
- বাকি টাকার alert badge

---

## ৫) ⭐ Smart Accounts — Manager Cash Drawer System

এটাই সবচেয়ে গুরুত্বপূর্ণ। নতুন concept:

**মূল ধারণা:** প্রতিটা ইউজারের একটা **"Cash Drawer" (টাকার বাক্স)** আছে।

```
Manager-এর Cash Drawer:
  + আজ রিসিভ:        ৳ 25,000   (৫টা এন্ট্রি থেকে অটো)
  + পূর্বের ব্যালেন্স:  ৳  3,000
  - Md Sir-কে দিলেন:  ৳ 20,000   (Cash Transfer)
  - অফিস খরচ:          ৳   500
  ─────────────────────────────
  = বর্তমান হাতে:     ৳  7,500  ← এই মুহূর্তে আপনার কাছে এত টাকা আছে
```

**যেভাবে কাজ করবে:**
1. আপনি (Manager) যখন কোনো সার্ভিসে `received_amount` এন্ট্রি দেবেন → অটো আপনার drawer-এ + হবে (received_by = আপনি)
2. দিন শেষে **"Hand Over to Md Sir"** বাটন চাপলে → একটা ডায়লগ আসবে আজ মোট কত রিসিভ করেছেন, কত হ্যান্ডওভার করছেন → সেভ করলে drawer থেকে − হবে
3. Md Sir-এর drawer-এ + হবে অটো
4. **নতুন পেজ `/cash-drawer`** — দুই ইউজারের live balance, daily closing, history

**নতুন টেবিল:** `cash_expenses` (অফিস খরচ tracking — কে কখন কী খাতে কত খরচ করল)

**Day Closing Report:** প্রতিদিন রাতে এক ক্লিকে আজকের সব রিসিভ + সব খরচ + হ্যান্ডওভার + closing balance — PDF/print ready।

---

## কাজের ক্রম

আমি একসাথে সব করব এই sequence-এ:
1. DB মাইগ্রেশন: `cash_expenses` টেবিল + `daily_closings` টেবিল + drawer balance view
2. Edge function: `passport-ocr` (Lovable AI)
3. ফ্রন্টএন্ড:
   - PassportScanner কম্পোনেন্ট (camera + OCR)
   - 3-step Wizard ফর্ম (ModulePage refactor)
   - Cash Drawer পেজ + Hand Over dialog
   - BMET কার্ড নতুন UI (status tabs)
   - Inline "+ Add" agency/vendor
4. PWA: manifest, icons, service worker (prod-only guard সহ)
5. Mobile polish: bottom nav, sticky save bar, বড় touch target

---

## আপনার করণীয় (কিছুই না — শুধু approve)

সব কোড ও মাইগ্রেশন আমি লিখব। শুধু একটাই জিনিস confirm করুন:

**প্রশ্ন:** Cash Drawer-এ "অফিস খরচ" এন্ট্রির categories কী কী রাখব? (যেমন: Transport, Stationery, Bill, Food, Other)

আপনি Approve করলে আমি কাজ শুরু করব।