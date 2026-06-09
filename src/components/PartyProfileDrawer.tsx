import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/lib/modules";
import { Phone, MapPin, FileText, TrendingUp, TrendingDown, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { MobileColorPicker } from "@/components/MobileColorPicker";
import { useMobileColors, mobileColorTextClass } from "@/hooks/useMobileColors";

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
  const { colorFor } = useMobileColors();

  const [displayName, setDisplayName] = useState<string | null>(partyName);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", address: "" });

  useEffect(() => {
    setDisplayName(partyName);
    setEditing(false);
  }, [partyName]);

  const beginEdit = () => {
    setForm({
      name: displayName ?? "",
      phone: contact?.phone ?? "",
      address: contact?.address ?? "",
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    const newName = form.name.trim();
    if (!newName) {
      toast.error("নাম খালি রাখা যাবে না");
      return;
    }
    setSaving(true);
    const codeCol = isCustomer ? "agent_code" : "vendor_code";
    // Find existing contact row by current name
    const { data: existing } = await supabase
      .from(contactsTable as never)
      .select("id")
      .eq("name", displayName ?? "")
      .maybeSingle();

    let err = null;
    if (existing && (existing as { id: string }).id) {
      const { error } = await supabase
        .from(contactsTable as never)
        .update({ name: newName, phone: form.phone.trim() || null, address: form.address.trim() || null } as never)
        .eq("id", (existing as { id: string }).id);
      err = error;
    } else {
      const code = `${isCustomer ? "AG" : "VN"}-${Date.now().toString().slice(-6)}`;
      const { error } = await supabase
        .from(contactsTable as never)
        .insert({ [codeCol]: code, name: newName, phone: form.phone.trim() || null, address: form.address.trim() || null } as never);
      err = error;
    }

    setSaving(false);
    if (err) {
      toast.error("সংরক্ষণ ব্যর্থ: " + err.message);
      return;
    }
    setContact((c) => ({ ...(c ?? {}), phone: form.phone.trim() || null, address: form.address.trim() || null }));
    setDisplayName(newName);
    setEditing(false);
    toast.success("তথ্য সংরক্ষণ হয়েছে");
  };

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
      if (p + applyAmt > 0 && Number(r.cost_price ?? 0) > 0) profit += Number(r.profit ?? 0);
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
    () =>
      rows
        .filter(
          (r) =>
            isPayment(r) ||
            isAdvance(r) ||
            Number(r[paidCol] ?? 0) > 0,
        )
        .slice(0, 20),
    [rows, paidCol],
  );

  if (!partyName) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3 pr-14 border-b">
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
              {editing ? (
                <div className="space-y-2">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Name</label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="নাম"
                      className="h-8 mt-0.5"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Mobile</label>
                    <Input
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                      placeholder="মোবাইল"
                      inputMode="tel"
                      className="h-8 mt-0.5"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Address</label>
                    <Textarea
                      value={form.address}
                      onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                      placeholder="ঠিকানা"
                      rows={2}
                      className="mt-0.5 text-sm"
                    />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" className="h-8" onClick={saveEdit} disabled={saving}>
                      <Check className="h-3.5 w-3.5 mr-1" /> {saving ? "Saving…" : "Save"}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8" onClick={() => setEditing(false)} disabled={saving}>
                      <X className="h-3.5 w-3.5 mr-1" /> Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-lg font-semibold leading-tight">{displayName}</div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
                      onClick={beginEdit}
                      aria-label="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-1.5 text-sm">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      {contact?.phone ? (
                        <>
                          <span className={mobileColorTextClass(colorFor(contact.phone))}>{contact.phone}</span>
                          <MobileColorPicker mobile={contact.phone} />
                        </>
                      ) : (
                        <span className="text-muted-foreground italic">মোবাইল নেই</span>
                      )}
                    </div>
                    <div className="flex items-start gap-2">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                      <span className="text-muted-foreground">{contact?.address || "ঠিকানা নেই"}</span>
                    </div>
                    {contact?.created_at && (
                      <div className="text-xs text-muted-foreground">
                        যোগ হয়েছে: {formatDate(contact.created_at)}
                      </div>
                    )}
                  </div>
                </>
              )}
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
