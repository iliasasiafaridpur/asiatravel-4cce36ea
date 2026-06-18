import { supabase } from "@/integrations/supabase/client";

/**
 * "Vendor Received" payment settlement.
 *
 * When a passenger pays the vendor directly, the vendor's bill for that exact
 * booking must be marked paid. Each booking has one vendor_ledger BILL row
 * (matched by source_table + source_id; service_type is the real service, not
 * a PAYMENT/ADVANCE/OPENING log). We bump that row's `paid_amount`.
 *
 * Because the bill row keeps a non-empty `source_table`, the
 * `sync_vendor_payment_to_cash` trigger skips the cash-drawer mirror — so this
 * settles the vendor without ever touching the staff member's cash balance.
 *
 * The applied amount is capped at the vendor's remaining payable; any passenger
 * payment beyond the vendor cost is simply not pushed onto the vendor.
 *
 * Errors are swallowed (best-effort) so an offline/edge failure never blocks
 * the passenger receipt that already succeeded.
 */
export async function settleVendorBillByBooking(
  sourceTable: string,
  sourceId: string,
  amount: number,
  userId: string,
): Promise<{ applied: number; vendor: string | null }> {
  if (!sourceTable || !sourceId || amount <= 0) return { applied: 0, vendor: null };
  try {
    const { data } = await supabase
      .from("vendor_ledger" as never)
      .select("id, vendor_name, total_payable, paid_amount, advance_applied, service_type")
      .eq("source_table", sourceTable)
      .eq("source_id", sourceId)
      .limit(10);
    const rows = ((data as unknown) as Record<string, unknown>[] | null) ?? [];
    const bill = rows.find((r) => {
      const st = String(r.service_type ?? "").toUpperCase();
      return st !== "ADVANCE" && st !== "OPENING" && st !== "PAYMENT";
    });
    if (!bill) return { applied: 0, vendor: null };
    const payable = Number(bill.total_payable ?? 0);
    const paid = Number(bill.paid_amount ?? 0);
    const remaining = Math.max(0, payable - paid - Number(bill.advance_applied ?? 0));
    const apply = Math.min(remaining, amount);
    if (apply <= 0) return { applied: 0, vendor: bill.vendor_name ? String(bill.vendor_name) : null };
    const { error } = await supabase
      .from("vendor_ledger" as never)
      .update({ paid_amount: paid + apply, received_by: userId } as never)
      .eq("id", bill.id as never);
    if (error) return { applied: 0, vendor: bill.vendor_name ? String(bill.vendor_name) : null };
    return { applied: apply, vendor: bill.vendor_name ? String(bill.vendor_name) : null };
  } catch {
    return { applied: 0, vendor: null };
  }
}
