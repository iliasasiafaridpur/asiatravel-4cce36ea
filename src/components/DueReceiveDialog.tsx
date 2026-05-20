import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Search, Wallet, History, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { generateNextId } from "@/lib/idgen";
import { formatDate } from "@/lib/modules";
import { resilientInsert, resilientUpdate, isNetworkError } from "@/lib/offline-queue";

// সার্ভিস টেবিলের ম্যাপিং — কোন কলামে received টাকা থাকে + extra context column
const SERVICES = [
  // hasDelivery=false means the table has no `delivery_date` column; delivery is tracked via status alone.
  { key: "tickets",     table: "tickets",      idCol: "ticket_id", recvCol: "received",        type: "Ticket",     extraCol: "trip_road",    extraLabel: "Route", hasDelivery: false, deliveredStatus: "DELIVERED" },
  { key: "bmet",        table: "bmet_cards",   idCol: "bmet_id",   recvCol: "received_amount", type: "BMET Card",  extraCol: "country_name", extraLabel: "Country", hasDelivery: true,  deliveredStatus: "Delivered" },
  { key: "saudi-visa",  table: "saudi_visas",  idCol: "saudi_id",  recvCol: "received_amount", type: "Saudi Visa", extraCol: "visa_type",    extraLabel: "Visa Type", hasDelivery: true,  deliveredStatus: "Delivered" },
  { key: "kuwait-visa", table: "kuwait_visas", idCol: "kuwait_id", recvCol: "received",        type: "Kuwait Visa",extraCol: "visa_no",      extraLabel: "Visa No", hasDelivery: true,  deliveredStatus: "Delivered" },
] as const;

const todayIso = () => new Date().toISOString().slice(0, 10);

type Service = typeof SERVICES[number];

export interface DueReceivePreselect {
  /** key of SERVICES entry — e.g. "tickets" / "bmet" / "saudi-visa" / "kuwait-visa" */
  serviceKey: Service["key"];
  /** uuid of the service row */
  rowId: string;
}

interface DueRow {
  service: Service;
  id: string;          // uuid
  refId: string;       // human id
  passenger: string;
  passport: string;
  mobile: string;
  sold: number;
  received: number;
  due: number;
  entryDate: string;
  extra: string;       // country / road / etc.
  agencySold: string;  // agent name for ledger routing
  deliveryDate: string | null;
}

interface ReceiptRow {
  id: string;
  receipt_id: string;
  amount: number;
  method: string;
  entry_date: string;
  remarks: string | null;
  received_by_name: string | null;
}

// Friendly error message extractor — Supabase errors are plain objects, not Error instances.
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    return String(o.message ?? o.details ?? o.hint ?? JSON.stringify(o));
  }
  return String(e);
}

export function DueReceiveDialog({
  open,
  onOpenChange,
  preselect,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  preselect?: DueReceivePreselect | null;
}) {
  const { user, profile } = useCurrentUser();
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<DueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<DueRow | null>(null);
  const [tab, setTab] = useState<"pay" | "history">("pay");

  // payment form
  const [amount, setAmount] = useState<string>("");
  const [discount, setDiscount] = useState<string>("");
  const [method, setMethod] = useState<string>("Cash");
  const [remarks, setRemarks] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [deliveryStatus, setDeliveryStatus] = useState<"Pending" | "Delivered">("Pending");
  const [savingDelivery, setSavingDelivery] = useState(false);

  // history
  const [history, setHistory] = useState<ReceiptRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Helper — fetch a single row by id from a given service
  const fetchOne = async (s: Service, rowId: string): Promise<DueRow | null> => {
    const cols = `id, ${s.idCol}, passenger_name, passport, mobile, sold_price, ${s.recvCol}, entry_date, ${s.extraCol}, agency_sold, status${s.hasDelivery ? ", delivery_date" : ""}`;
    const { data, error } = await supabase
      .from(s.table as never)
      .select(cols)
      .eq("id", rowId)
      .maybeSingle();
    if (error || !data) return null;
    const r = data as unknown as Record<string, unknown>;
    const sold = Number(r.sold_price ?? 0);
    const recv = Number(r[s.recvCol] ?? 0);
    const statusStr = String(r.status ?? "");
    const deliveredByStatus = statusStr.toLowerCase() === s.deliveredStatus.toLowerCase();
    const deliveryDate = s.hasDelivery
      ? (r.delivery_date ? String(r.delivery_date) : null)
      : (deliveredByStatus ? String(r.entry_date ?? todayIso()) : null);
    return {
      service: s,
      id: String(r.id),
      refId: String(r[s.idCol] ?? ""),
      passenger: String(r.passenger_name ?? ""),
      passport: String(r.passport ?? ""),
      mobile: String(r.mobile ?? ""),
      sold, received: recv, due: sold - recv,
      entryDate: String(r.entry_date ?? ""),
      extra: String(r[s.extraCol] ?? ""),
      agencySold: String(r.agency_sold ?? ""),
      deliveryDate,
    };
  };

  // Pre-select path: open straight onto a known row (called from due-cell click).
  useEffect(() => {
    if (!open || !preselect) return;
    let cancelled = false;
    (async () => {
      const s = SERVICES.find((x) => x.key === preselect.serviceKey);
      if (!s) return;
      const row = await fetchOne(s, preselect.rowId);
      if (cancelled || !row) return;
      setSelected(row);
      setTab("pay");
      setAmount(String(row.due));
      setDiscount("");
      setMethod("Cash");
      setRemarks("");
      setDeliveryStatus(row.deliveryDate ? "Delivered" : "Pending");
    })();
    return () => { cancelled = true; };
  }, [open, preselect?.serviceKey, preselect?.rowId]);

  // Browse path: load all due > 0 rows when no preselect.
  useEffect(() => {
    if (!open || preselect) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const all: DueRow[] = [];
        for (const s of SERVICES) {
          const cols = `id, ${s.idCol}, passenger_name, passport, mobile, sold_price, ${s.recvCol}, entry_date, ${s.extraCol}, agency_sold, status${s.hasDelivery ? ", delivery_date" : ""}`;
          const { data, error } = await supabase
            .from(s.table as never)
            .select(cols)
            .order("created_at", { ascending: false })
            .limit(500);
          if (error) continue;
          for (const r of (data as unknown as Record<string, unknown>[]) ?? []) {
            const sold = Number(r.sold_price ?? 0);
            const recv = Number(r[s.recvCol] ?? 0);
            const due = sold - recv;
            if (due <= 0) continue;
            const statusStr = String(r.status ?? "");
            const deliveredByStatus = statusStr.toLowerCase() === s.deliveredStatus.toLowerCase();
            const deliveryDate = s.hasDelivery
              ? (r.delivery_date ? String(r.delivery_date) : null)
              : (deliveredByStatus ? String(r.entry_date ?? todayIso()) : null);
            all.push({
              service: s,
              id: String(r.id),
              refId: String(r[s.idCol] ?? ""),
              passenger: String(r.passenger_name ?? ""),
              passport: String(r.passport ?? ""),
              mobile: String(r.mobile ?? ""),
              sold, received: recv, due,
              entryDate: String(r.entry_date ?? ""),
              extra: String(r[s.extraCol] ?? ""),
              agencySold: String(r.agency_sold ?? ""),
              deliveryDate,
            });
          }
        }
        if (!cancelled) setItems(all);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, preselect]);

  // search filter
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((r) =>
      r.passenger.toLowerCase().includes(q) ||
      r.passport.toLowerCase().includes(q) ||
      r.mobile.toLowerCase().includes(q) ||
      r.refId.toLowerCase().includes(q)
    );
  }, [items, search]);

  // load history when selecting
  useEffect(() => {
    if (!selected) { setHistory([]); return; }
    let cancelled = false;
    (async () => {
      setHistoryLoading(true);
      const { data } = await supabase
        .from("payment_receipts")
        .select("id, receipt_id, amount, method, entry_date, remarks, received_by_name")
        .eq("service_row_id", selected.id)
        .order("entry_date", { ascending: false });
      if (!cancelled) setHistory((data as ReceiptRow[]) ?? []);
      setHistoryLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selected]);

  const openPay = (row: DueRow) => {
    setSelected(row);
    setTab("pay");
    setAmount(String(row.due));
    setDiscount("");
    setMethod("Cash");
    setRemarks("");
    setDeliveryStatus(row.deliveryDate ? "Delivered" : "Pending");
  };

  const handleClose = (v: boolean) => {
    onOpenChange(v);
    if (!v) {
      setSelected(null);
      setSearch("");
    }
  };

  const saveDeliveryStatus = async (next: "Pending" | "Delivered") => {
    if (!selected) return;
    setDeliveryStatus(next);
    setSavingDelivery(true);
    try {
      const newDate = next === "Delivered" ? todayIso() : null;
      const s = selected.service;
      const patch: Record<string, unknown> = {};
      if (s.hasDelivery) patch.delivery_date = newDate;
      patch.status = next === "Delivered" ? s.deliveredStatus : "Pending";
      await resilientUpdate(
        s.table,
        { id: selected.id },
        patch,
      );
      const localDate = s.hasDelivery ? newDate : (next === "Delivered" ? todayIso() : null);
      setSelected({ ...selected, deliveryDate: localDate });
      setItems((prev) => prev.map((r) => r.id === selected.id ? { ...r, deliveryDate: localDate } : r));
      toast.success(next === "Delivered" ? "✓ Delivered হিসেবে সংরক্ষিত" : "Pending Delivery হিসেবে আপডেট হয়েছে");
    } catch (e) {
      if (isNetworkError(e)) {
        toast.success("ইন্টারনেট নেই! স্ট্যাটাস অটো-সেভ হয়েছে।");
      } else {
        toast.error("সমস্যা: " + errMsg(e));
      }
    } finally {
      setSavingDelivery(false);
    }
  };

  const submitPayment = async (withDelivery: boolean) => {
    if (!selected) return;
    const amt = Number(amount) || 0;
    const disc = Math.max(0, Number(discount) || 0);
    if (amt <= 0 && disc <= 0) return toast.error("সঠিক টাকার পরিমাণ অথবা ডিসকাউন্ট দিন");
    if (!user?.id) return toast.error("লগইন প্রয়োজন");

    const effectiveDue = Math.max(0, selected.due - disc);
    const excess = Math.max(0, amt - effectiveDue);
    const appliedToDue = amt - excess;

    if (excess > 0) {
      const agentName = selected.agencySold?.trim();
      if (!agentName) {
        return toast.error("এই বুকিং-এ কোনো Agency নেই — অতিরিক্ত টাকা Advance হিসেবে রাখা যাবে না।");
      }
      const ok = window.confirm(
        `আপনি বকেয়া বিলের চেয়ে অতিরিক্ত ৳${excess.toLocaleString()} টাকা ইনপুট দিয়েছেন। ` +
        `অতিরিক্ত টাকাটি Agent "${agentName}" এর লেজারে Advance হিসাবে যুক্ত হবে। আপনি কি নিশ্চিত?`
      );
      if (!ok) return;
    }

    setSaving(true);
    try {
      const me = displayName(profile, user);
      const today = todayIso();

      // 1) update service row — apply payment to received, apply discount by reducing sold_price
      const newRecv = selected.received + appliedToDue;
      const newSold = selected.sold - disc;
      const upd: Record<string, unknown> = {};
      upd[selected.service.recvCol] = newRecv;
      if (disc > 0) upd.sold_price = newSold;
      upd.received_by = user.id;
      if (withDelivery) {
        if (selected.service.hasDelivery) upd.delivery_date = today;
        upd.status = selected.service.deliveredStatus;
      }
      const updRes = await resilientUpdate(
        selected.service.table,
        { id: selected.id },
        upd,
      );

      // 2) insert payment_receipts entry — record the full cash received
      let receiptId: string;
      try {
        receiptId = await generateNextId({
          key: "_rcpt", label: "", short: "", table: "payment_receipts",
          idColumn: "receipt_id", idPrefix: "RCPT", monthlyId: true, fields: [],
        });
      } catch (e) {
        if (!isNetworkError(e)) throw e;
        const d = new Date();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yy = String(d.getFullYear()).slice(-2);
        receiptId = `RCPT-${mm}${yy}-OFFLINE-${Date.now().toString().slice(-6)}`;
      }

      const remarkParts: string[] = [];
      if (remarks) remarkParts.push(remarks);
      if (disc > 0) remarkParts.push(`Discount ৳${disc.toLocaleString()} প্রয়োগ`);
      if (excess > 0) remarkParts.push(`অতিরিক্ত ৳${excess.toLocaleString()} → ${selected.agencySold} এর Advance Ledger-এ যুক্ত`);
      const receiptRemarks = remarkParts.length ? remarkParts.join(" · ") : null;

      const insRes = await resilientInsert("payment_receipts", {
        receipt_id: receiptId,
        entry_date: today,
        service_type: selected.service.type,
        service_table: selected.service.table,
        service_row_id: selected.id,
        ref_id: selected.refId,
        passenger_name: selected.passenger,
        amount: amt,
        method,
        source: "due",
        remarks: receiptRemarks,
        received_by: user.id,
        received_by_name: me,
      });

      // 3) if excess → route to agency_ledger as Advance Received
      let ledgerOffline = false;
      if (excess > 0 && selected.agencySold) {
        let ledgerId: string;
        try {
          ledgerId = await generateNextId({
            key: "agency-ledger", label: "", short: "", table: "agency_ledger",
            idColumn: "ledger_id", idPrefix: "AGL", monthlyId: true, fields: [],
          });
        } catch (e) {
          if (!isNetworkError(e)) throw e;
          const d = new Date();
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const yy = String(d.getFullYear()).slice(-2);
          ledgerId = `AGL-${mm}${yy}-OFFLINE-${Date.now().toString().slice(-6)}`;
        }
        const ledRes = await resilientInsert("agency_ledger", {
          ledger_id: ledgerId,
          entry_date: today,
          agent_name: selected.agencySold,
          passenger_name: selected.passenger,
          passport: selected.passport || null,
          mobile: selected.mobile || null,
          service_type: "ADVANCE",
          total_bill: 0,
          received_amount: excess,
          advance_applied: 0,
          payment_method: method,
          source_table: "due_excess",
          source_id: selected.id,
          remarks: `Advance Received · Due Receive excess from ${selected.refId} (${selected.service.type})${remarks ? " · " + remarks : ""}`,
          created_by: user.id,
          received_by: user.id,
        });
        ledgerOffline = ledRes.offline;
      }

      const wasOffline = updRes.offline || insRes.offline || ledgerOffline;
      if (!wasOffline) {
        if (excess > 0) {
          toast.success(`✓ Due Cleared (৳${appliedToDue.toLocaleString()}) + Advance ৳${excess.toLocaleString()} → ${selected.agencySold}`);
        } else {
          toast.success(`✓ Due Received: ${amt.toLocaleString()}`);
        }
      }

      // update local state
      const newSoldLocal = selected.sold - disc;
      setItems((prev) =>
        prev.map((r) => (r.id === selected.id
          ? { ...r, sold: newSoldLocal, received: newRecv, due: newSoldLocal - newRecv }
          : r)).filter((r) => r.due > 0)
      );
      const updated: DueRow = {
        ...selected,
        sold: newSoldLocal,
        received: newRecv,
        due: newSoldLocal - newRecv,
        deliveryDate: withDelivery ? today : (upd.delivery_date !== undefined ? (upd.delivery_date as string | null) : selected.deliveryDate),
      };
      if (updated.due <= 0) {
        handleClose(false);
      } else {
        setSelected(updated);
        setTab(wasOffline ? "pay" : "history");
        setAmount("");
        setDiscount("");
      }
    } catch (e) {
      if (isNetworkError(e)) {
        toast.success("ইন্টারনেট নেই! ডাটাটি কম্পিউটারে সুরক্ষিতভাবে অটো-সেভ করা হয়েছে।", { duration: 4000 });
      } else {
        toast.error("সমস্যা: " + errMsg(e));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            {selected ? `Due Receive — ${selected.passenger}` : "Due Receive — যাত্রী খুঁজুন"}
          </DialogTitle>
        </DialogHeader>

        {!selected ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="নাম, পাসপোর্ট, মোবাইল বা ID দিয়ে খুঁজুন…"
                className="pl-8"
              />
            </div>

            {loading && <p className="text-sm text-muted-foreground text-center py-4">লোড হচ্ছে…</p>}
            {!loading && filtered.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">কোনো বকেয়া (Due) যাত্রী পাওয়া যায়নি</p>
            )}

            <div className="space-y-2 max-h-[55vh] overflow-y-auto">
              {filtered.map((r) => (
                <Card key={`${r.service.key}-${r.id}`} className="cursor-pointer hover:bg-accent/30 transition-colors" onClick={() => openPay(r)}>
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-primary">{r.refId}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded border bg-muted/40">{r.service.type}</span>
                        {r.extra && <span className="text-xs px-1.5 py-0.5 rounded border bg-primary/10">{r.extra}</span>}
                      </div>
                      <p className="font-semibold truncate">{r.passenger}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {r.passport || "—"} • {r.mobile || "—"} • {formatDate(r.entryDate)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-muted-foreground">Due</p>
                      <p className="text-lg font-bold text-rose-500 tabular-nums">{r.due.toLocaleString()}</p>
                      <p className="text-[10px] text-muted-foreground">of {r.sold.toLocaleString()}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {!preselect && (
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)} className="gap-1">
                <ArrowLeft className="h-4 w-4" /> ফিরে যান
              </Button>
            )}

            <Card>
              <CardContent className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div><p className="text-xs text-muted-foreground">ID</p><p className="font-mono text-xs">{selected.refId}</p></div>
                <div><p className="text-xs text-muted-foreground">Service</p><p>{selected.service.type}</p></div>
                <div>
                  <p className="text-xs text-muted-foreground">{selected.service.extraLabel}</p>
                  <p className="truncate">{selected.extra || "—"}</p>
                </div>
                <div><p className="text-xs text-muted-foreground">Sold</p><p className="tabular-nums">{selected.sold.toLocaleString()}</p></div>
                <div><p className="text-xs text-muted-foreground">Received</p><p className="tabular-nums text-emerald-600">{selected.received.toLocaleString()}</p></div>
                <div className="col-span-2 sm:col-span-3 pt-1 border-t sm:border-t-0 sm:border-l sm:pl-3">
                  <p className="text-xs text-muted-foreground">Outstanding Due</p>
                  <p className="text-2xl font-bold text-rose-500 tabular-nums">{selected.due.toLocaleString()}</p>
                </div>
              </CardContent>
            </Card>

            <Tabs value={tab} onValueChange={(v) => setTab(v as "pay" | "history")}>
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="pay" className="gap-1"><Wallet className="h-3.5 w-3.5" /> Receive Payment</TabsTrigger>
                <TabsTrigger value="history" className="gap-1"><History className="h-3.5 w-3.5" /> History ({history.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="pay" className="space-y-3 pt-3">



                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label>Amount</Label>
                    <Input
                      type="number" inputMode="decimal" min={0}
                      value={amount} onChange={(e) => setAmount(e.target.value)}
                      className="mt-1.5 text-lg font-semibold"
                    />
                  </div>
                  <div>
                    <Label>Discount</Label>
                    <Input
                      type="number" inputMode="decimal" min={0}
                      value={discount} onChange={(e) => setDiscount(e.target.value)}
                      className="mt-1.5 text-lg font-semibold"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label>Method</Label>
                    <Select value={method} onValueChange={setMethod}>
                      <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["Cash","bKash","Nagad","Rocket","Bank Transfer","Cheque","Other"].map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground -mt-1">
                  Due: {selected.due.toLocaleString()}
                  {Number(discount) > 0 && <> · Discount: ৳{Number(discount).toLocaleString()} · Effective Due: ৳{Math.max(0, selected.due - Number(discount)).toLocaleString()}</>}
                  {" "}— অতিরিক্ত দিলে Agent এর Advance Ledger-এ যুক্ত হবে।
                </div>
                {Number(amount) > Math.max(0, selected.due - (Number(discount) || 0)) && (
                  <p className="text-[11px] text-amber-600 font-semibold -mt-2">
                    অতিরিক্ত: ৳{(Number(amount) - Math.max(0, selected.due - (Number(discount) || 0))).toLocaleString()} → {selected.agencySold || "(no agency)"}
                  </p>
                )}
                <div>
                  <Label>Remarks</Label>
                  <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className="mt-1.5" placeholder="মন্তব্য (ঐচ্ছিক)" />
                </div>
                <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-2">
                  <Button variant="outline" onClick={() => handleClose(false)}>বাতিল</Button>
                  <Button
                    onClick={() => submitPayment(false)}
                    disabled={saving}
                    className="gap-2 bg-amber-500 hover:bg-amber-600 text-white"
                  >
                    <Wallet className="h-4 w-4" />
                    {saving ? "সেভ হচ্ছে…" : "Rece: Payment Without-Delivery"}
                  </Button>
                  <Button
                    onClick={() => submitPayment(true)}
                    disabled={saving}
                    className="bg-emerald-600 hover:bg-emerald-700 gap-2 text-white"
                  >
                    <Wallet className="h-4 w-4" />
                    {saving ? "সেভ হচ্ছে…" : "Rece: Payment With-Delivery"}
                  </Button>
                </DialogFooter>
              </TabsContent>

              <TabsContent value="history" className="pt-3">
                {historyLoading ? (
                  <p className="text-sm text-muted-foreground text-center py-4">লোড হচ্ছে…</p>
                ) : history.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">এখনো কোনো পেমেন্ট হয়নি</p>
                ) : (
                  <div className="space-y-2">
                    {history.map((h) => (
                      <Card key={h.id}>
                        <CardContent className="p-3 flex items-center justify-between gap-2 text-sm">
                          <div className="min-w-0">
                            <p className="font-mono text-xs text-primary">{h.receipt_id}</p>
                            <p className="text-xs text-muted-foreground">{formatDate(h.entry_date)} • {h.method} • {h.received_by_name ?? "—"}</p>
                            {h.remarks && <p className="text-xs italic mt-0.5">{h.remarks}</p>}
                          </div>
                          <p className="text-lg font-bold tabular-nums text-emerald-600">{Number(h.amount).toLocaleString()}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
