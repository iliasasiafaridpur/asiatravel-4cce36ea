## কারণ

`html2canvas` `oklch()` color function বুঝে না। আমাদের offscreen receipt node-এ inline hex/rgb দেওয়া আছে, কিন্তু সেটা `document.body`-তে append করায় page-এর সব CSS variables (যেগুলো `src/styles.css`-এ oklch) computed style হিসেবে চলে আসে। `html2canvas` সেগুলো parse করতে গিয়ে throw করে → toast: "JPG তৈরি করা যায়নি"।

Share Image বাটনও একই কারণে কাজ করছে না (একই `renderJpegBlob` ব্যবহার করে)।

## সমাধান

`html2canvas` সরিয়ে **`html-to-image`** ব্যবহার করব — এটা modern CSS (oklch, color-mix, css variables) সাপোর্ট করে।

### পরিবর্তন

1. **প্যাকেজ**
   - `bun remove html2canvas`
   - `bun add html-to-image`

2. **`src/components/ReceiptDialog.tsx`**
   - `import html2canvas from "html2canvas"` → `import { toJpeg } from "html-to-image"`
   - `renderJpegBlob()` rewrite:
     ```ts
     const dataUrl = await toJpeg(node, {
       quality: 0.95,
       pixelRatio: 2,
       backgroundColor: "#ffffff",
       cacheBust: true,
     });
     const blob = await (await fetch(dataUrl)).blob();
     ```
   - `buildPrintableNode()` অপরিবর্তিত (inline styled, safe colors)।
   - `handleDownloadJpg` ও `handleShareImage` একই blob ব্যবহার করবে — অন্য কোনো লজিক বদলাচ্ছে না।

3. **fallback** — যদি কোনো কারণে generation fail হয়, console-এ error log করব যাতে debug সহজ হয়।

### যাচাই

- Receipt popup → JPG বাটন → file ডাউনলোড হবে।
- Share Image বাটন (সাপোর্টেড ডিভাইসে) → JPG share dialog আসবে।
- Print, Copy, WhatsApp, Close — অপরিবর্তিত।
