## সমস্যা

Delivery-সংক্রান্ত status change-এ Confirm চাপলে `StatusChangeDrawer` → `setReceipt(...)` করে, যাতে `<ReceiptDialog receipt={...} />` রি-রেন্ডার হয়। কিন্তু `src/components/ReceiptDialog.tsx`-এ Hook-এর order ভুল:

```tsx
const printRef = useRef<HTMLDivElement>(null);   // hook #1
if (!receipt) return null;                        // ← early return
...
const [busy, setBusy] = useState(false);          // hook #2 — only when receipt is non-null
```

প্রথম render (receipt = null): শুধু hook #1 চলে।
দ্বিতীয় render (receipt = object): hook #1 + hook #2 চলে → React Rules of Hooks ভঙ্গ → "Rendered more hooks than during the previous render" throw → root `errorComponent` (router.tsx এর `DefaultErrorComponent`) ধরে → "This page didn't load" স্ক্রিন।

## ফিক্স (একটাই ফাইল)

`src/components/ReceiptDialog.tsx` — সব hook (`useRef`, `useState`) `if (!receipt) return null` লাইনের **উপরে** নিয়ে যাওয়া। বাকি লজিক/UI অপরিবর্তিত।

```tsx
export function ReceiptDialog({ receipt, open, onClose }: {...}) {
  const printRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);     // ← উপরে আনলাম

  if (!receipt) return null;                    // এখন hooks-এর পরে
  // ... বাকি সব আগের মতো
}
```

এতে hook count সব render-এ একই থাকবে, crash বন্ধ হবে, Confirm → Payment Receipt popup ঠিকমতো খুলবে।

## যাচাই

- Status "Delivered" (due > 0) এ Confirm → Receipt popup আসবে, error page আর আসবে না।
- JPG / Copy / WhatsApp / Print বাটনগুলোর আচরণ অপরিবর্তিত।
