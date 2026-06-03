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
  "Cash", "bKash", "Nagad", "Rocket", "Bank Transfer", "Cheque", "Md cash",
] as const;

const CASH_METHODS = new Set(["cash", "hand cash"]);

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
 * Non-cash methods go straight to MD — kept as entries everywhere but never
 * added to the staff member's cash balance.
 */
export function isMdReceivedMethod(method?: string | null): boolean {
  return !isCashMethod(method);
}

/** Short Bengali note marking an entry as MD-received via a non-cash method. */
export function mdReceivedNote(method?: string | null): string {
  return `MD রিসিভ · ${(method ?? "—")} — ব্যালেন্সে যোগ হয়নি`;
}
