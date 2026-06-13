import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ReceiptDialog, type ReceiptInfo } from "@/components/ReceiptDialog";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, statusBadgeClass, MODULES } from "@/lib/modules";
import { CheckCircle2, Clock, Circle, ReceiptText, Layers } from "lucide-react";
import { MobileColorPicker } from "@/components/MobileColorPicker";
import { useMobileColors, mobileColorTextClass } from "@/hooks/useMobileColors";

type Row = Record<string, unknown> & { id: string };

type Receipt = {
  id: string;
  entry_date: string | null;
  amount: number | null;
  method: string | null;
  receipt_id: string | null;
  remarks: string | null;
  received_by_name: string | null;
  approval_status: string | null;
};

const DASH = "—";
const val = (v: unknown) => {
  if (v === null || v === undefined || v === "") return DASH;
  return String(v);
};
const fmtMoney = (n: number) => `৳${Number(n || 0).toLocaleString()}`;

// Map a status name to the row field that records when it was reached.
// Used to render the full status pipeline in the timeline section.
function dateForStatus(row: Row, status: string): string | null {
  const s = status.trim().toLowerCase();
  if (s === "entry" || s === "new" || s === "issue") return (row.entry_date as string) ?? null;
  if (s === "file process" || s === "sent to vendor")
    return (row.vendor_sent_date as string) ?? null;
  if (s === "card ready" || s === "received from vendor" || s === "pending delivery")
    return (row.received_date as string) ?? null;
  if (s === "delivered") return (row.delivery_date as string) ?? null;
  return null;
}

export function PassengerProfileDrawer({
  open,
  onOpenChange,
  row,
  serviceTable,
  moduleKey,
  statusOrder,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  row: Row | null;
  serviceTable: string;
  moduleKey?: string;
  statusOrder?: string[];
}) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [extras, setExtras] = useState<{ id: string; service_name: string; service_price: number; vendor_cost: number; vendor_name: string | null; notes: string | null; received: number }[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const { colorFor } = useMobileColors();

  useEffect(() => {
    if (!open || !row?.id) {
      setReceipts([]);
      setExtras([]);
      return;
    }
    let cancelled = false;
    // Load extra services attached to this service row (passenger bill + vendor cost),
    // and how much of each the customer has already paid (tracked on the extra_services row).
    (async () => {
      const { data } = await supabase
        .from("extra_services" as never)
        .select("id,service_name,service_price,vendor_cost,vendor_name,notes,received_amount,discount_amount")
        .eq("source_table", serviceTable)
        .eq("source_id", row.id);
      const list =
        ((data as { id: string; service_name: string; service_price: number; vendor_cost: number; vendor_name: string | null; notes: string | null; received_amount: number | null; discount_amount: number | null }[] | null) ?? []);
      if (!cancelled) {
        setExtras(list.map((e) => ({
          id: e.id,
          service_name: e.service_name,
          service_price: e.service_price,
          vendor_cost: e.vendor_cost,
          vendor_name: e.vendor_name,
          notes: e.notes,
          received: Number(e.received_amount ?? 0) + Number(e.discount_amount ?? 0),
        })));
      }
    })();
    (async () => {
      setLoading(true);
      const cols =
        "id, entry_date, amount, method, receipt_id, remarks, received_by_name, approval_status";
      // Some service payments are recorded only on the agency_ledger mirror of
      // this service row (e.g. when received directly, not via Due Receive).
      // Find those mirror rows so their receipts also show in the history.
      const { data: mirrors } = await supabase
        .from("agency_ledger")
        .select("id")
        .eq("source_table", serviceTable)
        .eq("source_id", row.id);
      const ledgerIds = ((mirrors ?? []) as { id: string }[]).map((m) => m.id);

      const [directRes, ledgerRes] = await Promise.all([
        supabase
          .from("payment_receipts")
          .select(cols)
          .eq("service_table", serviceTable)
          .eq("service_row_id", row.id)
          .not("source", "eq", "discount")
          .not("method", "ilike", "discount"),
        ledgerIds.length
          ? supabase
              .from("payment_receipts")
              .select(cols)
              .eq("service_table", "agency_ledger")
              .in("service_row_id", ledgerIds)
              .not("source", "eq", "discount")
              .not("method", "ilike", "discount")
          : Promise.resolve({ data: [] as Receipt[] }),
      ]);

      const merged = new Map<string, Receipt>();
      for (const r of [
        ...((directRes.data ?? []) as Receipt[]),
        ...((ledgerRes.data ?? []) as Receipt[]),
      ]) {
        merged.set(r.id, r);
      }
      const list = Array.from(merged.values()).sort((a, b) =>
        String(b.entry_date ?? "").localeCompare(String(a.entry_date ?? "")),
      );
      if (!cancelled) {
        setReceipts(list);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, row?.id, serviceTable]);

  if (!row) return null;

  const mobileColor = colorFor(row.mobile ? String(row.mobile) : null);

  const sold = Number(row.sold_price ?? 0);
  const status = String(row.status ?? "");
  const isTicket = moduleKey === "tickets";
  // Tickets in BOOK status: vendor + cost are pre-filled but not yet "live" —
  // hide cost, vendor, and profit until status moves to ISSUE.
  const isTicketBook = isTicket && status.toUpperCase() === "BOOK";
  const cost = isTicketBook ? 0 : Number(row.cost_price ?? 0);
  const receivedField = Number(row.received ?? row.received_amount ?? 0);
  const totalDiscount = Number(row.discount_amount ?? 0);
  const moneyReceipts = receipts;
  const serviceReceived = Math.max(0, receivedField);
  // Extra services: service_price = extra passenger bill, vendor_cost = extra vendor cost,
  // received = how much of that extra bill the customer has already paid.
  const extraSold = extras.reduce((s, e) => s + (Number(e.service_price) || 0), 0);
  const extraCost = extras.reduce((s, e) => s + (Number(e.vendor_cost) || 0), 0);
  const extraReceived = extras.reduce((s, e) => s + (Number(e.received) || 0), 0);
  const extraDue = Math.max(0, extraSold - extraReceived);
  // Combined customer-side totals so the FULL passenger account is clear at a glance.
  const totalBill = sold + extraSold;
  const totalReceived = serviceReceived + extraReceived;
  const due = Math.max(0, totalBill - totalReceived - totalDiscount);
  const profit = totalBill - totalDiscount - cost - extraCost;
  const showProfit = (serviceReceived > 0 && cost > 0) || extraSold > 0 || extraCost > 0;
  const profitClass = profit < 0 ? "text-rose-600" : due <= 0 ? "text-emerald-600" : "text-amber-500";
  const country =
    (row.country_name as string) || (row.trip_road as string) || (row.sponsor_name as string) || "";

  const airline = String(row.airline ?? "");
  const flightDate = row.flight_date ? String(row.flight_date) : "";
  const openReceipt = (r: Receipt) => {
    const paid = Number(r.amount ?? 0);
    setSelectedReceipt({
      receiptId: r.receipt_id || "Receipt",
      date: r.entry_date || "",
      passengerName: String(row.passenger_name ?? ""),
      mobile: String(row.mobile ?? ""),
      refId: String(
        row.ticket_id ?? row.bmet_id ?? row.kuwait_id ?? row.saudi_id ?? row.passenger_id ?? row.id,
      ),
      serviceType: serviceTable,
      sold,
      previouslyReceived: Math.max(0, totalReceived - paid),
      paid,
      discount: totalDiscount,
      method: r.method || "Cash",
      remarks: r.remarks || undefined,
      receivedByName: r.received_by_name || "—",
      airline: airline || undefined,
      route: country || undefined,
      flightDate: flightDate || undefined,
    });
  };

  // Full pipeline timeline from module statuses
  const pipeline = statusOrder && statusOrder.length > 0 ? statusOrder : [];
  const currentIdx = pipeline.findIndex(
    (s) => s.trim().toLowerCase() === status.trim().toLowerCase(),
  );

  return (
    <>
      <ReceiptDialog
        receipt={selectedReceipt}
        open={!!selectedReceipt}
        onClose={() => setSelectedReceipt(null)}
      />
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
          <SheetHeader className="px-5 pt-5 pb-3 pr-14 border-b">
            <SheetTitle className="flex items-center justify-between gap-2">
              <span className="truncate">Passenger Profile</span>
              {status && (
                <Badge variant="outline" className={statusBadgeClass(status)}>
                  {status}
                </Badge>
              )}
            </SheetTitle>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="p-5 space-y-5">
              {/* Section A — Personal */}
              <section>
                <div className="text-lg font-semibold leading-tight">{val(row.passenger_name)}</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground text-xs block">Passport</span>
                    <span className="font-mono">{val(row.passport)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs block">Mobile</span>
                    <span className="inline-flex items-center gap-2 flex-wrap">
                      <span className={mobileColorTextClass(mobileColor)}>{val(row.mobile)}</span>
                      {row.mobile ? <MobileColorPicker mobile={String(row.mobile)} /> : null}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground text-xs block">Country / Route</span>
                    {country || DASH}
                  </div>
                  {(isTicket || moduleKey === "other") && (airline || flightDate) && (
                    <>
                      <div>
                        <span className="text-muted-foreground text-xs block">Airline</span>
                        {val(airline)}
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs block">Flight Date</span>
                        {flightDate ? formatDate(flightDate) : DASH}
                      </div>
                    </>
                  )}
                </div>
              </section>

              <Separator />

              {/* Section B — Timeline: full status pipeline */}
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  Tracking Timeline
                </h4>
                {pipeline.length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">No timeline available.</div>
                ) : (
                  <ol className="relative border-l-2 border-border ml-2 space-y-3">
                    {pipeline.map((stepStatus, i) => {
                      let dt = dateForStatus(row, stepStatus);
                      const reached = currentIdx >= 0 && i <= currentIdx;
                      const isCurrent = i === currentIdx;
                      // If this step is reached but has no dedicated date,
                      // fall back to the nearest known date from a later
                      // reached step, then earlier — so completed steps
                      // always show a date instead of just "Completed".
                      if (!dt && reached) {
                        for (let j = i + 1; j <= currentIdx; j++) {
                          const d = dateForStatus(row, pipeline[j]);
                          if (d) { dt = d; break; }
                        }
                        if (!dt) {
                          for (let j = i - 1; j >= 0; j--) {
                            const d = dateForStatus(row, pipeline[j]);
                            if (d) { dt = d; break; }
                          }
                        }
                      }
                      return (
                        <li key={stepStatus} className="ml-4">
                          <span
                            className={`absolute -left-[11px] flex h-5 w-5 items-center justify-center rounded-full ${
                              isCurrent
                                ? "bg-primary text-primary-foreground ring-2 ring-primary/30"
                                : reached
                                  ? "bg-emerald-500 text-white"
                                  : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {reached ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : (
                              <Circle className="h-3 w-3" />
                            )}
                          </span>
                          <div className={`text-sm font-medium ${isCurrent ? "text-primary" : ""}`}>
                            {stepStatus}
                            {stepStatus.toLowerCase() === "file process" && row.vendor_bought ? (
                              <span className="text-muted-foreground font-normal">
                                {" "}
                                — {String(row.vendor_bought)}
                              </span>
                            ) : null}
                          </div>
                          <div
                            className={`text-xs ${dt ? "text-muted-foreground" : reached ? "text-emerald-600 inline-flex items-center gap-1" : "text-amber-600 inline-flex items-center gap-1"}`}
                          >
                            {dt ? (
                              formatDate(dt)
                            ) : reached ? (
                              <>
                                <CheckCircle2 className="h-3 w-3" /> Completed
                              </>
                            ) : (
                              <>
                                <Clock className="h-3 w-3" /> Pending
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>

              <Separator />

              {/* Section C — Financials, redesigned */}
              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  Financial Ledger
                </h4>

                {/* Sales summary — combined customer account (service + extra services) */}
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                  {extraSold > 0 ? (
                    <>
                      <Line label="Main Service Bill" value={fmtMoney(sold)} className="text-muted-foreground" />
                      <Line label="✨ Extra Service Bill" value={fmtMoney(extraSold)} className="text-fuchsia-600 dark:text-fuchsia-400" />
                      <div className="border-t pt-2">
                        <Line label="Total Bill" value={fmtMoney(totalBill)} bold />
                      </div>
                    </>
                  ) : (
                    <Line label="Total Bill" value={fmtMoney(totalBill)} bold />
                  )}
                  <Line
                    label="Total Received"
                    value={fmtMoney(totalReceived)}
                    className="text-emerald-600"
                  />
                  {totalDiscount > 0 ? (
                    <Line
                      label="Discount Given"
                      value={fmtMoney(totalDiscount)}
                      className="text-amber-600"
                    />
                  ) : null}
                  <div className="border-t pt-2 flex items-baseline justify-between">
                    <span className="text-sm font-semibold">Outstanding Due</span>
                    <span
                      className={`text-lg font-bold tabular-nums ${due > 0 ? "text-rose-600" : "text-emerald-600"}`}
                    >
                      {fmtMoney(due)}
                    </span>
                  </div>
                  {extraDue > 0 ? (
                    <div className="text-[11px] text-fuchsia-600 dark:text-fuchsia-400 text-right">
                      এর মধ্যে ✨ Extra service বকেয়া: {fmtMoney(extraDue)}
                    </div>
                  ) : null}
                </div>

                {/* Cost / Profit — separated */}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {!isTicketBook ? (
                    <div className="rounded-lg border bg-background p-3">
                      <div className="text-[11px] text-muted-foreground">Cost Price</div>
                      <div className="mt-0.5 text-sm font-semibold tabular-nums">
                        {fmtMoney(cost)}
                      </div>
                    </div>
                  ) : null}
                  {showProfit ? (
                    <div className="rounded-lg border bg-background p-3">
                      <div className="text-[11px] text-muted-foreground">Profit</div>
                      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${profitClass}`}>
                        {fmtMoney(profit)}
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Extra services — billed to passenger (service price) + payable to vendor (cost) */}
                {extras.length > 0 ? (
                  <div className="mt-3 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/5 p-3 space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-fuchsia-600 dark:text-fuchsia-400">
                      ✨ Extra Services
                    </div>
                    {extras.map((e) => {
                      const bill = Number(e.service_price) || 0;
                      const paid = Number(e.received) || 0;
                      const exDue = Math.max(0, bill - paid);
                      return (
                        <div key={e.id} className="text-xs border-t border-fuchsia-500/20 pt-2 first:border-t-0 first:pt-0">
                          <div className="font-medium">{e.service_name || "Extra Service"}</div>
                          <div className="mt-0.5 flex items-center justify-between gap-2 tabular-nums">
                            <span className="text-emerald-600">Bill: {fmtMoney(bill)}</span>
                            <span className="text-rose-500">
                              Vendor{e.vendor_name ? ` (${e.vendor_name})` : ""}: {fmtMoney(Number(e.vendor_cost) || 0)}
                            </span>
                          </div>
                          {bill > 0 ? (
                            <div className="mt-0.5 flex items-center justify-between gap-2 tabular-nums text-[11px]">
                              <span className="text-emerald-600">Received: {fmtMoney(paid)}</span>
                              <span className={exDue > 0 ? "text-rose-500 font-semibold" : "text-emerald-600"}>Due: {fmtMoney(exDue)}</span>
                            </div>
                          ) : null}
                          {e.notes ? <div className="mt-0.5 text-muted-foreground">📝 {e.notes}</div> : null}
                        </div>
                      );
                    })}
                    <div className="border-t border-fuchsia-500/30 pt-2 flex items-center justify-between text-xs font-semibold tabular-nums">
                      <span className="text-emerald-600">Total Bill: {fmtMoney(extraSold)}</span>
                      <span className="text-rose-500">Vendor Total: {fmtMoney(extraCost)}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Customer ও Vendor ledger-এ আলাদা এন্ট্রি হিসেবে যুক্ত হয়েছে।
                    </div>
                  </div>
                ) : null}

                <div className="mt-4">
                  <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Payment History
                  </h5>
                  {loading ? (
                    <div className="text-xs text-muted-foreground py-3">Loading…</div>
                  ) : receipts.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-3 italic">
                      No payments recorded yet.
                    </div>
                  ) : (
                    <div className="rounded-md border overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr className="text-left">
                            <th className="px-2 py-1.5 font-medium">Date</th>
                            <th className="px-2 py-1.5 font-medium text-right">Amount</th>
                            <th className="px-2 py-1.5 font-medium">Method</th>
                            <th className="px-2 py-1.5 font-medium">Received By / Status</th>
                            <th className="px-2 py-1.5 font-medium text-right">Receipt</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            ...moneyReceipts,
                            ...receipts.filter(
                              (r) => (r.method ?? "").toLowerCase() === "discount",
                            ),
                          ].map((r) => {
                            const isDisc = (r.method ?? "").toLowerCase() === "discount";
                            const status = (r.approval_status ?? "").toLowerCase();
                            const badge =
                              status === "auto_approved"
                                ? { label: "Self-Approved", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" }
                                : status === "approved"
                                  ? { label: "Approved by MD", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" }
                                  : status === "rejected"
                                    ? { label: "Rejected", cls: "bg-rose-500/15 text-rose-700 border-rose-500/30" }
                                    : status === "pending_md"
                                      ? { label: "Pending MD Approval", cls: "bg-amber-500/15 text-amber-700 border-amber-500/30" }
                                      : null;
                            return (
                              <tr key={r.id} className="border-t">
                                <td className="px-2 py-1.5 whitespace-nowrap">
                                  {formatDate(r.entry_date)}
                                </td>
                                <td
                                  className={`px-2 py-1.5 text-right tabular-nums font-medium ${isDisc ? "text-amber-600" : ""}`}
                                >
                                  {fmtMoney(Number(r.amount ?? 0))}
                                </td>
                                <td className="px-2 py-1.5">{r.method ?? DASH}</td>
                                <td className="px-2 py-1.5">
                                  {isDisc ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : (
                                    <div className="flex flex-col gap-0.5">
                                      <span className="font-medium">{r.received_by_name ?? DASH}</span>
                                      {badge ? (
                                        <Badge variant="outline" className={`w-fit text-[10px] py-0 px-1.5 ${badge.cls}`}>
                                          {badge.label}
                                        </Badge>
                                      ) : null}
                                    </div>
                                  )}
                                </td>
                                <td className="px-2 py-1.5 text-right">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-[11px]"
                                    onClick={() => openReceipt(r)}
                                  >
                                    <ReceiptText className="h-3.5 w-3.5" /> Receipt
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>

              {row.notes ? (
                <>
                  <Separator />
                  <section>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                      Note
                    </h4>
                    <div className="text-sm font-semibold text-red-500 whitespace-pre-wrap">
                      {String(row.notes)}
                    </div>
                  </section>
                </>
              ) : null}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}

function Line({
  label,
  value,
  className = "",
  bold = false,
}: {
  label: string;
  value: string;
  className?: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${bold ? "font-semibold" : "font-medium"} ${className}`}>
        {value}
      </span>
    </div>
  );
}
