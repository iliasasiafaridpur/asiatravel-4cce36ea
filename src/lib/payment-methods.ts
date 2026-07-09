// Payment method classification for cash-balance routing.
//
// Rule (per business requirement):
//   - "Cash" (and legacy "Hand Cash") → physically reaches the staff member's
//     drawer, so it IS added to the staff's cash balance / handover total.
//   - Any other method (bKash, Nagad, Rocket, Bank Transfer, Cheque, "Md cash",
//     legacy "Other"/"Bank") → goes DIRECTLY to MD. It stays as a ledger entry
//     everywhere (income list, handover, MD cash request, my-accounts, print)
//     but is NOT added to the staff's balance — it's marked as "MD received".

/** Method options shown in the Due Receive dialog. */
export const DUE_RECEIVE_METHODS = [
  "Cash", "bKash", "Nagad", "Rocket", "Bank Transfer", "Cheque", "Md cash", "Vendor Received",
] as const;

const CASH_METHODS = new Set(["cash", "hand cash"]);
const VENDOR_RECEIVED_METHODS = new Set(["vendor received", "vendor receive"]);

/**
 * True only when the payment is physical cash held by the staff member
 * (counts toward the staff's cash balance & handover).
 * Empty/unknown method is treated as cash for backward-compatibility.
 */
export function isCashMethod(method?: string | null): boolean {
  const m = (method ?? "").trim().toLowerCase();
  if (!m) return true;
  return CASH_METHODS.has(m);
}

/**
 * "Vendor Received" — the passenger paid the vendor directly. The passenger's
 * due is cleared and the vendor's bill is settled, but NO money reaches the
 * staff drawer OR MD, so it is kept out of both cash and MD income buckets.
 */
export function isVendorReceivedMethod(method?: string | null): boolean {
  return VENDOR_RECEIVED_METHODS.has((method ?? "").trim().toLowerCase());
}

/**
 * Non-cash methods go straight to MD — kept as entries everywhere but never
 * added to the staff member's cash balance. "Vendor Received" is excluded:
 * that money goes to the vendor, not MD.
 */
export function isMdReceivedMethod(method?: string | null): boolean {
  return !isCashMethod(method) && !isVendorReceivedMethod(method);
}

/**
 * Vendor-ledger mirrored expenses mean staff-paid/vendor-paid from the user's
 * accountable balance. The visible method can be Cash, Bank Transfer, bKash,
 * etc.; all of them reduce that user's balance unless the row is explicitly an
 * external/non-user route (MD deposit / vendor received / adjustment).
 */
export function vendorExpenseHitsUserBalance(method?: string | null): boolean {
  const m = (method ?? "").trim().toLowerCase();
  return !["md sir deposit", "md deposit", "vendor received", "vendor receive", "adjustment"].includes(m);
}

/** Short Bengali note marking an entry as MD-received via a non-cash method. */
export function mdReceivedNote(method?: string | null): string {
  return `MD রিসিভ · ${(method ?? "—")} — ব্যালেন্সে যোগ হয়নি`;
}

/** Short label marking an entry as paid directly to the vendor. */
export function vendorReceivedNote(): string {
  return `Vendor Rece — ব্যালেন্সে যোগ হয়নি`;
}

/**
 * Compact display label for a payment method. Long method names are shortened
 * everywhere they are shown to the user so slips/ledgers stay compact — most
 * importantly "Bank Transfer" → "Bank".
 */
export function methodLabel(method?: string | null): string {
  const m = (method ?? "").trim();
  if (!m) return "";
  const lower = m.toLowerCase();
  if (lower === "bank transfer" || lower === "bank-transfer" || lower === "bank") return "Bank";
  return m;
}

/** Short display label for a discount tag (kept intentionally tiny). */
export const DISCOUNT_LABEL = "Dis.";


/**
 * A cash handover leaves the staff member's drawer the moment it is SUBMITTED
 * to MD (status "pending") — not only after MD approval. So a pending handover
 * already reduces the staff's cash balance everywhere. Only an explicitly
 * cancelled/rejected handover is excluded (its receipts/expenses get unlinked
 * back to the staff drawer).
 */
export function handoverReducesBalance(status?: string | null): boolean {
  const s = (status ?? "pending").trim().toLowerCase();
  return s !== "cancelled" && s !== "canceled" && s !== "rejected";
}
