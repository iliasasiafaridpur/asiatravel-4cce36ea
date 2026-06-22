import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/lib/modules";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Phone,
  PhoneCall,
  MessageCircle,
  MapPin,
  Pencil,
  Check,
  X,
  Plus,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";

type LedgerRow = Record<string, unknown> & { id: string };
type Contact = { phone?: string | null; address?: string | null };
type ContactId = { id: string };

const fmtMoney = (n: number) => `৳${Number(n || 0).toLocaleString()}`;

/** Normalize a phone number to a wa.me-compatible international format (default BD +880). */
function waNumber(raw: string): string {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "880" + d.slice(1);
  return d;
}

export function PartyLedgerPage({
  kind,
  name,
}: {
  kind: "customer" | "vendor";
  name: string;
}) {
  const isCustomer = kind === "customer";
  const table = isCustomer ? "agency_ledger" : "vendor_ledger";
  const groupField = isCustomer ? "agent_name" : "vendor_name";
  const billCol = isCustomer ? "total_bill" : "total_payable";
  const paidCol = isCustomer ? "received_amount" : "paid_amount";
  const contactsTable = isCustomer ? "agents" : "vendors";
  const backTo = isCustomer ? "/customer-data" : "/vendor-data";

  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  // Authoritative balance row (matches the list page exactly).
  const [summary, setSummary] = useState<{ bill: number; paid: number; due: number; advance: number }>(
    { bill: 0, paid: 0, due: 0, advance: 0 },
  );
  // Vendor source files actually received (only these count financially).
  const [receivedSrcIds, setReceivedSrcIds] = useState<Set<string>>(new Set());

  const [displayName, setDisplayName] = useState<string>(name);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{ name: string; phones: string[]; address: string }>({
    name: "",
    phones: [""],
    address: "",
  });

  useEffect(() => {
    setDisplayName(name);
    setEditing(false);
  }, [name]);

  const phoneList = (contact?.phone ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const load = async () => {
    setLoading(true);
    const [ledgerRes, contactRes, balRes] = await Promise.all([
      supabase
        .from(table as never)
        .select("*")
        .eq(groupField, displayName)
        .order("entry_date", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(1000),
      supabase
        .from(contactsTable as never)
        .select("phone,address")
        .eq("name", displayName)
        .maybeSingle(),
      supabase.rpc((isCustomer ? "get_agent_balances" : "get_vendor_balances") as never),
    ]);
    const ledgerRows = (ledgerRes.data as unknown as LedgerRow[]) ?? [];
    setRows(ledgerRows);
    setContact((contactRes.data as Contact | null) ?? null);

    // Pick this party's authoritative balance row.
    const balRows = (balRes.data as unknown as Record<string, unknown>[]) ?? [];
    const nameKey = isCustomer ? "agent_name" : "vendor_name";
    const billKey = isCustomer ? "total_bill" : "total_payable";
    const paidKey = isCustomer ? "total_received" : "total_paid";
    const mine = balRows.find((b) => String(b[nameKey] ?? "") === displayName);
    setSummary({
      bill: Number(mine?.[billKey] ?? 0),
      paid: Number(mine?.[paidKey] ?? 0),
      due: Number(mine?.balance_due ?? 0),
      advance: Number(mine?.advance_balance ?? 0),
    });

    // For vendors: find which delivery-based source files were received.
    const received = new Set<string>();
    if (!isCustomer) {
      const byTable: Record<string, string[]> = { bmet_cards: [], saudi_visas: [], kuwait_visas: [] };
      for (const r of ledgerRows) {
        const src = String(r.source_table ?? "");
        const sid = String(r.source_id ?? "");
        if (sid && byTable[src]) byTable[src].push(sid);
      }
      await Promise.all(
        Object.entries(byTable).map(async ([tbl, ids]) => {
          if (!ids.length) return;
          const { data } = await supabase.from(tbl as never).select("id,received_date").in("id", ids);
          for (const row of (data as { id: string; received_date: string | null }[] | null) ?? []) {
            if (row.received_date) received.add(row.id);
          }
        }),
      );
    }
    setReceivedSrcIds(received);
    setLoading(false);
  };

  useEffect(() => {
    if (!displayName) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayName, table]);


  const beginEdit = () => {
    const list = (contact?.phone ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    setForm({
      name: displayName,
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
    const oldName = displayName;
    const codeCol = isCustomer ? "agent_code" : "vendor_code";
    const phoneStr = form.phones.map((p) => p.trim()).filter(Boolean).join(", ") || null;
    const { data: existingBeforeRename } = await supabase
      .from(contactsTable as never)
      .select("id")
      .eq("name", oldName)
      .limit(1)
      .maybeSingle();
    const existingId = (existingBeforeRename as ContactId | null)?.id;

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
    setEditing(false);
    toast.success("তথ্য সংরক্ষণ হয়েছে");
  };

  // Build the running statement (chronological). Mirrors get_agent_balances /
  // get_vendor_balances so the final running balance reconciles with the summary.
  const statement = useMemo(() => {
    type Stmt = {
      id: string;
      ledgerId: string;
      date: string;
      service: string;
      description: string;
      previous: number;
      deposit: number;
      credit: number;
      balance: number;
      advance: number;
    };

    // VENDOR: simple ledger — money paid to the vendor (ADVANCE / PAYMENT) is a
    // Deposit, no separate advance wallet. Latest entry shown on top.
    if (!isCustomer) {
      let bal = 0;
      const out: Stmt[] = [];
      for (const r of rows) {
        const svc = String(r.service_type ?? "").toUpperCase();
        if (svc === "OPENING") continue;
        const isDeposit = svc === "ADVANCE" || svc === "PAYMENT";
        // Sourced bills (BMET/Saudi/Kuwait) count only once received.
        const src = String(r.source_table ?? "");
        const sourced = src === "bmet_cards" || src === "saudi_visas" || src === "kuwait_visas";
        const counts = !sourced || receivedSrcIds.has(String(r.source_id ?? ""));
        if (!isDeposit && !counts) continue;
        const cash = Number(r[paidCol] ?? 0);
        const bill = isDeposit ? 0 : Number(r[billCol] ?? 0);
        const prev = bal;
        bal = prev + bill - cash;
        const desc = String(r.passenger_name ?? "").trim() || String(r.remarks ?? "").trim();
        out.push({
          id: String(r.id),
          ledgerId: String(r.ledger_id ?? ""),
          date: String(r.entry_date ?? ""),
          service: isDeposit ? "Deposit" : String(r.service_type ?? "—"),
          description: desc,
          previous: prev,
          deposit: cash,
          credit: bill,
          balance: bal,
          advance: 0,
        });
      }
      return out.reverse();
    }

    // CUSTOMER: keep the advance-wallet aware logic.
    let bal = 0;
    let adv = 0;
    const out: Stmt[] = [];
    for (const r of rows) {
      const svc = String(r.service_type ?? "").toUpperCase();
      if (svc === "PAYMENT" || svc === "OPENING") continue;
      const advRow = svc === "ADVANCE";
      const cash = Number(r[paidCol] ?? 0);
      const applied = Number(r.advance_applied ?? 0);
      const bill = Number(r[billCol] ?? 0);
      const discount = Number(r.discount_amount ?? 0);
      const prev = bal;

      if (advRow) {
        adv += cash;
      } else {
        bal = prev + bill - cash - applied - discount;
        adv = Math.max(adv - applied, 0);
      }
      out.push({
        id: String(r.id),
        ledgerId: String(r.ledger_id ?? ""),
        date: String(r.entry_date ?? ""),
        service: String(r.service_type ?? "—"),
        description: String(r.passenger_name ?? "").trim(),
        previous: prev,
        deposit: advRow ? cash : cash + applied,
        credit: advRow ? 0 : bill,
        balance: bal,
        advance: Math.max(adv, 0),
      });
    }
    return out;
  }, [rows, billCol, paidCol, isCustomer, receivedSrcIds]);

  const totals = summary;

  const pageTitle = isCustomer ? "Agency Ledger" : "Vendor Ledger";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link to={backTo}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <h1 className="text-lg font-bold">{pageTitle}</h1>
      </div>

      {/* Profile + summary */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
            {/* Profile */}
            <div>
              {editing ? (
                <div className="space-y-2 max-w-md">
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
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold leading-tight">{displayName}</span>
                    <Badge
                      variant="outline"
                      className={isCustomer ? "border-sky-500/50 text-sky-600" : "border-violet-500/50 text-violet-600"}
                    >
                      {isCustomer ? "Customer" : "Vendor"}
                    </Badge>
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
                          <span>{ph}</span>
                          <a
                            href={`tel:${ph.replace(/[^+\d]/g, "")}`}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30 transition-colors hover:bg-emerald-500/25"
                            aria-label={`Call ${ph}`}
                          >
                            <PhoneCall className="h-3.5 w-3.5" />
                          </a>
                          <a
                            href={`https://wa.me/${waNumber(ph)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-500/15 text-green-400 ring-1 ring-inset ring-green-500/30 transition-colors hover:bg-green-500/25"
                            aria-label={`WhatsApp ${ph}`}
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
                  </div>
                </>
              )}
            </div>

            {/* Thin summary board */}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:min-w-[420px]">
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {isCustomer ? "Total Bill" : "Total Payable"}
                </div>
                <div className="text-sm font-semibold tabular-nums">{fmtMoney(totals.bill)}</div>
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {isCustomer ? "Received" : "Paid"}
                </div>
                <div className="text-sm font-semibold tabular-nums text-emerald-600">{fmtMoney(totals.paid)}</div>
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Due</div>
                <div className={`text-sm font-semibold tabular-nums ${totals.due > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {fmtMoney(totals.due)}
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Advance</div>
                <div className="text-sm font-semibold tabular-nums text-emerald-600">{fmtMoney(totals.advance)}</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ledger statement */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          <h3 className="text-sm font-semibold mb-2">{pageTitle}</h3>
          <div className="overflow-x-auto rounded-md border">
            <Table className="table-fixed w-full min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[92px] whitespace-nowrap">Date</TableHead>
                  <TableHead className="w-[110px] whitespace-nowrap">ID</TableHead>
                  <TableHead className="w-[96px] whitespace-nowrap">Service Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[88px] text-right">Prev. Bal</TableHead>
                  <TableHead className="w-[84px] text-right">Deposit</TableHead>
                  <TableHead className="w-[80px] text-right">Credit</TableHead>
                  <TableHead className="w-[88px] text-right">Balance</TableHead>
                  {isCustomer && (
                    <TableHead className="w-[84px] text-right">Advance</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={isCustomer ? 9 : 8} className="text-center text-muted-foreground py-6">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : statement.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isCustomer ? 9 : 8} className="text-center text-muted-foreground py-6">
                      কোনো হিসাব নেই
                    </TableCell>
                  </TableRow>
                ) : (
                  statement.map((s, idx) => (
                    <TableRow key={s.id} className={`row-tint-${idx % 4}`}>
                      <TableCell className="whitespace-nowrap">{formatDate(s.date)}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{s.ledgerId}</TableCell>
                      <TableCell className="whitespace-nowrap">{s.service}</TableCell>
                      <TableCell className="max-w-[180px] truncate" title={s.description}>{s.description || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {s.previous.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600">
                        {s.deposit ? s.deposit.toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.credit ? s.credit.toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${s.balance > 0 ? "text-rose-600" : "text-muted-foreground"}`}>
                        {s.balance.toLocaleString()}
                      </TableCell>
                      {isCustomer && (
                        <TableCell className="text-right tabular-nums text-emerald-600">
                          {s.advance ? s.advance.toLocaleString() : "—"}
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
