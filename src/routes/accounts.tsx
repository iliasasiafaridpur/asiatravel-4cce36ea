import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowDownLeft, ArrowUpRight, Download, Plus, Receipt, RefreshCw, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/modules";

export const Route = createFileRoute("/accounts")({
  head: () => ({ meta: [{ title: "My Accounts — Travel Manager" }] }),
  component: AccountsPage,
});

const METHODS = ["Cash", "Hand Cash", "Bank", "bKash", "Nagad", "Other"];
const EXPENSE_CATEGORIES = ["Office", "Transport", "Food", "Stationery", "Bill", "Other"];
const SERVICES = ["AIR TICKET", "BMET", "Saudi Visa", "Kuwait Visa", "Other"];
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${new Date().toISOString().slice(0, 8)}01`;

interface Acct {
  user_id: string;
  full_name: string;
  total_received: number;
  total_received_today?: number;
  total_handed_over: number;
  total_expenses: number;
  current_balance: number;
}
interface Hand { id: string; handover_id: string; entry_date: string; to_name: string; amount: number; method: string; remarks: string | null; }
interface Exp  { id: string; expense_id: string; entry_date: string; category: string; purpose: string | null; amount: number; remarks: string | null; }
interface Recv {
  id: string;
  receipt_id: string;
  entry_date: string;
  service_type: string;
  ref_id: string | null;
  passenger_name: string;
  amount: number;
  method: string;
  source: string;
  remarks: string | null;
  received_by_name: string | null;
}

type CachePayload = {
  acct: Acct | null;
  overview: Acct[];
  handovers: Hand[];
  expenses: Exp[];
  received: Recv[];
};

function AccountsPage() {
  const { user, profile } = useCurrentUser();
  const [acct, setAcct] = useState<Acct | null>(null);
  const [overview, setOverview] = useState<Acct[]>([]);
  const [handovers, setHandovers] = useState<Hand[]>([]);
  const [expenses, setExpenses] = useState<Exp[]>([]);
  const [received, setReceived] = useState<Recv[]>([]);
  const [dateFrom, setDateFrom] = useState(monthStart());
  const [dateTo, setDateTo] = useState(today());
  const [serviceFilter, setServiceFilter] = useState("all");
  const [syncing, setSyncing] = useState(false);
  const [hForm, setHForm] = useState({ entry_date: today(), to_name: "MD Sir", amount: 0, method: "Hand Cash", remarks: "" });
  const [eForm, setEForm] = useState({ entry_date: today(), category: "Office", purpose: "", amount: 0, remarks: "" });
  const [rForm, setRForm] = useState({ entry_date: today(), service_type: "AIR TICKET", ref_id: "", passenger_name: "", amount: 0, method: "Cash", remarks: "" });
  const reloadingRef = useRef(false);
  const queuedRef = useRef(false);
  const cacheKey = user?.id ? `accounts_cache_v2_${user.id}` : "accounts_cache_v2_guest";

  useEffect(() => {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return;
      const cached = JSON.parse(raw) as CachePayload;
      setAcct(cached.acct ?? null);
      setOverview(cached.overview ?? []);
      setHandovers(cached.handovers ?? []);
      setExpenses(cached.expenses ?? []);
      setReceived(cached.received ?? []);
    } catch { /* ignore cache */ }
  }, [cacheKey]);

  const persistCache = useCallback((payload: CachePayload) => {
    try { localStorage.setItem(cacheKey, JSON.stringify(payload)); } catch { /* storage quota */ }
  }, [cacheKey]);

  const reload = useCallback(async (quiet = false) => {
    if (!user?.id) return;
    if (reloadingRef.current) {
      queuedRef.current = true;
      return;
    }
    reloadingRef.current = true;
    if (!quiet) setSyncing(true);

    const [a, ov, h, e, r] = await Promise.all([
      supabase.rpc("get_user_account" as never, { _user_id: user.id } as never),
      supabase.rpc("get_accounts_overview" as never),
      supabase.from("cash_handovers").select("id,handover_id,entry_date,to_name,amount,method,remarks").eq("from_user", user.id).order("entry_date", { ascending: false }).limit(300),
      supabase.from("cash_expenses").select("id,expense_id,entry_date,category,purpose,amount,remarks").eq("spent_by", user.id).order("entry_date", { ascending: false }).limit(300),
      supabase.from("payment_receipts").select("id,receipt_id,entry_date,service_type,ref_id,passenger_name,amount,method,source,remarks,received_by_name").order("entry_date", { ascending: false }).limit(500),
    ]);

    const firstError = a.error || ov.error || h.error || e.error || r.error;
    if (firstError) {
      if (!quiet) toast.error("Accounts sync সমস্যা: " + firstError.message);
    } else {
      const next: CachePayload = {
        acct: (((a.data as unknown) as Acct[] | null)?.[0] ?? null),
        overview: ((ov.data as unknown) as Acct[]) ?? [],
        handovers: ((h.data as unknown) as Hand[]) ?? [],
        expenses: ((e.data as unknown) as Exp[]) ?? [],
        received: ((r.data as unknown) as Recv[]) ?? [],
      };
      setAcct(next.acct);
      setOverview(next.overview);
      setHandovers(next.handovers);
      setExpenses(next.expenses);
      setReceived(next.received);
      persistCache(next);
    }

    reloadingRef.current = false;
    setSyncing(false);
    if (queuedRef.current) {
      queuedRef.current = false;
      window.setTimeout(() => void reload(true), 250);
    }
  }, [persistCache, user?.id]);

  useEffect(() => {
    void reload(true);
    const ch = supabase.channel("acct_rt_v2")
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_receipts" }, () => void reload(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_handovers" }, () => void reload(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_expenses" }, () => void reload(true))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, reload]);

  const filteredReceived = useMemo(() => received.filter((r) => {
    if (dateFrom && r.entry_date < dateFrom) return false;
    if (dateTo && r.entry_date > dateTo) return false;
    if (serviceFilter !== "all" && r.service_type !== serviceFilter) return false;
    return true;
  }), [dateFrom, dateTo, received, serviceFilter]);

  const runningReceived = useMemo(() => {
    let total = 0;
    return [...filteredReceived].reverse().map((r) => {
      total += Number(r.amount) || 0;
      return { ...r, running: total };
    }).reverse();
  }, [filteredReceived]);

  const filteredTotal = filteredReceived.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const saveHandover = async () => {
    if (!user?.id) return toast.error("লগ-ইন করুন");
    if (hForm.amount <= 0) return toast.error("টাকার পরিমাণ দিন");
    const temp: Hand = { id: `tmp-${Date.now()}`, handover_id: "Saving...", ...hForm, remarks: hForm.remarks || null };
    setHandovers((prev) => [temp, ...prev]);
    setHForm({ ...hForm, amount: 0, remarks: "" });

    const { data: idData, error: idErr } = await supabase.rpc("next_module_id" as never, { _prefix: "HND", _table: "cash_handovers", _column: "handover_id" } as never);
    if (idErr) { toast.error(idErr.message); return void reload(true); }
    const { error } = await supabase.from("cash_handovers").insert({
      handover_id: idData as unknown as string,
      entry_date: hForm.entry_date,
      from_user: user.id,
      from_name: displayName(profile, user),
      to_name: hForm.to_name,
      amount: Number(hForm.amount) || 0,
      method: hForm.method,
      remarks: hForm.remarks || null,
      created_by: user.id,
    });
    if (error) toast.error(error.message); else toast.success("✓ Hand-over এন্ট্রি হয়েছে");
    void reload(true);
  };

  const saveExpense = async () => {
    if (!user?.id) return toast.error("লগ-ইন করুন");
    if (eForm.amount <= 0) return toast.error("টাকার পরিমাণ দিন");
    const temp: Exp = { id: `tmp-${Date.now()}`, expense_id: "Saving...", ...eForm, purpose: eForm.purpose || null, remarks: eForm.remarks || null };
    setExpenses((prev) => [temp, ...prev]);
    setEForm({ ...eForm, amount: 0, purpose: "", remarks: "" });

    const { data: idData, error: idErr } = await supabase.rpc("next_module_id" as never, { _prefix: "EXP", _table: "cash_expenses", _column: "expense_id" } as never);
    if (idErr) { toast.error(idErr.message); return void reload(true); }
    const { error } = await supabase.from("cash_expenses").insert({
      expense_id: idData as unknown as string,
      entry_date: eForm.entry_date,
      spent_by: user.id,
      spent_by_name: displayName(profile, user),
      category: eForm.category,
      purpose: eForm.purpose || null,
      amount: Number(eForm.amount) || 0,
      remarks: eForm.remarks || null,
      created_by: user.id,
    });
    if (error) toast.error(error.message); else toast.success("✓ খরচ এন্ট্রি হয়েছে");
    void reload(true);
  };

  const saveManualReceipt = async () => {
    if (!user?.id) return toast.error("লগ-ইন করুন");
    if (!rForm.passenger_name.trim()) return toast.error("Passenger name দিন");
    if (rForm.amount <= 0) return toast.error("Received amount দিন");
    const temp: Recv = {
      id: `tmp-${Date.now()}`,
      receipt_id: "Saving...",
      entry_date: rForm.entry_date,
      service_type: rForm.service_type,
      ref_id: rForm.ref_id || null,
      passenger_name: rForm.passenger_name,
      amount: rForm.amount,
      method: rForm.method,
      source: "manual",
      remarks: rForm.remarks || null,
      received_by_name: displayName(profile, user),
    };
    setReceived((prev) => [temp, ...prev]);
    setRForm({ ...rForm, ref_id: "", passenger_name: "", amount: 0, remarks: "" });

    const { data: idData, error: idErr } = await supabase.rpc("next_module_id" as never, { _prefix: "RCV", _table: "payment_receipts", _column: "receipt_id" } as never);
    if (idErr) { toast.error(idErr.message); return void reload(true); }
    const { error } = await supabase.from("payment_receipts").insert({
      receipt_id: idData as unknown as string,
      entry_date: rForm.entry_date,
      service_type: rForm.service_type,
      ref_id: rForm.ref_id || null,
      passenger_name: rForm.passenger_name.trim(),
      received_by: user.id,
      received_by_name: displayName(profile, user),
      amount: Number(rForm.amount) || 0,
      method: rForm.method,
      source: "manual",
      remarks: rForm.remarks || null,
      created_by: user.id,
    });
    if (error) toast.error(error.message); else toast.success("✓ Received entry হয়েছে");
    void reload(true);
  };

  const delHand = async (id: string) => {
    if (id.startsWith("tmp-") || !confirm("Delete?")) return;
    const { error } = await supabase.from("cash_handovers").delete().eq("id", id);
    if (error) toast.error(error.message); else void reload(true);
  };
  const delExp = async (id: string) => {
    if (id.startsWith("tmp-") || !confirm("Delete?")) return;
    const { error } = await supabase.from("cash_expenses").delete().eq("id", id);
    if (error) toast.error(error.message); else void reload(true);
  };
  const delReceipt = async (r: Recv) => {
    if (r.id.startsWith("tmp-")) return;
    if (r.source !== "manual") return toast.error("Service form থেকে আসা entry service page থেকে edit করুন");
    if (!confirm("Delete received entry?")) return;
    const { error } = await supabase.from("payment_receipts").delete().eq("id", r.id);
    if (error) toast.error(error.message); else void reload(true);
  };

  const exportCsv = () => {
    const header = ["Date", "Receipt ID", "Service", "Ref ID", "Passenger", "Method", "Amount", "Running Total", "Source"];
    const lines = runningReceived.map((r) => [r.entry_date, r.receipt_id, r.service_type, r.ref_id ?? "", r.passenger_name, r.method, r.amount, r.running, r.source]);
    const csv = [header, ...lines].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `received-ledger-${dateFrom}-to-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Wallet className="h-6 w-6" /> আমার Accounts</h1>
            <p className="text-sm text-muted-foreground mt-1">{acct?.full_name ?? displayName(profile, user)} — local cache + background sync</p>
          </div>
          <Button variant="outline" onClick={() => void reload(false)} disabled={syncing} className="gap-1.5">
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} /> Sync
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="মোট Received" value={acct?.total_received ?? 0} icon={<ArrowDownLeft className="h-4 w-4" />} />
        <Stat label="আজকের Received" value={acct?.total_received_today ?? 0} icon={<Receipt className="h-4 w-4" />} />
        <Stat label="Hand Over" value={acct?.total_handed_over ?? 0} icon={<ArrowUpRight className="h-4 w-4" />} />
        <Stat label="Current Balance" value={acct?.current_balance ?? 0} icon={<Wallet className="h-4 w-4" />} highlight />
      </div>

      {overview.length > 1 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">All Staff Accounts Overview</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>Staff</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Hand-over</TableHead><TableHead className="text-right">Expense</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
                <TableBody>{overview.map((o) => (
                  <TableRow key={o.user_id}>
                    <TableCell className="font-medium whitespace-nowrap">{o.full_name}</TableCell>
                    <MoneyCell value={o.total_received} tone="success" />
                    <MoneyCell value={o.total_handed_over} tone="warning" />
                    <MoneyCell value={o.total_expenses} tone="destructive" />
                    <MoneyCell value={o.current_balance} tone="primary" />
                  </TableRow>
                ))}</TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="received" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="received">Received</TabsTrigger>
          <TabsTrigger value="add">Add</TabsTrigger>
          <TabsTrigger value="handover">Hand-over</TabsTrigger>
          <TabsTrigger value="expense">Expense</TabsTrigger>
        </TabsList>

        <TabsContent value="received" className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Received Ledger ({filteredReceived.length}) — Total ৳ {filteredTotal.toLocaleString()}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <div><Label>From</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
                <div><Label>To</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
                <div className="col-span-2 md:col-span-2"><Label>Service</Label><Select value={serviceFilter} onValueChange={setServiceFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Service</SelectItem>{SERVICES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
                <div className="col-span-2 md:col-span-1 flex items-end"><Button variant="outline" onClick={exportCsv} className="w-full gap-1.5"><Download className="h-4 w-4" /> Export</Button></div>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Receipt</TableHead><TableHead>Service</TableHead><TableHead>Ref</TableHead><TableHead>Passenger</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Running</TableHead><TableHead></TableHead></TableRow></TableHeader>
                  <TableBody>
                    {runningReceived.length === 0 ? <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground">Service page-এ Received Amount দিলে এখানে auto আসবে; partial হলে Add tab থেকে manual entry দিন</TableCell></TableRow>
                      : runningReceived.map((r) => (
                        <TableRow key={`${r.source}-${r.id}`}>
                          <TableCell className="whitespace-nowrap">{formatDate(r.entry_date)}</TableCell>
                          <TableCell className="font-mono text-xs whitespace-nowrap">{r.receipt_id}</TableCell>
                          <TableCell><Badge variant="secondary">{r.service_type}</Badge></TableCell>
                          <TableCell className="font-mono text-xs whitespace-nowrap">{r.ref_id ?? "—"}</TableCell>
                          <TableCell className="font-medium min-w-36">{r.passenger_name}</TableCell>
                          <TableCell><Badge variant="outline">{r.method}</Badge></TableCell>
                          <MoneyCell value={r.amount} tone="success" />
                          <MoneyCell value={r.running} tone="primary" />
                          <TableCell>{r.source === "manual" && <Button variant="ghost" size="icon" onClick={() => void delReceipt(r)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="add">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" /> Partial / Manual Received Entry</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
                <div><Label>Date</Label><Input type="date" value={rForm.entry_date} onChange={(e) => setRForm({ ...rForm, entry_date: e.target.value })} /></div>
                <div><Label>Service</Label><Select value={rForm.service_type} onValueChange={(v) => setRForm({ ...rForm, service_type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SERVICES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
                <div><Label>Ref ID</Label><Input value={rForm.ref_id} onChange={(e) => setRForm({ ...rForm, ref_id: e.target.value })} placeholder="optional" /></div>
                <div className="col-span-2"><Label>Passenger</Label><Input value={rForm.passenger_name} onChange={(e) => setRForm({ ...rForm, passenger_name: e.target.value })} placeholder="Passenger name" /></div>
                <div><Label>Amount</Label><Input type="number" inputMode="decimal" value={rForm.amount === 0 ? "" : rForm.amount} placeholder="0" onChange={(e) => setRForm({ ...rForm, amount: Number(e.target.value) || 0 })} /></div>
                <div><Label>Method</Label><Select value={rForm.method} onValueChange={(v) => setRForm({ ...rForm, method: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></div>
                <div className="col-span-2 lg:col-span-5"><Label>Remarks</Label><Input value={rForm.remarks} onChange={(e) => setRForm({ ...rForm, remarks: e.target.value })} /></div>
              </div>
              <Button onClick={saveManualReceipt} className="w-full gap-1.5"><Plus className="h-4 w-4" /> Received সেভ</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="handover" className="space-y-4">
          <EntryCard title="কর্তৃপক্ষকে Cash Hand-over" icon={<ArrowUpRight className="h-4 w-4" />}>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <div><Label>Date</Label><Input type="date" value={hForm.entry_date} onChange={(e) => setHForm({ ...hForm, entry_date: e.target.value })} /></div>
              <div><Label>To</Label><Input value={hForm.to_name} onChange={(e) => setHForm({ ...hForm, to_name: e.target.value })} placeholder="MD Sir" /></div>
              <div><Label>Amount (৳)</Label><Input type="number" inputMode="decimal" value={hForm.amount === 0 ? "" : hForm.amount} placeholder="0" onChange={(e) => setHForm({ ...hForm, amount: Number(e.target.value) || 0 })} /></div>
              <div><Label>Method</Label><Select value={hForm.method} onValueChange={(v) => setHForm({ ...hForm, method: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div><Label>Remarks</Label><Textarea rows={2} value={hForm.remarks} onChange={(e) => setHForm({ ...hForm, remarks: e.target.value })} /></div>
            <Button onClick={saveHandover} className="w-full gap-1.5"><Plus className="h-4 w-4" /> Hand-over সেভ</Button>
          </EntryCard>
          <HistoryTable kind="handover" handovers={handovers} onDelete={delHand} />
        </TabsContent>

        <TabsContent value="expense" className="space-y-4">
          <EntryCard title="খরচ এন্ট্রি" icon={<Receipt className="h-4 w-4" />}>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <div><Label>Date</Label><Input type="date" value={eForm.entry_date} onChange={(e) => setEForm({ ...eForm, entry_date: e.target.value })} /></div>
              <div><Label>Category</Label><Select value={eForm.category} onValueChange={(v) => setEForm({ ...eForm, category: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
              <div className="col-span-2"><Label>Purpose</Label><Input value={eForm.purpose} onChange={(e) => setEForm({ ...eForm, purpose: e.target.value })} placeholder="কিসের খরচ?" /></div>
              <div><Label>Amount (৳)</Label><Input type="number" inputMode="decimal" value={eForm.amount === 0 ? "" : eForm.amount} placeholder="0" onChange={(e) => setEForm({ ...eForm, amount: Number(e.target.value) || 0 })} /></div>
            </div>
            <div><Label>Remarks</Label><Textarea rows={2} value={eForm.remarks} onChange={(e) => setEForm({ ...eForm, remarks: e.target.value })} /></div>
            <Button onClick={saveExpense} className="w-full gap-1.5"><Plus className="h-4 w-4" /> খরচ সেভ</Button>
          </EntryCard>
          <HistoryTable kind="expense" expenses={expenses} onDelete={delExp} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value, icon, highlight }: { label: string; value: number; icon: ReactNode; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border bg-card p-4 shadow-sm ${highlight ? "ring-2 ring-primary/30" : ""}`}>
      <div className="flex items-center justify-between gap-2 text-muted-foreground">
        <p className="text-[11px] uppercase tracking-wide">{label}</p>
        {icon}
      </div>
      <p className="text-xl sm:text-2xl font-bold mt-1 tabular-nums">৳ {Number(value).toLocaleString()}</p>
    </div>
  );
}

function MoneyCell({ value, tone }: { value: number; tone: "success" | "warning" | "destructive" | "primary" }) {
  const toneClass = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "destructive" ? "text-destructive" : "text-primary";
  return <TableCell className={`text-right tabular-nums font-semibold whitespace-nowrap ${toneClass}`}>৳ {Number(value).toLocaleString()}</TableCell>;
}

function EntryCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <Card><CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2">{icon}{title}</CardTitle></CardHeader><CardContent className="space-y-3">{children}</CardContent></Card>;
}

function HistoryTable(props: { kind: "handover"; handovers: Hand[]; onDelete: (id: string) => void } | { kind: "expense"; expenses: Exp[]; onDelete: (id: string) => void }) {
  const isHand = props.kind === "handover";
  const rows = isHand ? props.handovers : props.expenses;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{isHand ? "Hand-over" : "Expense"} History ({rows.length})</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>ID</TableHead><TableHead>{isHand ? "To" : "Category"}</TableHead><TableHead>{isHand ? "Method" : "Purpose"}</TableHead><TableHead className="text-right">Amount</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">কোনো এন্ট্রি নেই</TableCell></TableRow>
                : rows.map((row) => {
                  const id = isHand ? (row as Hand).handover_id : (row as Exp).expense_id;
                  const label = isHand ? (row as Hand).to_name : (row as Exp).category;
                  const desc = isHand ? (row as Hand).method : ((row as Exp).purpose ?? "—");
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(row.entry_date)}</TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{id}</TableCell>
                      <TableCell><Badge variant="secondary">{label}</Badge></TableCell>
                      <TableCell className="text-xs min-w-28">{desc}</TableCell>
                      <MoneyCell value={Number(row.amount)} tone={isHand ? "warning" : "destructive"} />
                      <TableCell><Button variant="ghost" size="icon" onClick={() => props.onDelete(row.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button></TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
