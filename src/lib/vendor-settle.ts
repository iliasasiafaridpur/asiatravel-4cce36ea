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
 * Overpayment handling: if the passenger pays MORE than this booking's vendor
 * cost, the surplus is adjusted against the SAME vendor's other outstanding
 * bills (oldest first / FIFO — i.e. the vendor's previous due). Anything still
 * left after every due is cleared is parked as a vendor ADVANCE wallet row.
 * Both the FIFO bill bumps and the advance row carry a non-empty `source_table`
 * so the cash-sync trigger never mirrors them into the staff cash drawer.
 *
 * Errors are swallowed (best-effort) so an offline/edge failure never blocks
 * the passenger receipt that already succeeded.
 */
const LOG_TYPES = new Set(["ADVANCE", "OPENING", "PAYMENT"]);

const isBillRow = (r: Record<string, unknown>) =>
  !LOG_TYPES.has(String(r.service_type ?? "").toUpperCase());

const rowRemaining = (r: Record<string, unknown>) =>
  Math.max(
    0,
    Number(r.total_payable ?? 0) - Number(r.paid_amount ?? 0) - Number(r.advance_applied ?? 0),
  );

export async function settleVendorBillByBooking(
  sourceTable: string,
  sourceId: string,
  amount: number,
  userId: string,
): Promise<{ applied: number; advance: number; vendor: string | null }> {
  if (!sourceTable || !sourceId || amount <= 0) return { applied: 0, advance: 0, vendor: null };
  try {
    const { data } = await supabase
      .from("vendor_ledger" as never)
      .select("id, vendor_name, total_payable, paid_amount, advance_applied, service_type")
      .eq("source_table", sourceTable)
      .eq("source_id", sourceId)
      .limit(10);
    const rows = ((data as unknown) as Record<string, unknown>[] | null) ?? [];
    const bill = rows.find(isBillRow);
    if (!bill) return { applied: 0, advance: 0, vendor: null };

    const vendor = bill.vendor_name ? String(bill.vendor_name) : null;
    let remaining = amount;
    let appliedTotal = 0;

    // 1) Settle this booking's own bill first.
    const ownDue = rowRemaining(bill);
    const ownApply = Math.min(ownDue, remaining);
    if (ownApply > 0) {
      const { error } = await supabase
        .from("vendor_ledger" as never)
        .update({ paid_amount: Number(bill.paid_amount ?? 0) + ownApply, received_by: userId } as never)
        .eq("id", bill.id as never);
      if (!error) {
        appliedTotal += ownApply;
        remaining -= ownApply;
      }
    }

    // 2) Park any surplus (paid more than this booking's vendor cost) as a
    //    vendor ADVANCE wallet row. We do NOT force-match it against the
    //    vendor's other bills here — the recalculate_vendor_advance trigger
    //    decides how the advance offsets genuine (received) dues, so the
    //    surplus reliably shows up as advance / reduces real due.
    let advance = 0;
    if (remaining > 0.009 && vendor) {
      let advId = "";
      try {
        const { data: idData } = await supabase.rpc("next_module_id" as never, {
          _prefix: "VDL",
          _table: "vendor_ledger",
          _column: "ledger_id",
        } as never);
        advId = (idData as unknown as string) ?? "";
      } catch {
        advId = "";
      }
      const today = new Date().toISOString().slice(0, 10);
      const payload: Record<string, unknown> = {
        ledger_id: advId || `VDL-${Date.now()}`,
        entry_date: today,
        payment_date: today,
        vendor_name: vendor,
        service_type: "ADVANCE",
        total_payable: 0,
        paid_amount: remaining,
        payment_method: "Vendor Received",
        source_table: "vendor_received",
        remarks: "Advance (Vendor Received surplus)",
        created_by: userId,
        received_by: userId,
      };
      const { error } = await supabase.from("vendor_ledger" as never).insert(payload as never);
      if (!error) {
        advance = remaining;
        remaining = 0;
      }
    }

    return { applied: appliedTotal, advance, vendor };
  } catch {
    return { applied: 0, advance: 0, vendor: null };
  }
}
