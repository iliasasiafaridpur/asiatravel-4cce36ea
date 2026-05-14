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
interface Recv { id: string; receipt_id: string; entry_date: string; service_type: string; ref_id: string | null; passenger_name: string; amount: number; method: string; source: string; remarks: string | null; received_by: string | null; }

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
      supabase.from("payment_receipts").select("id,receipt_id,entry_date,service_type,ref_id,passenger_name,amount,method,source,remarks,received_by").eq("received_by", user.id).order("entry_date", { ascending: false }).limit(500),
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

  const fRecv = useMemo(() => received.filter((r) => inRange(r.entry_date)), [received, inRange]);
  const fHand = useMemo(() => handovers.filter((h) => inRange(h.entry_date)), [handovers, inRange]);
  const fExp  = useMemo(() => expenses.filter((e) => inRange(e.entry_date)), [expenses, inRange]);

  const periodIncome = fRecv.reduce((s, r) => s + Number(r.amount || 0), 0);
  const periodHand   = fHand.reduce((s, h) => s + Number(h.amount || 0), 0);
  const periodExp    = fExp.reduce((s, e) => s + Number(e.amount || 0), 0);

  // Timeline: merge & sort by date desc, compute running balance asc
  type TLItem =
    | { kind: "received"; date: string; row: Recv }
    | { kind: "handover"; date: string; row: Hand }
    | { kind: "expense";  date: string; row: Exp };

  const timeline = useMemo<(TLItem & { running: number })[]>(() => {
    const items: TLItem[] = [
      ...fRecv.map((r) => ({ kind: "received" as const, date: r.entry_date, row: r })),
      ...fHand.map((h) => ({ kind: "handover" as const, date: h.entry_date, row: h })),
      ...fExp.map((e) => ({ kind: "expense"  as const, date: e.entry_date, row: e })),
    ];
    items.sort((a, b) => a.date.localeCompare(b.date));
    let bal = 0;
    const withRun = items.map((it) => {
      if (it.kind === "received") bal += Number(it.row.amount);
      else bal -= Number(it.row.amount);
      return { ...it, running: bal };
    });
    return withRun.reverse();
  }, [fRecv, fHand, fExp]);

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
          <div className="flex flex-wrap gap-1.5">
            {(["today", "month", "year", "all"] as Preset[]).map((p) => (
              <Button key={p} size="sm" variant={preset === p ? "default" : "outline"} onClick={() => setPreset(p)} className="h-8 text-xs">
                {p === "today" ? "আজ" : p === "month" ? "এই মাস" : p === "year" ? "এই বছর" : "সব"}
              </Button>
            ))}
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
        <TabsContent value="timeline" className="mt-3">
          <Card><CardContent className="p-0">
            {loading ? <EmptyRow>লোড হচ্ছে...</EmptyRow>
              : timeline.length === 0 ? <EmptyRow>এই সময়সীমার মধ্যে কোনো এন্ট্রি নেই</EmptyRow>
              : <div className="divide-y">
                {timeline.map((it) => {
                  const isIn = it.kind === "received";
                  const amt = Number(isIn ? (it.row as Recv).amount : it.kind === "handover" ? (it.row as Hand).amount : (it.row as Exp).amount);
                  const tone = isIn ? "text-emerald-600" : it.kind === "handover" ? "text-sky-600" : "text-amber-600";
                  const Icon = isIn ? ArrowDownLeft : it.kind === "handover" ? Send : Receipt;
                  const title = isIn ? (it.row as Recv).passenger_name : it.kind === "handover" ? `জমা → ${(it.row as Hand).to_name}` : ((it.row as Exp).purpose || (it.row as Exp).category);
                  const sub = isIn ? (it.row as Recv).service_type
                    : it.kind === "handover" ? (it.row as Hand).method
                    : (it.row as Exp).category;
                  const refId = isIn ? (it.row as Recv).receipt_id
                    : it.kind === "handover" ? (it.row as Hand).handover_id
                    : (it.row as Exp).expense_id;
                  return (
                    <div key={`${it.kind}-${(it.row as { id: string }).id}`} className="flex items-start gap-3 p-3 hover:bg-muted/30 transition-colors">
                      <div className={`shrink-0 h-9 w-9 rounded-full grid place-items-center bg-card border ${tone}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="font-semibold text-sm leading-tight truncate">{title}</p>
                          <p className={`font-bold tabular-nums whitespace-nowrap text-sm ${tone}`}>
                            {isIn ? "+" : "−"} {fmt(amt)}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p className="text-[11px] text-muted-foreground truncate">
                            {sub} · {formatDate(it.date)} · <span className="font-mono">{refId}</span>
                          </p>
                          <p className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                            ব্যাল: {fmt(it.running)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>}
          </CardContent></Card>
        </TabsContent>

        {/* Income */}
        <TabsContent value="income" className="mt-3">
          <Card><CardContent className="p-0">
            {fRecv.length === 0 ? <EmptyRow>এই সময়সীমায় কোনো আয় নেই</EmptyRow>
              : <div className="divide-y">
                {fRecv.map((r) => (
                  <div key={r.id} className="flex items-start gap-3 p-3 hover:bg-muted/30">
                    <div className="shrink-0 h-9 w-9 rounded-full grid place-items-center bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                      <ArrowDownLeft className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-semibold text-sm truncate">{r.passenger_name}</p>
                        <p className="font-bold text-emerald-600 tabular-nums text-sm whitespace-nowrap">+ {fmt(Number(r.amount))}</p>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {r.service_type} · {formatDate(r.entry_date)} · <span className="font-mono">{r.receipt_id}</span>
                        {r.ref_id && <span> · Ref {r.ref_id}</span>}
                      </p>
                    </div>
                  </div>
                ))}
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
