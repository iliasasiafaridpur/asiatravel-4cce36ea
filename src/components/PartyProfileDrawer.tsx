import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/lib/modules";
import { Phone, MapPin, FileText, TrendingUp, TrendingDown } from "lucide-react";

type LedgerRow = Record<string, unknown> & { id: string };
type Contact = { phone?: string | null; address?: string | null; created_at?: string | null };

const fmtMoney = (n: number) => `৳${Number(n || 0).toLocaleString()}`;
const isAdvance = (r: LedgerRow) => String(r.service_type ?? "").toUpperCase() === "ADVANCE";
const isPayment = (r: LedgerRow) => String(r.service_type ?? "").toUpperCase() === "PAYMENT";

export function PartyProfileDrawer({
  open,
  onOpenChange,
  kind,
  partyName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: "customer" | "vendor";
  partyName: string | null;
}) {
  const isCustomer = kind === "customer";
  const table = isCustomer ? "agency_ledger" : "vendor_ledger";
  const groupField = isCustomer ? "agent_name" : "vendor_name";
  const billCol = isCustomer ? "total_bill" : "total_payable";
  const paidCol = isCustomer ? "received_amount" : "paid_amount";
  const contactsTable = isCustomer ? "agents" : "vendors";

  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !partyName) {
      setRows([]);
      setContact(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [ledgerRes, contactRes] = await Promise.all([
        supabase
          .from(table as never)
          .select("*")
          .eq(groupField, partyName)
          .order("entry_date", { ascending: false })
          .limit(500),
        supabase
          .from(contactsTable as never)
          .select("phone,address,created_at")
          .eq("name", partyName)
          .maybeSingle(),
      ]);
      if (!cancelled) {
        setRows(((ledgerRes.data as unknown as LedgerRow[]) ?? []));
        setContact((contactRes.data as Contact | null) ?? null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, partyName, table, groupField, contactsTable]);

  const stats = useMemo(() => {
    let bill = 0, cashPaid = 0, applied = 0, advance = 0, profit = 0;
    const byService = new Map<string, { count: number; bill: number; paid: number; due: number }>();
    for (const r of rows) {
      const applyAmt = Number(r.advance_applied ?? 0);
      if (isAdvance(r)) {
        advance += Number(r[paidCol] ?? 0);
        applied += applyAmt;
        continue;
      }
      const b = Number(r[billCol] ?? 0);
      const p = Number(r[paidCol] ?? 0);
      bill += b;
      cashPaid += p;
      applied += applyAmt;
      profit += Number(r.profit ?? 0);
      const svc = String(r.service_type ?? "Other");
      const cur = byService.get(svc) ?? { count: 0, bill: 0, paid: 0, due: 0 };
      cur.count += 1;
      cur.bill += b;
      cur.paid += p + applyAmt;
      cur.due += Math.max(b - p - applyAmt, 0);
      byService.set(svc, cur);
    }
    const totalPaid = cashPaid + applied;
    const due = Math.max(bill - totalPaid, 0);
    const advBal = Math.max(advance - applied, 0);
    return { bill, totalPaid, due, advance: advBal, profit, byService };
  }, [rows, billCol, paidCol]);

  const serviceRows = useMemo(
    () => rows.filter((r) => !isAdvance(r) && !isPayment(r)).slice(0, 20),
    [rows],
  );
  const paymentRows = useMemo(
    () => rows.filter((r) => isPayment(r) || isAdvance(r)).slice(0, 20),
    [rows],
  );

  if (!partyName) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <SheetTitle className="flex items-center justify-between gap-2">
            <span className="truncate">{isCustomer ? "Customer Profile" : "Vendor Profile"}</span>
            <Badge variant="outline" className={isCustomer ? "border-sky-500/50 text-sky-600" : "border-violet-500/50 text-violet-600"}>
              {isCustomer ? "Customer" : "Vendor"}
            </Badge>
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-5 space-y-5">
            {/* Header */}
            <section>
              <div className="text-lg font-semibold leading-tight">{partyName}</div>
              <div className="mt-2 grid grid-cols-1 gap-1.5 text-sm">
                {contact?.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{contact.phone}</span>
                  </div>
                )}
                {contact?.address && (
                  <div className="flex items-start gap-2">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                    <span className="text-muted-foreground">{contact.address}</span>
                  </div>
                )}
                {contact?.created_at && (
                  <div className="text-xs text-muted-foreground">
                    যোগ হয়েছে: {formatDate(contact.created_at)}
                  </div>
                )}
              </div>
            </section>

            <Separator />

            {/* Lifetime Summary */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Lifetime Summary
              </h4>
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <Line label={isCustomer ? "Total Bill" : "Total Payable"} value={fmtMoney(stats.bill)} bold />
                <Line
                  label={isCustomer ? "Total Received" : "Total Paid"}
                  value={fmtMoney(stats.totalPaid)}
                  className="text-emerald-600"
                />
                <div className="border-t pt-2 flex items-baseline justify-between">
                  <span className="text-sm font-semibold">Outstanding {isCustomer ? "Due" : "Payable"}</span>
                  <span
                    className={`text-lg font-bold tabular-nums ${stats.due > 0 ? "text-rose-600" : "text-emerald-600"}`}
                  >
                    {fmtMoney(stats.due)}
                  </span>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg border bg-background p-3">
                  <div className="text-[11px] text-muted-foreground">Advance Balance</div>
                  <div className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-600">
                    {fmtMoney(stats.advance)}
                  </div>
                </div>
                <div className="rounded-lg border bg-background p-3">
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                    {isCustomer ? <TrendingUp className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                    {isCustomer ? "Lifetime Profit" : "Total Files"}
                  </div>
                  <div
                    className={`mt-0.5 text-sm font-semibold tabular-nums ${
                      isCustomer
                        ? stats.profit < 0
                          ? "text-rose-600"
                          : "text-emerald-600"
                        : ""
                    }`}
                  >
                    {isCustomer ? fmtMoney(stats.profit) : serviceRows.length + (rows.filter(r => !isAdvance(r) && !isPayment(r)).length - serviceRows.length)}
                  </div>
                </div>
              </div>
            </section>

            <Separator />

            {/* Service breakdown */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Service Breakdown
              </h4>
              {stats.byService.size === 0 ? (
                <div className="text-xs text-muted-foreground italic py-2">কোনো সার্ভিস নেই।</div>
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr className="text-left">
                        <th className="px-2 py-1.5 font-medium">Service</th>
                        <th className="px-2 py-1.5 font-medium text-right">Files</th>
                        <th className="px-2 py-1.5 font-medium text-right">{isCustomer ? "Bill" : "Payable"}</th>
                        <th className="px-2 py-1.5 font-medium text-right">Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(stats.byService.entries()).map(([svc, v]) => (
                        <tr key={svc} className="border-t">
                          <td className="px-2 py-1.5">{svc}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{v.count}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(v.bill)}</td>
                          <td className={`px-2 py-1.5 text-right tabular-nums ${v.due > 0 ? "text-rose-600 font-medium" : "text-muted-foreground"}`}>
                            {fmtMoney(v.due)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <Separator />

            {/* Service History (recent) */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Recent Service Files
              </h4>
              {loading ? (
                <div className="text-xs text-muted-foreground py-3">Loading…</div>
              ) : serviceRows.length === 0 ? (
                <div className="text-xs text-muted-foreground italic py-2">কোনো এন্ট্রি নেই।</div>
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr className="text-left">
                        <th className="px-2 py-1.5 font-medium">Date</th>
                        <th className="px-2 py-1.5 font-medium">Passenger</th>
                        <th className="px-2 py-1.5 font-medium">Service</th>
                        <th className="px-2 py-1.5 font-medium text-right">Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {serviceRows.map((r) => {
                        const b = Number(r[billCol] ?? 0);
                        const p = Number(r[paidCol] ?? 0);
                        const a = Number(r.advance_applied ?? 0);
                        const due = Math.max(b - p - a, 0);
                        return (
                          <tr key={r.id} className="border-t">
                            <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(r.entry_date as string)}</td>
                            <td className="px-2 py-1.5 truncate max-w-[110px]">{String(r.passenger_name ?? "—")}</td>
                            <td className="px-2 py-1.5">{String(r.service_type ?? "—")}</td>
                            <td className={`px-2 py-1.5 text-right tabular-nums ${due > 0 ? "text-rose-600 font-medium" : "text-emerald-600"}`}>
                              {due > 0 ? fmtMoney(due) : "Paid"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <Separator />

            {/* Payment history */}
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Payment History
              </h4>
              {paymentRows.length === 0 ? (
                <div className="text-xs text-muted-foreground italic py-2">কোনো পেমেন্ট নেই।</div>
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr className="text-left">
                        <th className="px-2 py-1.5 font-medium">Date</th>
                        <th className="px-2 py-1.5 font-medium text-right">Amount</th>
                        <th className="px-2 py-1.5 font-medium">Method</th>
                        <th className="px-2 py-1.5 font-medium">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentRows.map((r) => {
                        const adv = isAdvance(r);
                        return (
                          <tr key={r.id} className="border-t">
                            <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(r.entry_date as string)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                              {fmtMoney(Number(r[paidCol] ?? 0))}
                            </td>
                            <td className="px-2 py-1.5">{String(r.payment_method ?? "—")}</td>
                            <td className="px-2 py-1.5">
                              {adv ? (
                                <Badge variant="outline" className="border-amber-500/50 text-amber-600 text-[10px]">
                                  Advance
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="border-emerald-500/50 text-emerald-600 text-[10px]">
                                  Payment
                                </Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {!isCustomer && (
              <>
                <Separator />
                <section>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Performance
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border bg-background p-3">
                      <div className="text-[11px] text-muted-foreground">Total Files</div>
                      <div className="mt-0.5 text-base font-semibold">
                        {rows.filter((r) => !isAdvance(r) && !isPayment(r)).length}
                      </div>
                    </div>
                    <div className="rounded-lg border bg-background p-3">
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <TrendingDown className="h-3 w-3" /> Pending Files
                      </div>
                      <div className="mt-0.5 text-base font-semibold text-amber-600">
                        {rows.filter((r) => {
                          if (isAdvance(r) || isPayment(r)) return false;
                          const b = Number(r[billCol] ?? 0);
                          const p = Number(r[paidCol] ?? 0);
                          const a = Number(r.advance_applied ?? 0);
                          return b - p - a > 0;
                        }).length}
                      </div>
                    </div>
                  </div>
                </section>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
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
