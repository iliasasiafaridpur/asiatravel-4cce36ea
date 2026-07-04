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
import { Phone, PhoneCall, MessageCircle, MapPin, FileText, TrendingUp, TrendingDown, Pencil, Check, X, Plus, Package } from "lucide-react";
import { toast } from "sonner";
import { MobileColorPicker } from "@/components/MobileColorPicker";
import { useMobileColors, mobileColorTextClass } from "@/hooks/useMobileColors";
import { CourierEnvelopeDialog } from "@/components/CourierEnvelopeDialog";

/** Normalize a phone number to a wa.me-compatible international format (default BD +880). */
function waNumber(raw: string): string {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "880" + d.slice(1);
  return d;
}

type LedgerRow = Record<string, unknown> & { id: string };
type Contact = { phone?: string | null; address?: string | null; created_at?: string | null; settle_mode?: string | null };
type ContactId = { id: string };

const fmtMoney = (n: number) => `৳${Number(n || 0).toLocaleString()}`;
const isAdvance = (r: LedgerRow) => String(r.service_type ?? "").toUpperCase() === "ADVANCE";
const isPayment = (r: LedgerRow) => String(r.service_type ?? "").toUpperCase() === "PAYMENT";

export function PartyProfileDrawer({
  open,
  onOpenChange,
  kind,
  partyName,
  onRenamed,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: "customer" | "vendor";
  partyName: string | null;
  onRenamed?: (oldName: string, newName: string) => void;
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
  // Source ids (bmet/saudi/kuwait) that have actually been RECEIVED from the vendor.
  // Used to show only vendor-received files in the Recent Service Files list.
  const [receivedSrcIds, setReceivedSrcIds] = useState<Set<string>>(new Set());
  const { colorFor } = useMobileColors();

  const [displayName, setDisplayName] = useState<string | null>(partyName);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ name: string; phones: string[]; address: string }>({ name: "", phones: [""], address: "" });
  const [courierOpen, setCourierOpen] = useState(false);



  useEffect(() => {
    setDisplayName(partyName);
    setEditing(false);
  }, [partyName]);

  const phoneList = (contact?.phone ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const beginEdit = () => {
    const list = (contact?.phone ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    setForm({
      name: displayName ?? "",
      phones: list.length ? list : [""],
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
    const oldName = displayName ?? "";
    const codeCol = isCustomer ? "agent_code" : "vendor_code";
    const phoneStr = form.phones.map((p) => p.trim()).filter(Boolean).join(", ") || null;
    const { data: existingBeforeRename } = await supabase
      .from(contactsTable as never)
      .select("id")
      .eq("name", oldName)
      .limit(1)
      .maybeSingle();
    const existingId = (existingBeforeRename as ContactId | null)?.id;

    // 1) If the name changed, propagate the rename across ALL related data
    //    (service files, extra services, and ledgers) so the profile keeps
    //    all its history instead of becoming orphaned.
    if (newName !== oldName && oldName) {
      const { error: renameErr } = await supabase.rpc("rename_party", {
        p_kind: kind,
        p_old_name: oldName,
        p_new_name: newName,
      });
      if (renameErr) {
        setSaving(false);
        toast.error("নাম পরিবর্তন ব্যর্থ: " + renameErr.message);
        return;
      }
    }

    // 2) Update (or create) the contact record with the new name + details.
    let err = null;
    if (existingId) {
      const { error } = await supabase
        .from(contactsTable as never)
        .update({ name: newName, phone: phoneStr, address: form.address.trim() || null } as never)
        .eq("id", existingId);
      err = error;
    } else {
      const { data: existingAfterRename } = await supabase
        .from(contactsTable as never)
        .select("id")
        .eq("name", newName)
        .limit(1)
        .maybeSingle();
      const newExistingId = (existingAfterRename as ContactId | null)?.id;
      if (newExistingId) {
        const { error } = await supabase
          .from(contactsTable as never)
          .update({ name: newName, phone: phoneStr, address: form.address.trim() || null } as never)
          .eq("id", newExistingId);
        err = error;
      } else {
        const code = `${isCustomer ? "AG" : "VN"}-${Date.now().toString().slice(-6)}`;
        const { error } = await supabase
          .from(contactsTable as never)
          .insert({ [codeCol]: code, name: newName, phone: phoneStr, address: form.address.trim() || null } as never);
        err = error;
      }
    }

    setSaving(false);
    if (err) {
      toast.error("সংরক্ষণ ব্যর্থ: " + err.message);
      return;
    }
    setContact((c) => ({ ...(c ?? {}), phone: phoneStr, address: form.address.trim() || null }));
    setDisplayName(newName);
    if (newName !== oldName && oldName) onRenamed?.(oldName, newName);
    setEditing(false);
    toast.success("তথ্য সংরক্ষণ হয়েছে");
  };

  useEffect(() => {
    const activeName = displayName ?? partyName;
    if (!open || !activeName) {
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
          .eq(groupField, activeName)
          .order("entry_date", { ascending: false })
          .limit(500),
        supabase
          .from(contactsTable as never)
          .select("phone,address,created_at,settle_mode")
          .eq("name", activeName)
          .order("settle_mode", { ascending: true })
          .limit(10),

      ]);
      const ledgerRows = ((ledgerRes.data as unknown as LedgerRow[]) ?? []);

      // For vendors: figure out which delivery-based source files (BMET / Saudi /
      // Kuwait) have actually been received from the vendor, so the Recent Service
      // Files list only shows files that count in the vendor's accounting.
      const received = new Set<string>();
      if (!isCustomer) {
        const byTable: Record<string, string[]> = {
          bmet_cards: [],
          saudi_visas: [],
          kuwait_visas: [],
        };
        for (const r of ledgerRows) {
          const src = String(r.source_table ?? "");
          const sid = String(r.source_id ?? "");
          if (sid && (src === "bmet_cards" || src === "saudi_visas" || src === "kuwait_visas")) {
            byTable[src].push(sid);
          }
        }
        await Promise.all(
          Object.entries(byTable).map(async ([tbl, ids]) => {
            if (!ids.length) return;
            const { data } = await supabase
              .from(tbl as never)
              .select("id,received_date")
              .in("id", ids);
            for (const row of (data as { id: string; received_date: string | null }[] | null) ?? []) {
              if (row.received_date) received.add(row.id);
            }
          }),
        );
      }

      if (!cancelled) {
        setRows(ledgerRows);
        setReceivedSrcIds(received);
        // Duplicate-tolerant merge (same fix as PartyLedgerPage): never silently
        // null the contact, and keep an explicit one_by_one settle_mode choice.
        const cRows = (contactRes.data as Contact[] | null) ?? [];
        setContact(
          cRows.length
            ? {
                ...cRows[0],
                phone: cRows.find((c) => c.phone)?.phone ?? null,
                address: cRows.find((c) => c.address)?.address ?? null,
                settle_mode: cRows.some((c) => c.settle_mode === "one_by_one")
                  ? "one_by_one"
                  : "total",
              }
            : null,
        );

        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, partyName, displayName, table, groupField, contactsTable, isCustomer]);

  // A bill row "counts" in the party's accounting only when it is real money
  // owed/owing now. For vendors, delivery-based source files (BMET/Saudi/Kuwait)
  // count ONLY once received from the vendor (Received Date From Vendor set) —
  // exactly mirroring the live Vendor Balance table (get_vendor_balances).
  // Other sources (tickets/others) and all customer rows always count.
  const counts = useMemo(() => {
    return (r: LedgerRow) => {
      if (isCustomer) return true;
      const src = String(r.source_table ?? "");
      if (src !== "bmet_cards" && src !== "saudi_visas" && src !== "kuwait_visas") return true;
      return receivedSrcIds.has(String(r.source_id ?? ""));
    };
  }, [isCustomer, receivedSrcIds]);

  const stats = useMemo(() => {
    let bill = 0, cashPaid = 0, applied = 0, advance = 0, profit = 0;
    const byService = new Map<string, { count: number; bill: number; paid: number; due: number }>();
    for (const r of rows) {
      // PAYMENT log rows are a display-only summary; their amount is already
      // reflected in the individual bills' paid figures, so skip to avoid
      // double-counting the vendor's total paid.
      if (isPayment(r)) continue;
      const applyAmt = Number(r.advance_applied ?? 0);
      if (isAdvance(r)) {
        advance += Number(r[paidCol] ?? 0);
        applied += applyAmt;
        continue;
      }
      // Skip delivery files not yet received from the vendor — they are not part
      // of the vendor's real accounting yet (matches the Vendor Balance table).
      if (!counts(r)) continue;
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
  }, [rows, billCol, paidCol, counts]);

  // All service files that count in the accounting (no slice) — used for both
  // the recent list and the file counters so they never disagree.
  const eligibleServiceRows = useMemo(
    () => rows.filter((r) => !isAdvance(r) && !isPayment(r) && counts(r)),
    [rows, counts],
  );
  const serviceRows = useMemo(() => eligibleServiceRows.slice(0, 20), [eligibleServiceRows]);
  const paymentRows = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            // Exclude PAYMENT log rows (display-only summary in the main ledger);
            // the actual paid amounts already live on the individual bill rows.
            !isPayment(r) &&
            (isAdvance(r) ||
              Number(r[paidCol] ?? 0) > 0 ||
              Number(r.advance_applied ?? 0) > 0),
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
                    <div className="space-y-1.5 mt-0.5">
                      {form.phones.map((p, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <Input
                            value={p}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                phones: f.phones.map((x, xi) => (xi === i ? e.target.value : x)),
                              }))
                            }
                            placeholder={`মোবাইল ${i + 1}`}
                            inputMode="tel"
                            className="h-8"
                          />
                          {form.phones.length > 1 && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={() =>
                                setForm((f) => ({ ...f, phones: f.phones.filter((_, xi) => xi !== i) }))
                              }
                              aria-label="Remove"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => setForm((f) => ({ ...f, phones: [...f.phones, ""] }))}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" /> আরেকটি নাম্বার
                      </Button>
                    </div>
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
                    {phoneList.length ? (
                      phoneList.map((ph, i) => (
                        <div key={i} className="flex items-center gap-2 flex-wrap">
                          <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className={mobileColorTextClass(colorFor(ph))}>{ph}</span>
                          <MobileColorPicker mobile={ph} />
                          <a
                            href={`tel:${ph.replace(/[^+\d]/g, "")}`}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30 transition-colors hover:bg-emerald-500/25"
                            aria-label={`Call ${ph}`}
                            title={`কল করুন ${ph}`}
                          >
                            <PhoneCall className="h-3.5 w-3.5" />
                          </a>
                          <a
                            href={`https://wa.me/${waNumber(ph)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-500/15 text-green-400 ring-1 ring-inset ring-green-500/30 transition-colors hover:bg-green-500/25"
                            aria-label={`WhatsApp ${ph}`}
                            title={`WhatsApp ${ph}`}
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-muted-foreground italic">মোবাইল নেই</span>
                      </div>
                    )}
                    <div className="flex items-start gap-2">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                      <span className="text-muted-foreground">{contact?.address || "ঠিকানা নেই"}</span>
                    </div>
                    <div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs mt-1"
                        onClick={() => setCourierOpen(true)}
                      >
                        <Package className="h-3.5 w-3.5 mr-1" /> ঠিকানা প্রিন্ট (কুরিয়ার খাম)
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </section>

            <CourierEnvelopeDialog
              open={courierOpen}
              onOpenChange={setCourierOpen}
              name={displayName ?? ""}
              phones={phoneList}
              address={contact?.address ?? ""}
            />

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
                    {isCustomer ? fmtMoney(stats.profit) : eligibleServiceRows.length}
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
                        <th className="px-2 py-1.5 font-medium text-right">{isCustomer ? "Bill" : "Vendor Cost"}</th>
                        <th className="px-2 py-1.5 font-medium text-right">{isCustomer ? "Received" : "Paid"}</th>
                        <th className="px-2 py-1.5 font-medium text-right">Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {serviceRows.map((r) => {
                        const b = Number(r[billCol] ?? 0);
                        const p = Number(r[paidCol] ?? 0);
                        const a = Number(r.advance_applied ?? 0);
                        const paid = p + a;
                        const due = Math.max(b - paid, 0);
                        return (
                          <tr key={r.id} className="border-t">
                            <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(r.entry_date as string)}</td>
                            <td className="px-2 py-1.5 truncate max-w-[110px]">{String(r.passenger_name ?? "—")}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(b)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-emerald-600">{fmtMoney(paid)}</td>
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
                        <th className="px-2 py-1.5 font-medium">Date / সমন্বিত বিল</th>
                        <th className="px-2 py-1.5 font-medium text-right">Amount</th>
                        <th className="px-2 py-1.5 font-medium">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentRows.map((r) => {
                        const adv = isAdvance(r);
                        const cash = Number(r[paidCol] ?? 0);
                        const applied = Number(r.advance_applied ?? 0);
                        const amount = adv ? cash : cash + applied;
                        const billName = adv
                          ? "অগ্রিম জমা (নির্দিষ্ট ফাইল নয়)"
                          : String(r.passenger_name ?? "—");
                        const typeLabel = adv
                          ? "Advance"
                          : cash > 0 && applied > 0
                            ? "Cash + Advance"
                            : applied > 0
                              ? "Advance Applied"
                              : "Cash";
                        return (
                          <tr key={r.id} className="border-t align-top">
                            <td className="px-2 py-1.5">
                              <div className="whitespace-nowrap">{formatDate(r.entry_date as string)}</div>
                              <div className="text-[10px] text-muted-foreground truncate max-w-[130px]">
                                {billName}
                              </div>
                              <div className="text-[10px] text-muted-foreground">{String(r.payment_method ?? "—")}</div>
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                              {fmtMoney(amount)}
                              {!adv && cash > 0 && applied > 0 && (
                                <div className="text-[10px] font-normal text-muted-foreground">
                                  Cash {fmtMoney(cash)} + Adv {fmtMoney(applied)}
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-1.5">
                              {adv ? (
                                <Badge variant="outline" className="border-amber-500/50 text-amber-600 text-[10px]">
                                  Advance
                                </Badge>
                              ) : applied > 0 && cash === 0 ? (
                                <Badge variant="outline" className="border-sky-500/50 text-sky-600 text-[10px]">
                                  {typeLabel}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="border-emerald-500/50 text-emerald-600 text-[10px]">
                                  {typeLabel}
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
                        {eligibleServiceRows.length}
                      </div>
                    </div>
                    <div className="rounded-lg border bg-background p-3">
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <TrendingDown className="h-3 w-3" /> Pending Files
                      </div>
                      <div className="mt-0.5 text-base font-semibold text-amber-600">
                        {eligibleServiceRows.filter((r) => {
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
