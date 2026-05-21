## Receipt কে JPG হিসেবে Download

হ্যাঁ, সম্ভব। `html2canvas` library ব্যবহার করে receipt এর DOM (`printRef`) কে canvas এ render করব, তারপর `canvas.toBlob('image/jpeg')` দিয়ে JPG file বানিয়ে download trigger করব।

### পরিবর্তন

**1. Package install**
- `bun add html2canvas`

**2. `src/components/ReceiptDialog.tsx`**
- নতুন `handleDownloadJpg()` function:
  - `html2canvas(printRef.current, { scale: 2, backgroundColor: '#ffffff' })` দিয়ে high-DPI snapshot
  - `canvas.toBlob(blob => ...)` → `image/jpeg`, quality `0.95`
  - একটি hidden `<a>` element তৈরি করে `download="Receipt-{receiptId}.jpg"` দিয়ে click → auto download
  - Success/error toast
- Footer এ নতুন **"JPG"** button যোগ (Image icon সহ), বিদ্যমান Close / Copy / Print / WhatsApp এর পাশে
- Button row ইতিমধ্যেই `flex-wrap` — নতুন button সুন্দর fit হবে

**3. WhatsApp এ JPG পাঠানোর bonus path (mobile)**
- যদি `navigator.canShare({ files: [...] })` support করে (mostly mobile browser), একই JPG blob কে `File` বানিয়ে `navigator.share()` দিয়ে সরাসরি WhatsApp/অন্য app এ share করার option যোগ করা যায় — button label: **"Share Image"**
- Desktop / unsupported browser এ এই button hide থাকবে; user JPG download করে manually attach করবেন

### কেন JPG ভালো option

- WhatsApp Web/App এ image attach করা PDF এর চেয়ে সহজ (drag-drop বা mobile gallery থেকে)
- BD তে `wa.me` block থাকলেও WhatsApp app/web এ image সরাসরি paste/attach করা যায়
- File size ছোট (~50–150 KB)
- Print/PDF option আগের মতই থাকবে — কেউ চাইলে PDF নিতে পারবেন

### Technical notes

- `html2canvas` Tailwind/oklch color পুরোপুরি support করে না কখনো কখনো — যদি color rendering সমস্যা হয়, receipt block এর জন্য inline fallback styles (যা ইতিমধ্যে print HTML এ আছে) ব্যবহার করব
- Filename format: `Receipt-{receiptId}-{passengerName}.jpg`
