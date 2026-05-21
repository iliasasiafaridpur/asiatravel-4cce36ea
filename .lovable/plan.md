## সমস্যা

1. **Blank JPG** — `buildPrintableNode()` এ node-কে `position:fixed; left:-10000px` দিয়ে viewport-এর বাইরে রাখা হচ্ছে। `html-to-image` কিছু ক্ষেত্রে off-screen fixed node-এর computed layout/size ঠিকমতো পায় না (বিশেষ করে যখন node-এর explicit `width/height` set নেই বা parent visibility issue থাকে) — ফলে সাদা/blank image generate হয়। এছাড়া web fonts load না হলেও text render হয় না।

2. **Share Image ও WhatsApp বাটন** দরকার নেই — সরাতে হবে।

## সমাধান

### `src/components/ReceiptDialog.tsx`

**A. Blank JPG fix — `buildPrintableNode()` rewrite**
- Off-screen positioning বদলে node-কে `position: fixed; top: 0; left: 0; z-index: -1; opacity: 0; pointer-events: none;` রাখব — viewport-এর ভেতরে কিন্তু invisible। html-to-image properly measure ও render করতে পারবে।
- Explicit `width: 520px` রাখব (already আছে), সাথে inline `box-sizing: border-box`।
- `renderJpegBlob()` এ `toJpeg` call করার আগে `await document.fonts.ready` দেব যাতে fonts লোড থাকে।
- `toJpeg` options এ explicit `width: 520`, `height: node.offsetHeight` যোগ করব যাতে সঠিক canvas size হয়।

**B. Share Image ও WhatsApp বাটন সরানো**
- `handleShareImage`, `handleWhatsApp`, `canShareFiles`, `receiptText` (যদি শুধু এদের জন্য থাকে — Copy বাটনেও ব্যবহৃত হয়, তাই রাখব), `normalizeBdPhone` (শুধু WhatsApp-এ ব্যবহৃত — সরাবে), `onlyDigits` (শুধু normalizeBdPhone-এ — সরাবে) — function ও বাটন JSX দুটোই সরাব।
- `MessageCircle`, `Share2` icon import সরাব।

**C. বাকি বাটন (বন্ধ, Copy, Print/PDF, JPG) অপরিবর্তিত।**

### যাচাই
- Receipt popup → JPG → ডাউনলোড হওয়া ফাইলে সব receipt তথ্য দেখাবে।
- Footer-এ শুধু ৪টা বাটন: বন্ধ, Copy, Print/PDF, JPG।
