import { isAdvancePayment } from "@/lib/modules";

/**
 * Small "Advance" tag shown next to a deposit/received amount when the money
 * was received before the service was delivered.
 *
 * Use either:
 *  - <AdvanceBadge advance /> with a pre-computed boolean, or
 *  - <AdvanceBadge paymentDate={...} deliveryDate={...} /> to compute it.
 */
export function AdvanceBadge({
  advance,
  paymentDate,
  deliveryDate,
  className = "",
}: {
  advance?: boolean;
  paymentDate?: string | null;
  deliveryDate?: string | null;
  className?: string;
}) {
  const isAdv = advance ?? isAdvancePayment(paymentDate, deliveryDate);
  if (!isAdv) return null;
  return (
    <span
      className={`inline-flex items-center rounded px-1 py-0 text-[9px] font-semibold uppercase tracking-wide border border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-400 align-middle ${className}`}
      title="Payment received before delivery (Advance)"
    >
      Advance
    </span>
  );
}
