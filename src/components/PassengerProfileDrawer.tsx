import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, statusBadgeClass } from "@/lib/modules";
import { CheckCircle2, Clock, Circle } from "lucide-react";

type Row = Record<string, unknown> & { id: string };

type Receipt = {
  id: string;
  entry_date: string | null;
  amount: number | null;
  method: string | null;
  receipt_id: string | null;
  remarks: string | null;
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
  if (s === "file process" || s === "sent to vendor") return (row.vendor_sent_date as string) ?? null;
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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !row?.id) {
      setReceipts([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("payment_receipts")
        .select("id, entry_date, amount, method, receipt_id, remarks")
        .eq("service_table", serviceTable)
        .eq("service_row_id", row.id)
        .order("entry_date", { ascending: false });
      if (!cancelled) {
        setReceipts((data ?? []) as Receipt[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, row?.id, serviceTable]);

  if (!row) return null;

  const sold = Number(row.sold_price ?? 0);
  const cost = Number(row.cost_price ?? 0);
  const receivedField = Number(row.received ?? row.received_amount ?? 0);
  // Money actually received (exclude discount receipts) + discount totals
  const totalDiscount = receipts
    .filter((r) => (r.method ?? "").toLowerCase() === "discount")
    .reduce((acc, r) => acc + Number(r.amount ?? 0), 0);
  const moneyReceipts = receipts.filter((r) => (r.method ?? "").toLowerCase() !== "discount");
  const totalReceived = Math.max(0, receivedField - totalDiscount);
  const due = Math.max(0, sold - receivedField);
  const profit = sold - cost - totalDiscount;
  const country =
    (row.country_name as string) ||
    (row.trip_road as string) ||
    (row.sponsor_name as string) ||
    "";

  const status = String(row.status ?? "");
  const isTicket = moduleKey === "tickets";
  const airline = String(row.airline ?? "");
  const flightDate = row.flight_date ? String(row.flight_date) : "";

  // Full pipeline timeline from module statuses
  const pipeline = (statusOrder && statusOrder.length > 0) ? statusOrder : [];
  const currentIdx = pipeline.findIndex((s) => s.trim().toLowerCase() === status.trim().toLowerCase());

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <SheetTitle className="flex items-center justify-between gap-2">
            <span className="truncate">Passenger Profile</span>
            {status && (
              <Badge variant="outline" className={statusBadgeClass(status)}>{status}</Badge>
            )}
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-5 space-y-5">
            {/* Section A — Personal */}
            <section>
              <div className="text-lg font-semibold leading-tight">{val(row.passenger_name)}</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground text-xs block">Passport</span><span className="font-mono">{val(row.passport)}</span></div>
                <div><span className="text-muted-foreground text-xs block">Mobile</span>{val(row.mobile)}</div>
                <div className="col-span-2"><span className="text-muted-foreground text-xs block">Country / Route</span>{country || DASH}</div>
                {isTicket && (
                  <>
                    <div><span className="text-muted-foreground text-xs block">Airline</span>{val(airline)}</div>
                    <div><span className="text-muted-foreground text-xs block">Flight Date</span>{flightDate ? formatDate(flightDate) : DASH}</div>
                  </>
                )}
              </div>
            </section>

            <Separator />

            {/* Section B — Timeline: full status pipeline */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Tracking Timeline</h4>
              {pipeline.length === 0 ? (
                <div className="text-xs text-muted-foreground italic">No timeline available.</div>
              ) : (
                <ol className="relative border-l-2 border-border ml-2 space-y-3">
                  {pipeline.map((stepStatus, i) => {
                    const dt = dateForStatus(row, stepStatus);
                    const reached = currentIdx >= 0 && i <= currentIdx;
                    const isCurrent = i === currentIdx;
                    return (
                      <li key={stepStatus} className="ml-4">
                        <span className={`absolute -left-[11px] flex h-5 w-5 items-center justify-center rounded-full ${
                          isCurrent
                            ? "bg-primary text-primary-foreground ring-2 ring-primary/30"
                            : reached
                              ? "bg-emerald-500 text-white"
                              : "bg-muted text-muted-foreground"
                        }`}>
                          {reached ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                        </span>
                        <div className={`text-sm font-medium ${isCurrent ? "text-primary" : ""}`}>
                          {stepStatus}
                          {stepStatus.toLowerCase() === "file process" && row.vendor_bought ? (
                            <span className="text-muted-foreground font-normal"> — {String(row.vendor_bought)}</span>
                          ) : null}
                        </div>
                        <div className={`text-xs ${dt ? "text-muted-foreground" : "text-amber-600 inline-flex items-center gap-1"}`}>
                          {dt ? formatDate(dt) : (<><Clock className="h-3 w-3" /> Pending</>)}
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
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Financial Ledger</h4>

              {/* Sales summary */}
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <Line label="Total Sold" value={fmtMoney(sold)} bold />
                <Line label="Total Received" value={fmtMoney(totalReceived)} className="text-emerald-600" />
                <Line label="Discount Given" value={fmtMoney(totalDiscount)} className="text-amber-600" />
                <div className="border-t pt-2 flex items-baseline justify-between">
                  <span className="text-sm font-semibold">Outstanding Due</span>
                  <span className={`text-lg font-bold tabular-nums ${due > 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmtMoney(due)}</span>
                </div>
              </div>

              {/* Cost / Profit — separated */}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg border bg-background p-3">
                  <div className="text-[11px] text-muted-foreground">Cost Price</div>
                  <div className="mt-0.5 text-sm font-semibold tabular-nums">{fmtMoney(cost)}</div>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <div className="text-[11px] text-muted-foreground">Profit</div>
                  <div className={`mt-0.5 text-sm font-semibold tabular-nums ${profit < 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmtMoney(profit)}</div>
                </div>
              </div>

              <div className="mt-4">
                <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Payment History</h5>
                {loading ? (
                  <div className="text-xs text-muted-foreground py-3">Loading…</div>
                ) : receipts.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-3 italic">No payments recorded yet.</div>
                ) : (
                  <div className="rounded-md border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr className="text-left">
                          <th className="px-2 py-1.5 font-medium">Date</th>
                          <th className="px-2 py-1.5 font-medium text-right">Amount</th>
                          <th className="px-2 py-1.5 font-medium">Method</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...moneyReceipts, ...receipts.filter((r) => (r.method ?? "").toLowerCase() === "discount")].map((r) => {
                          const isDisc = (r.method ?? "").toLowerCase() === "discount";
                          return (
                            <tr key={r.id} className="border-t">
                              <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(r.entry_date)}</td>
                              <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${isDisc ? "text-amber-600" : ""}`}>{fmtMoney(Number(r.amount ?? 0))}</td>
                              <td className="px-2 py-1.5">{r.method ?? DASH}</td>
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
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Note</h4>
                  <div className="text-sm font-semibold text-red-500 whitespace-pre-wrap">{String(row.notes)}</div>
                </section>
              </>
            ) : null}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function Line({ label, value, className = "", bold = false }: { label: string; value: string; className?: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${bold ? "font-semibold" : "font-medium"} ${className}`}>{value}</span>
    </div>
  );
}
