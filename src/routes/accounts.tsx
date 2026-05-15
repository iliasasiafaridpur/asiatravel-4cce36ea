import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { toast } from "sonner";
import { formatDate } from "@/lib/modules";
import {
  Wallet, ArrowDownLeft, ArrowUpRight, Receipt, Plus, RefreshCw, Send, Banknote,
  CalendarDays, TrendingUp, TrendingDown, Layers, Printer, RotateCcw, Tag, MessageSquare,
} from "lucide-react";

export const Route = createFileRoute("/accounts")({
  head: () => ({ meta: [{ title: "আমার হিসাব — My Accounts" }] }),
  component: AccountsPage,
});

const METHODS = ["Hand Cash", "Cash", "Bank", "bKash", "Nagad", "Other"];
const EXPENSE_CATEGORIES = ["Office", "Transport", "Food", "Stationery", "Bill", "Other"];
const RECEIVERS = ["MD Sir", "Office", "Bank Deposit", "Other"];

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${new Date().toISOString().slice(0, 8)}01`;
const yearStart = () => `${new Date().getFullYear()}-01-01`;

type Preset = "today" | "month" | "year" | "all";
function presetRange(p: Preset): { from: string; to: string } {
  if (p === "today") { const d = today(); return { from: d, to: d }; }
  if (p === "month") return { from: monthStart(), to: today() };
  if (p === "year") return { from: yearStart(), to: today() };
  return { from: "1970-01-01", to: "2999-12-31" };
}

interface Acct {
  user_id: string; full_name: string;
  total_received: number; total_received_today?: number;
  total_handed_over: number; total_expenses: number; current_balance: number;
}
interface Hand { id: string; handover_id: string; entry_date: string; to_name: string; amount: number; method: string; remarks: string | null; from_user: string | null; }
interface Exp  { id: string; expense_id: string; entry_date: string; category: string; purpose: string | null; amount: number; remarks: string | null; spent_by: string | null; }
interface Recv { id: string; receipt_id: string; entry_date: string; service_type: string; service_table: string | null; service_row_id: string | null; ref_id: string | null; passenger_name: string; amount: number; method: string; source: string; remarks: string | null; received_by: string | null; }

const fmt = (n: number) => `৳ ${(n || 0).toLocaleString()}`;

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: React.ComponentType<{ className?: string }>; tone: "primary" | "success" | "warning" | "info" }) {
  const toneMap = {
    primary: "from-primary/15 to-primary/5 text-primary border-primary/20",
    success: "from-emerald-500/15 to-emerald-500/5 text-emerald-600 border-emerald-500/20",
    warning: "from-amber-500/15 to-amber-500/5 text-amber-600 border-amber-500/20",
    info:    "from-sky-500/15 to-sky-500/5 text-sky-600 border-sky-500/20",
  };
  return (
    <div className={`rounded-xl border bg-gradient-to-br ${toneMap[tone]} p-3 sm:p-4 transition-all hover:shadow-md`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] sm:text-xs font-medium opacity-80">{label}</span>
        <Icon className="h-4 w-4 opacity-70" />
      </div>
      <div className="text-lg sm:text-2xl font-bold tabular-nums tracking-tight">{fmt(value)}</div>
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="text-center py-12 text-muted-foreground text-sm">{children}</div>;
}

function AccountsPage() {
  const { user, profile } = useCurrentUser();
  const [acct, setAcct] = useState<Acct | null>(null);
  const [received, setReceived] = useState<Recv[]>([]);
  const [handovers, setHandovers] = useState<Hand[]>([]);
  const [expenses, setExpenses] = useState<Exp[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [preset, setPreset] = useState<Preset>("month");
  const [sinceZero, setSinceZero] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const reloadingRef = useRef(false);

  // Dialog forms
  const [handOpen, setHandOpen] = useState(false);
  const [expOpen, setExpOpen] = useState(false);
  const [hForm, setHForm] = useState({ entry_date: today(), to_name: "MD Sir", amount: "", method: "Hand Cash", remarks: "" });
  const [eForm, setEForm] = useState({ entry_date: today(), category: "Office", purpose: "", amount: "", remarks: "" });

  const reload = useCallback(async (quiet = false) => {
    if (!user?.id) return;
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    if (!quiet) setSyncing(true);

    const [a, r, h, e] = await Promise.all([
      supabase.rpc("get_user_account" as never, { _user_id: user.id } as never),
      supabase.from("payment_receipts").select("id,receipt_id,entry_date,service_type,service_table,service_row_id,ref_id,passenger_name,amount,method,source,remarks,received_by").eq("received_by", user.id).order("entry_date", { ascending: false }).limit(500),
      supabase.from("cash_handovers").select("id,handover_id,entry_date,to_name,amount,method,remarks,from_user").eq("from_user", user.id).order("entry_date", { ascending: false }).limit(500),
      supabase.from("cash_expenses").select("id,expense_id,entry_date,category,purpose,amount,remarks,spent_by").eq("spent_by", user.id).order("entry_date", { ascending: false }).limit(500),
    ]);

    const err = a.error || r.error || h.error || e.error;
    if (err) {
      if (!quiet) toast.error("সিঙ্ক সমস্যা: " + err.message);
    } else {
      setAcct((((a.data as unknown) as Acct[] | null)?.[0]) ?? null);
      setReceived(((r.data as unknown) as Recv[]) ?? []);
      setHandovers(((h.data as unknown) as Hand[]) ?? []);
      setExpenses(((e.data as unknown) as Exp[]) ?? []);
    }

    reloadingRef.current = false;
    setSyncing(false);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    void reload(true);
    const ch = supabase.channel("my_acct_v1")
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_receipts" }, () => void reload(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_handovers" }, () => void reload(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_expenses" }, () => void reload(true))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, reload]);

  // Period filter
  const range = useMemo(() => presetRange(preset), [preset]);
  const inRange = useCallback((d: string) => d >= range.from && d <= range.to, [range]);

  // Service detail map (for timeline secondary text & due display)
  type SvcDetail = {
    country?: string | null; route?: string | null; airline?: string | null;
    flight_date?: string | null; vendor?: string | null; cost?: number;
    sold?: number; received_total?: number;
  };
  const [svcMap, setSvcMap] = useState<Record<string, SvcDetail>>({});

  useEffect(() => {
    const byTable: Record<string, Set<string>> = {};
    for (const r of received) {
      if (!r.service_row_id || !r.service_table) continue;
      (byTable[r.service_table] ||= new Set()).add(r.service_row_id);
    }
    const tableConfigs: Record<string, { cols: string; map: (row: Record<string, unknown>) => SvcDetail }> = {
      tickets: {
        cols: "id,airline,trip_road,flight_date,vendor_bought,sold_price,cost_price,received",
        map: (r) => ({ airline: r.airline as string, route: r.trip_road as string, flight_date: r.flight_date as string, vendor: r.vendor_bought as string, cost: Number(r.cost_price ?? 0), sold: Number(r.sold_price ?? 0), received_total: Number(r.received ?? 0) }),
      },
      bmet_cards: {
        cols: "id,country_name,vendor_bought,sold_price,cost_price,received_amount",
        map: (r) => ({ country: r.country_name as string, vendor: r.vendor_bought as string, cost: Number(r.cost_price ?? 0), sold: Number(r.sold_price ?? 0), received_total: Number(r.received_amount ?? 0) }),
      },
      saudi_visas: {
        cols: "id,vendor_bought,sold_price,cost_price,received_amount",
        map: (r) => ({ country: "Saudi Arabia", vendor: r.vendor_bought as string, cost: Number(r.cost_price ?? 0), sold: Number(r.sold_price ?? 0), received_total: Number(r.received_amount ?? 0) }),
      },
      kuwait_visas: {
        cols: "id,vendor_bought,sold_price,cost_price,received",
        map: (r) => ({ country: "Kuwait", vendor: r.vendor_bought as string, cost: Number(r.cost_price ?? 0), sold: Number(r.sold_price ?? 0), received_total: Number(r.received ?? 0) }),
      },
    };
    let cancelled = false;
    (async () => {
      const out: Record<string, SvcDetail> = {};
      await Promise.all(Object.entries(byTable).map(async ([table, ids]) => {
        const cfg = tableConfigs[table]; if (!cfg || ids.size === 0) return;
        const { data } = await supabase.from(table as never).select(cfg.cols).in("id", Array.from(ids));
        for (const row of (data as unknown as Record<string, unknown>[] | null) ?? []) {
          out[String(row.id)] = cfg.map(row);
        }
      }));
      if (!cancelled) setSvcMap(out);
    })();
    return () => { cancelled = true; };
  }, [received]);

  const fRecv = useMemo(() => received.filter((r) => inRange(r.entry_date)), [received, inRange]);
  const fHand = useMemo(() => handovers.filter((h) => inRange(h.entry_date)), [handovers, inRange]);
  const fExp  = useMemo(() => expenses.filter((e) => inRange(e.entry_date)), [expenses, inRange]);

  const periodIncome = fRecv.reduce((s, r) => s + Number(r.amount || 0), 0);
  const periodHand   = fHand.reduce((s, h) => s + Number(h.amount || 0), 0);
  const periodExp    = fExp.reduce((s, e) => s + Number(e.amount || 0), 0);

  // Build full chronological timeline (all data) with running balance from 0
  type TLItem =
    | { kind: "received"; date: string; row: Recv }
    | { kind: "handover"; date: string; row: Hand }
    | { kind: "expense";  date: string; row: Exp };

  const fullAsc = useMemo<(TLItem & { running: number; created: string })[]>(() => {
    const items: (TLItem & { created: string })[] = [
      ...received.map((r) => ({ kind: "received" as const, date: r.entry_date, row: r, created: (r as Recv & { created_at?: string }).created_at ?? r.entry_date })),
      ...handovers.map((h) => ({ kind: "handover" as const, date: h.entry_date, row: h, created: (h as Hand & { created_at?: string }).created_at ?? h.entry_date })),
      ...expenses.map((e) => ({ kind: "expense"  as const, date: e.entry_date, row: e, created: (e as Exp & { created_at?: string }).created_at ?? e.entry_date })),
    ];
    items.sort((a, b) => (a.date === b.date ? a.created.localeCompare(b.created) : a.date.localeCompare(b.date)));
    let bal = 0;
    return items.map((it) => {
      if (it.kind === "received") bal += Number(it.row.amount);
      else bal -= Number(it.row.amount);
      return { ...it, running: bal };
    });
  }, [received, handovers, expenses]);

  // Find last index where running balance was 0 (cycle start)
  const lastZeroIdx = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < fullAsc.length; i++) {
      if (Math.abs(fullAsc[i].running) < 0.005) idx = i;
    }
    return idx;
  }, [fullAsc]);

  const timeline = useMemo<(TLItem & { running: number })[]>(() => {
    const slice = sinceZero
      ? fullAsc.slice(lastZeroIdx + 1)
      : fullAsc.filter((it) => inRange(it.date));
    return [...slice].reverse();
  }, [fullAsc, sinceZero, lastZeroIdx, inRange]);

  // Save handover
  const saveHandover = async () => {
    if (!user?.id) return toast.error("লগ-ইন করুন");
    const amt = Number(hForm.amount);
    if (!amt || amt <= 0) return toast.error("সঠিক টাকার পরিমাণ দিন");
    const { data: idData, error: idErr } = await supabase.rpc("next_module_id" as never, { _prefix: "HND", _table: "cash_handovers", _column: "handover_id" } as never);
    if (idErr) return toast.error(idErr.message);
    const { error } = await supabase.from("cash_handovers").insert({
      handover_id: idData as unknown as string,
      entry_date: hForm.entry_date,
      from_user: user.id,
      from_name: displayName(profile, user),
      to_name: hForm.to_name,
      amount: amt,
      method: hForm.method,
      remarks: hForm.remarks || null,
      created_by: user.id,
    });
    if (error) return toast.error(error.message);
    toast.success("✓ জমা সংরক্ষিত");
    setHForm({ entry_date: today(), to_name: "MD Sir", amount: "", method: "Hand Cash", remarks: "" });
    setHandOpen(false);
    void reload(true);
  };

  // Save expense
  const saveExpense = async () => {
    if (!user?.id) return toast.error("লগ-ইন করুন");
    const amt = Number(eForm.amount);
    if (!amt || amt <= 0) return toast.error("সঠিক টাকার পরিমাণ দিন");
    const { data: idData, error: idErr } = await supabase.rpc("next_module_id" as never, { _prefix: "EXP", _table: "cash_expenses", _column: "expense_id" } as never);
    if (idErr) return toast.error(idErr.message);
    const { error } = await supabase.from("cash_expenses").insert({
      expense_id: idData as unknown as string,
      entry_date: eForm.entry_date,
      spent_by: user.id,
      spent_by_name: displayName(profile, user),
      category: eForm.category,
      purpose: eForm.purpose || null,
      amount: amt,
      remarks: eForm.remarks || null,
      created_by: user.id,
    });
    if (error) return toast.error(error.message);
    toast.success("✓ খরচ সংরক্ষিত");
    setEForm({ entry_date: today(), category: "Office", purpose: "", amount: "", remarks: "" });
    setExpOpen(false);
    void reload(true);
  };

  const deleteHand = async (id: string): Promise<void> => {
    const { error } = await supabase.from("cash_handovers").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("ডিলেট সম্পন্ন");
    void reload(true);
  };
  const deleteExp = async (id: string): Promise<void> => {
    const { error } = await supabase.from("cash_expenses").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("ডিলেট সম্পন্ন");
    void reload(true);
  };

  const balance = acct?.current_balance ?? (periodIncome - periodHand - periodExp);

  // Print timeline
  const handlePrint = () => {
    const node = printRef.current;
    if (!node) return;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) { toast.error("পপ-আপ ব্লক হয়েছে"); return; }
    const periodLabel = sinceZero
      ? "০ ব্যালেন্স থেকে এখন পর্যন্ত"
      : preset === "today" ? "আজ" : preset === "month" ? "এই মাস" : preset === "year" ? "এই বছর" : "সব সময়";
    const totals = timeline.reduce(
      (acc, it) => {
        const amt = Number((it.row as { amount: number }).amount || 0);
        if (it.kind === "received") acc.inAmt += amt; else acc.outAmt += amt;
        return acc;
      },
      { inAmt: 0, outAmt: 0 },
    );
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>আজকের হিসাব- এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্</title>
<style>
  body{font-family:'Noto Sans Bengali',system-ui,sans-serif;padding:24px;color:#111}
  h1{margin:0 0 4px;font-size:20px}
  .meta{color:#555;font-size:12px;margin-bottom:14px}
  .summary{display:flex;gap:12px;margin-bottom:14px;font-size:14px;font-weight:700}
  .summary div{padding:8px 12px;border:1px solid #ddd;border-radius:6px;flex:1}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border-bottom:1px solid #e5e5e5;padding:6px 8px;text-align:left;vertical-align:top;white-space:nowrap}
  td.wrap,th.wrap{white-space:normal}
  th{background:#f5f5f5;font-weight:600}
  td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .in{color:#059669}.out{color:#b45309}.hand{color:#0284c7}
  tfoot td{font-weight:700;background:#fafafa}
  @media print{body{padding:8px}}
</style></head><body>
<h1>আজকের হিসাব- এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্</h1>
<div class="meta">${displayName(profile, user)} · ${formatDate(today())} · সময়: ${periodLabel} · মোট ${timeline.length} এন্ট্রি</div>
<div class="summary">
  <div>হাতে আছে: <b>${fmt(balance)}</b></div>
  <div class="in">আয়: <b>+ ${fmt(totals.inAmt)}</b></div>
  <div class="out">খরচ/জমা: <b>− ${fmt(totals.outAmt)}</b></div>
</div>
${node.innerHTML}
<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script>
</body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto pb-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Wallet className="h-6 w-6 text-primary" />
            আমার হিসাব
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" />
            {formatDate(today())} · {displayName(profile, user)}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void reload(false)} disabled={syncing} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Sync</span>
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        <StatCard label="হাতে আছে" value={balance} icon={Wallet} tone="primary" />
        <StatCard label="মোট আয়" value={acct?.total_received ?? 0} icon={TrendingUp} tone="success" />
        <StatCard label="মোট জমা" value={acct?.total_handed_over ?? 0} icon={Send} tone="info" />
        <StatCard label="মোট খরচ" value={acct?.total_expenses ?? 0} icon={TrendingDown} tone="warning" />
      </div>

      {/* Action Bar */}
      <Card className="overflow-hidden">
        <CardContent className="p-3 flex flex-wrap items-center gap-2 justify-between">
          <div className="flex flex-wrap gap-1.5 items-center">
            {(["today", "month", "year", "all"] as Preset[]).map((p) => (
              <Button key={p} size="sm" variant={!sinceZero && preset === p ? "default" : "outline"} onClick={() => { setSinceZero(false); setPreset(p); }} className="h-8 text-xs">
                {p === "today" ? "আজ" : p === "month" ? "এই মাস" : p === "year" ? "এই বছর" : "সব"}
              </Button>
            ))}
            <Button
              size="sm"
              variant={sinceZero ? "default" : "outline"}
              onClick={() => setSinceZero((v) => !v)}
              className="h-8 text-xs gap-1"
              title="হাতে ০ ব্যালেন্স হওয়ার পর থেকে এখন পর্যন্ত"
            >
              <RotateCcw className="h-3.5 w-3.5" /> ০ থেকে এখন
            </Button>
          </div>
          <div className="flex gap-2">
            <Dialog open={handOpen} onOpenChange={setHandOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5 h-9">
                  <Send className="h-4 w-4" /> জমা দিন
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>কতৃপক্ষের কাছে জমা</DialogTitle>
                  <DialogDescription>আজকের আয় থেকে নির্দিষ্ট পরিমাণ জমা দিন।</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">তারিখ</Label>
                      <Input type="date" value={hForm.entry_date} onChange={(e) => setHForm({ ...hForm, entry_date: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">প্রাপক</Label>
                      <Select value={hForm.to_name} onValueChange={(v) => setHForm({ ...hForm, to_name: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{RECEIVERS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">পরিমাণ (৳)</Label>
                      <Input type="number" inputMode="numeric" placeholder="0" value={hForm.amount} onChange={(e) => setHForm({ ...hForm, amount: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">মাধ্যম</Label>
                      <Select value={hForm.method} onValueChange={(v) => setHForm({ ...hForm, method: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">মন্তব্য</Label>
                    <Textarea rows={2} placeholder="ঐচ্ছিক" value={hForm.remarks} onChange={(e) => setHForm({ ...hForm, remarks: e.target.value })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={saveHandover} className="gap-1.5"><Plus className="h-4 w-4" />সংরক্ষণ</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={expOpen} onOpenChange={setExpOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="secondary" className="gap-1.5 h-9">
                  <Receipt className="h-4 w-4" /> খরচ যোগ
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>নতুন খরচ যোগ করুন</DialogTitle>
                  <DialogDescription>অফিস বা পরিচালনা সংক্রান্ত খরচ লিপিবদ্ধ করুন।</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">তারিখ</Label>
                      <Input type="date" value={eForm.entry_date} onChange={(e) => setEForm({ ...eForm, entry_date: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">ক্যাটাগরি</Label>
                      <Select value={eForm.category} onValueChange={(v) => setEForm({ ...eForm, category: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">উদ্দেশ্য</Label>
                    <Input placeholder="যেমন: চা-নাস্তা, স্ট্যাম্প" value={eForm.purpose} onChange={(e) => setEForm({ ...eForm, purpose: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">পরিমাণ (৳)</Label>
                    <Input type="number" inputMode="numeric" placeholder="0" value={eForm.amount} onChange={(e) => setEForm({ ...eForm, amount: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-xs">মন্তব্য</Label>
                    <Textarea rows={2} placeholder="ঐচ্ছিক" value={eForm.remarks} onChange={(e) => setEForm({ ...eForm, remarks: e.target.value })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={saveExpense} className="gap-1.5"><Plus className="h-4 w-4" />সংরক্ষণ</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      {/* Period summary strip */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border bg-card p-2.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">আয়</p>
          <p className="text-base sm:text-lg font-bold text-emerald-600 tabular-nums">{fmt(periodIncome)}</p>
        </div>
        <div className="rounded-lg border bg-card p-2.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">জমা</p>
          <p className="text-base sm:text-lg font-bold text-sky-600 tabular-nums">{fmt(periodHand)}</p>
        </div>
        <div className="rounded-lg border bg-card p-2.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">খরচ</p>
          <p className="text-base sm:text-lg font-bold text-amber-600 tabular-nums">{fmt(periodExp)}</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="timeline" className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-9">
          <TabsTrigger value="timeline" className="text-xs gap-1"><Layers className="h-3.5 w-3.5" />Timeline</TabsTrigger>
          <TabsTrigger value="income"   className="text-xs gap-1"><ArrowDownLeft className="h-3.5 w-3.5" />আয়</TabsTrigger>
          <TabsTrigger value="expense"  className="text-xs gap-1"><Receipt className="h-3.5 w-3.5" />খরচ</TabsTrigger>
          <TabsTrigger value="handover" className="text-xs gap-1"><ArrowUpRight className="h-3.5 w-3.5" />জমা</TabsTrigger>
        </TabsList>

        {/* Timeline */}
        <TabsContent value="timeline" className="mt-3 space-y-3">
          {/* Timeline header strip with count + print */}
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="text-xs text-muted-foreground">
              {sinceZero ? <span className="text-primary font-medium">০ ব্যালেন্স থেকে এখন পর্যন্ত</span> : "বর্তমান ফিল্টার"} · মোট <b className="text-foreground">{timeline.length}</b> এন্ট্রি
              {sinceZero && lastZeroIdx >= 0 && fullAsc[lastZeroIdx] && (
                <span> · শুরু: {formatDate(fullAsc[lastZeroIdx].date)}</span>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={handlePrint} disabled={timeline.length === 0} className="h-8 text-xs gap-1.5">
              <Printer className="h-3.5 w-3.5" /> প্রিন্ট
            </Button>
          </div>

          <Card><CardContent className="p-0">
            {loading ? <EmptyRow>লোড হচ্ছে...</EmptyRow>
              : timeline.length === 0 ? <EmptyRow>এই সময়সীমার মধ্যে কোনো এন্ট্রি নেই</EmptyRow>
              : <div className="divide-y">
                {timeline.map((it) => {
                  const isIn = it.kind === "received";
                  const isHand = it.kind === "handover";
                  const r = it.row as Recv; const h = it.row as Hand; const e = it.row as Exp;
                  const amt = Number(isIn ? r.amount : isHand ? h.amount : e.amount);
                  const tone = isIn ? "text-emerald-600" : isHand ? "text-sky-600" : "text-amber-600";
                  const bgTone = isIn ? "bg-emerald-500/10 border-emerald-500/20" : isHand ? "bg-sky-500/10 border-sky-500/20" : "bg-amber-500/10 border-amber-500/20";
                  const kindLabel = isIn ? "আয়" : isHand ? "জমা" : "ব্যয়";
                   // Col 1: Name
                  const name = isIn
                    ? (r.passenger_name || "—")
                    : isHand
                    ? (h.to_name || "প্রাপক")
                    : (e.purpose || e.category || "খরচ");

                  // Col 2: Service primary + secondary lines
                  const svc = isIn && r.service_row_id ? svcMap[r.service_row_id] : undefined;
                  const servicePrimary = isIn ? (r.service_type || "Service") : isHand ? "জমা / Handover" : (e.category || "খরচ");
                  const primaryBits: string[] = [];
                  if (isIn && svc) {
                    if (r.service_table === "tickets") {
                      if (svc.route) primaryBits.push(svc.route);
                      if (svc.airline) primaryBits.push(svc.airline);
                      if (svc.flight_date) primaryBits.push(`✈ ${formatDate(svc.flight_date)}`);
                    } else if (svc.country) {
                      primaryBits.push(svc.country);
                    }
                  }
                  if (isHand && h.method) primaryBits.push(`💳 ${h.method}`);
                  const dueLeft = isIn && svc && typeof svc.sold === "number" && typeof svc.received_total === "number"
                    ? svc.sold - svc.received_total : null;

                  return (
                    <div key={`${it.kind}-${(it.row as { id: string }).id}`} className="grid grid-cols-[1fr_1.2fr_0.9fr_auto] gap-2 sm:gap-3 p-2.5 sm:p-3 hover:bg-muted/30 transition-colors items-start">
                      {/* Col 1: Name */}
                      <div className="min-w-0">
                        <p className="font-semibold text-[13px] leading-tight break-words">{name}</p>
                        <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1 flex-wrap">
                          <span className={`px-1.5 py-px rounded-full border ${bgTone} ${tone} font-medium`}>{kindLabel}</span>
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-0.5">
                          <CalendarDays className="h-2.5 w-2.5" />{formatDate(it.date)}
                        </p>
                        {isIn && r.ref_id && <p className="text-[10px] text-muted-foreground mt-0.5">Ref: <span className="font-mono">{r.ref_id}</span></p>}
                      </div>

                      {/* Col 2: Service + secondary */}
                      <div className="min-w-0">
                        <p className="font-medium text-[12px] leading-tight break-words">{servicePrimary}</p>
                        {primaryBits.length > 0 && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug break-words">
                            {primaryBits.join(" · ")}
                          </p>
                        )}
                        {dueLeft !== null && dueLeft > 0.005 && (
                          <p className="text-[10px] text-rose-600 mt-0.5 font-medium">
                            বাকি: {fmt(dueLeft)}
                          </p>
                        )}
                        {(isIn ? r.remarks : isHand ? h.remarks : e.remarks) && (
                          <p className="text-[10px] text-muted-foreground/90 mt-1 flex items-start gap-1">
                            <MessageSquare className="h-2.5 w-2.5 mt-0.5 shrink-0" />
                            <span className="break-words">{isIn ? r.remarks : isHand ? h.remarks : e.remarks}</span>
                          </p>
                        )}
                      </div>

                      {/* Col 3: Vendor + cost */}
                      <div className="min-w-0">
                        {isIn && svc?.vendor ? (
                          <>
                            <p className="text-[11px] font-medium leading-tight break-words">{svc.vendor}</p>
                            {typeof svc.cost === "number" && svc.cost > 0 && (
                              <p className="text-[10px] text-muted-foreground tabular-nums mt-0.5">{fmt(svc.cost)}</p>
                            )}
                          </>
                        ) : (
                          <p className="text-[10px] text-muted-foreground/50">—</p>
                        )}
                      </div>

                      {/* Col 4: Amount + Balance */}
                      <div className="text-right shrink-0">
                        <p className={`font-bold tabular-nums whitespace-nowrap text-sm ${tone}`}>
                          {isIn ? "+" : "−"} {fmt(amt)}
                        </p>
                        <p className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap mt-1">
                          ব্যালেন্স
                        </p>
                        <p className="text-[11px] tabular-nums whitespace-nowrap font-semibold text-foreground">
                          {fmt(it.running)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>}
          </CardContent></Card>

          {/* Hidden printable HTML table */}
          <div ref={printRef} className="hidden">
            <table>
              <thead>
                <tr>
                  <th>#</th><th>তারিখ</th><th>ধরন</th>
                  <th>নাম</th><th>সার্ভিস</th><th>দেশ/রোড</th>
                  <th className="num">আয়</th><th className="num">খরচ/জমা</th><th className="num">ব্যালেন্স</th>
                </tr>
              </thead>
              <tbody>
                {[...timeline].reverse().map((it, i) => {
                  const isIn = it.kind === "received";
                  const isHand = it.kind === "handover";
                  const r = it.row as Recv; const h = it.row as Hand; const e = it.row as Exp;
                  const amt = Number(isIn ? r.amount : isHand ? h.amount : e.amount);
                  const name = isIn ? r.passenger_name : isHand ? `জমা → ${h.to_name}` : (e.purpose || e.category);
                  const svc = isIn && r.service_row_id ? svcMap[r.service_row_id] : undefined;
                  const service = isIn ? r.service_type : isHand ? "জমা" : "খরচ";
                  let region = "";
                  if (isIn && svc) {
                    if (r.service_table === "tickets") {
                      region = [svc.route, svc.airline].filter(Boolean).join(" · ");
                    } else if (svc.country) {
                      region = svc.country;
                    }
                  }
                  const cls = isIn ? "in" : isHand ? "hand" : "out";
                  const kindLabel = isIn ? "আয়" : isHand ? "জমা" : "খরচ";
                  return (
                    <tr key={`p-${it.kind}-${(it.row as { id: string }).id}`}>
                      <td>{i + 1}</td>
                      <td>{formatDate(it.date)}</td>
                      <td className={cls}>{kindLabel}</td>
                      <td>{name}</td>
                      <td>{service}</td>
                      <td>{region}</td>
                      <td className="num in">{isIn ? `+ ${fmt(amt)}` : ""}</td>
                      <td className={`num ${isHand ? "hand" : "out"}`}>{!isIn ? `− ${fmt(amt)}` : ""}</td>
                      <td className="num">{fmt(it.running)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Income */}
        <TabsContent value="income" className="mt-3">
          <Card><CardContent className="p-0">
            {fRecv.length === 0 ? <EmptyRow>এই সময়সীমায় কোনো আয় নেই</EmptyRow>
              : <div className="divide-y">
                {fRecv.map((r) => {
                  const svc = r.service_row_id ? svcMap[r.service_row_id] : undefined;
                  const bits: string[] = [];
                  if (svc) {
                    if (r.service_table === "tickets") {
                      if (svc.route) bits.push(svc.route);
                      if (svc.airline) bits.push(svc.airline);
                    } else if (svc.country) {
                      bits.push(svc.country);
                    }
                  }
                  return (
                    <div key={r.id} className="flex items-start gap-3 p-3 hover:bg-muted/30">
                      <div className="shrink-0 h-9 w-9 rounded-full grid place-items-center bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                        <ArrowDownLeft className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="font-semibold text-sm truncate">{r.passenger_name}</p>
                          <p className="font-bold text-emerald-600 tabular-nums text-sm whitespace-nowrap">+ {fmt(Number(r.amount))}</p>
                        </div>
                        <p className="text-[11px] text-muted-foreground break-words">
                          {r.service_type}{bits.length > 0 && <> · {bits.join(" · ")}</>}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>}
          </CardContent></Card>
        </TabsContent>

        {/* Expense */}
        <TabsContent value="expense" className="mt-3">
          <Card><CardContent className="p-0">
            {fExp.length === 0 ? <EmptyRow>এই সময়সীমায় কোনো খরচ নেই</EmptyRow>
              : <div className="divide-y">
                {fExp.map((e) => (
                  <div key={e.id} className="flex items-start gap-3 p-3 hover:bg-muted/30">
                    <div className="shrink-0 h-9 w-9 rounded-full grid place-items-center bg-amber-500/10 text-amber-600 border border-amber-500/20">
                      <Receipt className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-semibold text-sm truncate">{e.purpose || e.category}</p>
                        <p className="font-bold text-amber-600 tabular-nums text-sm whitespace-nowrap">− {fmt(Number(e.amount))}</p>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {e.category} · {formatDate(e.entry_date)} · <span className="font-mono">{e.expense_id}</span>
                      </p>
                      {e.remarks && <p className="text-[11px] text-muted-foreground/80 mt-0.5 truncate">{e.remarks}</p>}
                    </div>
                    <ConfirmDeleteButton onConfirm={() => deleteExp(e.id)} description={`খরচ ${e.expense_id} ডিলেট করতে চান?`} />
                  </div>
                ))}
              </div>}
          </CardContent></Card>
        </TabsContent>

        {/* Handover */}
        <TabsContent value="handover" className="mt-3">
          <Card><CardContent className="p-0">
            {fHand.length === 0 ? <EmptyRow>এই সময়সীমায় কোনো জমা নেই</EmptyRow>
              : <div className="divide-y">
                {fHand.map((h) => (
                  <div key={h.id} className="flex items-start gap-3 p-3 hover:bg-muted/30">
                    <div className="shrink-0 h-9 w-9 rounded-full grid place-items-center bg-sky-500/10 text-sky-600 border border-sky-500/20">
                      <Send className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-semibold text-sm truncate">{h.to_name}</p>
                        <p className="font-bold text-sky-600 tabular-nums text-sm whitespace-nowrap">− {fmt(Number(h.amount))}</p>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                        <Banknote className="h-3 w-3" />{h.method} · {formatDate(h.entry_date)} · <span className="font-mono">{h.handover_id}</span>
                      </p>
                      {h.remarks && <p className="text-[11px] text-muted-foreground/80 mt-0.5 truncate">{h.remarks}</p>}
                    </div>
                    <ConfirmDeleteButton onConfirm={() => deleteHand(h.id)} description={`জমা ${h.handover_id} ডিলেট করতে চান?`} />
                  </div>
                ))}
              </div>}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
