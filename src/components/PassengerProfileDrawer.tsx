import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, statusBadgeClass } from "@/lib/modules";
import { CalendarDays, Send, Package, CheckCircle2, Clock } from "lucide-react";

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

export function PassengerProfileDrawer({
  open,
  onOpenChange,
  row,
  serviceTable,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  row: Row | null;
  serviceTable: string;
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
  const received = Number(row.received ?? row.received_amount ?? 0);
  const due = Math.max(0, sold - received);
  const totalDiscount = receipts.reduce((acc, r) => {
    const m = /discount[:\s]*([0-9]+(?:\.[0-9]+)?)/i.exec(r.remarks ?? "");
    return acc + (m ? Number(m[1]) : 0);
  }, 0);
  const country =
    (row.country_name as string) ||
    (row.trip_road as string) ||
    (row.sponsor_name as string) ||
    "";

  const status = String(row.status ?? "");

  const timeline = [
    { label: "Entry Date", date: row.entry_date as string | null, icon: CalendarDays },
    { label: `Sent to Vendor${row.vendor_bought ? ` — ${row.vendor_bought}` : ""}`, date: row.vendor_sent_date as string | null, icon: Send },
    { label: "Received from Vendor", date: row.received_date as string | null, icon: Package },
    { label: "Delivered", date: row.delivery_date as string | null, icon: CheckCircle2 },
  ].filter((t) => t.label !== "Received from Vendor" || "received_date" in row);

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
              </div>
            </section>

            <Separator />

            {/* Section B — Timeline */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Tracking Timeline</h4>
              <ol className="relative border-l-2 border-border ml-2 space-y-4">
                {timeline.map((t, i) => {
                  const Icon = t.icon;
                  const done = !!t.date;
                  return (
                    <li key={i} className="ml-4">
                      <span className={`absolute -left-[11px] flex h-5 w-5 items-center justify-center rounded-full ${done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>
                        <Icon className="h-3 w-3" />
                      </span>
                      <div className="text-sm font-medium">{t.label}</div>
                      <div className={`text-xs ${done ? "text-muted-foreground" : "text-amber-600 inline-flex items-center gap-1"}`}>
                        {done ? formatDate(t.date as string) : (<><Clock className="h-3 w-3" /> Pending</>)}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>

            <Separator />

            {/* Section C — Financials */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Financial Ledger</h4>
              <div className="grid grid-cols-2 gap-2 text-sm rounded-lg border bg-muted/30 p-3">
                <Money label="Total Sold" value={sold} />
                <Money label="Cost Price" value={cost} />
                <Money label="Total Received" value={received} className="text-emerald-600" />
                <Money label="Total Discount" value={totalDiscount} />
                <div className="col-span-2 pt-2 border-t flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">Outstanding Due</span>
                  <span className={`text-base font-bold ${due > 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmtMoney(due)}</span>
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
                        {receipts.map((r) => (
                          <tr key={r.id} className="border-t">
                            <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(r.entry_date)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmtMoney(Number(r.amount ?? 0))}</td>
                            <td className="px-2 py-1.5">{r.method ?? DASH}</td>
                          </tr>
                        ))}
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

function Money({ label, value, className = "" }: { label: string; value: number; className?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`tabular-nums font-medium ${className}`}>{fmtMoney(value)}</span>
    </div>
  );
}
