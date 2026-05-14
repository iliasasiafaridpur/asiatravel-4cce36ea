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
import { ArrowDownLeft, ArrowUpRight, Download, FileText, Plus, Receipt, RefreshCw, Wallet } from "lucide-react";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
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
const yearStart = () => `${new Date().getFullYear()}-01-01`;

type Preset = "today" | "month" | "year" | "all" | "custom";

interface Acct {
  user_id: string;
  full_name: string;
  total_received: number;
  total_received_today?: number;
  total_handed_over: number;
  total_expenses: number;
  current_balance: number;
}
interface Hand { id: string; handover_id: string; entry_date: string; to_name: string; amount: number; method: string; remarks: string | null; from_name: string | null; from_user: string | null; }
interface Exp  { id: string; expense_id: string; entry_date: string; category: string; purpose: string | null; amount: number; remarks: string | null; spent_by_name: string | null; spent_by: string | null; }
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
  received_by: string | null;
}
interface TicketLite { ticket_id: string; trip_road: string | null; sold_price: number | null; }
interface BmetLite   { bmet_id: string;   country_name: string | null; sold_price: number | null; }
interface SaudiLite  { saudi_id: string;  sold_price: number | null; }
interface KuwaitLite { kuwait_id: string; sold_price: number | null; }

type CachePayload = {
  acct: Acct | null;
  overview: Acct[];
  handovers: Hand[];
  expenses: Exp[];
  received: Recv[];
  tickets: TicketLite[];
  bmet: BmetLite[];
  saudi: SaudiLite[];
  kuwait: KuwaitLite[];
};

function presetRange(p: Preset): { from: string; to: string } | null {
  if (p === "today") { const d = today(); return { from: d, to: d }; }
  if (p === "month") return { from: monthStart(), to: today() };
  if (p === "year") return { from: yearStart(), to: today() };
  if (p === "all") return { from: "1970-01-01", to: "2999-12-31" };
  return null;
}

function PresetBar({ value, onChange }: { value: Preset; onChange: (p: Preset) => void }) {
  const opts: { key: Preset; label: string }[] = [
    { key: "today", label: "আজ" },
    { key: "month", label: "এই মাস" },
    { key: "year", label: "এই বছর" },
    { key: "all", label: "সব" },
    { key: "custom", label: "নির্দিষ্ট" },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {opts.map((o) => (
        <Button key={o.key} size="sm" variant={value === o.key ? "default" : "outline"} onClick={() => onChange(o.key)} className="h-8 text-xs">
          {o.label}
        </Button>
      ))}
    </div>
  );
}

function AccountsPage() {
  const { user, profile } = useCurrentUser();
  const [acct, setAcct] = useState<Acct | null>(null);
  const [overview, setOverview] = useState<Acct[]>([]);
  const [handovers, setHandovers] = useState<Hand[]>([]);
  const [expenses, setExpenses] = useState<Exp[]>([]);
  const [received, setReceived] = useState<Recv[]>([]);
  const [tickets, setTickets] = useState<TicketLite[]>([]);
  const [bmet, setBmet] = useState<BmetLite[]>([]);
  const [saudi, setSaudi] = useState<SaudiLite[]>([]);
  const [kuwait, setKuwait] = useState<KuwaitLite[]>([]);

  // Per-section filter state
  const [recvPreset, setRecvPreset] = useState<Preset>("month");
  const [recvFrom, setRecvFrom] = useState(monthStart());
  const [recvTo, setRecvTo] = useState(today());
  const [serviceFilter, setServiceFilter] = useState("all");

  const [handPreset, setHandPreset] = useState<Preset>("month");
  const [handFrom, setHandFrom] = useState(monthStart());
  const [handTo, setHandTo] = useState(today());

  const [expPreset, setExpPreset] = useState<Preset>("month");
  const [expFrom, setExpFrom] = useState(monthStart());
  const [expTo, setExpTo] = useState(today());

  const [repPreset, setRepPreset] = useState<Preset>("month");
  const [repFrom, setRepFrom] = useState(monthStart());
  const [repTo, setRepTo] = useState(today());

  const [syncing, setSyncing] = useState(false);
  const [hForm, setHForm] = useState({ entry_date: today(), to_name: "MD Sir", amount: 0, method: "Hand Cash", remarks: "" });
  const [eForm, setEForm] = useState({ entry_date: today(), category: "Office", purpose: "", amount: 0, remarks: "" });
  const [rForm, setRForm] = useState({ entry_date: today(), service_type: "AIR TICKET", ref_id: "", passenger_name: "", amount: 0, method: "Cash", remarks: "" });
  const reloadingRef = useRef(false);
  const queuedRef = useRef(false);
  const cacheKey = user?.id ? `accounts_cache_v3_${user.id}` : "accounts_cache_v3_guest";

  // Apply preset → date range
  const applyPreset = (p: Preset, setFrom: (s: string) => void, setTo: (s: string) => void, setP: (p: Preset) => void) => {
    setP(p);
    const r = presetRange(p);
    if (r) { setFrom(r.from); setTo(r.to); }
  };

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
      setTickets(cached.tickets ?? []);
      setBmet(cached.bmet ?? []);
      setSaudi(cached.saudi ?? []);
      setKuwait(cached.kuwait ?? []);
    } catch { /* ignore cache */ }
  }, [cacheKey]);

  const persistCache = useCallback((payload: CachePayload) => {
    try { localStorage.setItem(cacheKey, JSON.stringify(payload)); } catch { /* storage quota */ }
  }, [cacheKey]);

  const reload = useCallback(async (quiet = false) => {
    if (!user?.id) return;
    if (reloadingRef.current) { queuedRef.current = true; return; }
    reloadingRef.current = true;
    if (!quiet) setSyncing(true);

    const [a, ov, h, e, r, tk, bm, sv, kv] = await Promise.all([
      supabase.rpc("get_user_account" as never, { _user_id: user.id } as never),
      supabase.rpc("get_accounts_overview" as never),
      supabase.from("cash_handovers").select("id,handover_id,entry_date,to_name,amount,method,remarks,from_name,from_user").order("entry_date", { ascending: false }).limit(500),
      supabase.from("cash_expenses").select("id,expense_id,entry_date,category,purpose,amount,remarks,spent_by_name,spent_by").order("entry_date", { ascending: false }).limit(500),
      supabase.from("payment_receipts").select("id,receipt_id,entry_date,service_type,ref_id,passenger_name,amount,method,source,remarks,received_by_name,received_by").order("entry_date", { ascending: false }).limit(1000),
      supabase.from("tickets").select("ticket_id,trip_road,sold_price").limit(2000),
      supabase.from("bmet_cards").select("bmet_id,country_name,sold_price").limit(2000),
      supabase.from("saudi_visas").select("saudi_id,sold_price").limit(2000),
      supabase.from("kuwait_visas").select("kuwait_id,sold_price").limit(2000),
    ]);

    const firstError = a.error || ov.error || h.error || e.error || r.error || tk.error || bm.error || sv.error || kv.error;
    if (firstError) {
      if (!quiet) toast.error("Accounts sync সমস্যা: " + firstError.message);
    } else {
      const next: CachePayload = {
        acct: (((a.data as unknown) as Acct[] | null)?.[0] ?? null),
        overview: ((ov.data as unknown) as Acct[]) ?? [],
        handovers: ((h.data as unknown) as Hand[]) ?? [],
        expenses: ((e.data as unknown) as Exp[]) ?? [],
        received: ((r.data as unknown) as Recv[]) ?? [],
        tickets: ((tk.data as unknown) as TicketLite[]) ?? [],
        bmet: ((bm.data as unknown) as BmetLite[]) ?? [],
        saudi: ((sv.data as unknown) as SaudiLite[]) ?? [],
        kuwait: ((kv.data as unknown) as KuwaitLite[]) ?? [],
      };
      setAcct(next.acct);
      setOverview(next.overview);
      setHandovers(next.handovers);
      setExpenses(next.expenses);
      setReceived(next.received);
      setTickets(next.tickets);
      setBmet(next.bmet);
      setSaudi(next.saudi);
      setKuwait(next.kuwait);
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
    const ch = supabase.channel("acct_rt_v3")
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_receipts" }, () => void reload(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_handovers" }, () => void reload(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_expenses" }, () => void reload(true))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, reload]);

  // Lookup maps for enrichment (Country / Route / Sold price)
  const ticketMap = useMemo(() => new Map(tickets.map((t) => [t.ticket_id, t])), [tickets]);
  const bmetMap   = useMemo(() => new Map(bmet.map((b) => [b.bmet_id, b])), [bmet]);
  const saudiMap  = useMemo(() => new Map(saudi.map((s) => [s.saudi_id, s])), [saudi]);
  const kuwaitMap = useMemo(() => new Map(kuwait.map((k) => [k.kuwait_id, k])), [kuwait]);

  const enrichRecv = useCallback((r: Recv) => {
    let extra = "";
    let soldPrice: number | null = null;
    const id = r.ref_id ?? "";
    if (r.service_type === "AIR TICKET") {
      const t = ticketMap.get(id);
      extra = t?.trip_road ?? "—";
      soldPrice = t?.sold_price ?? null;
    } else if (r.service_type === "BMET") {
      const b = bmetMap.get(id);
      extra = b?.country_name ?? "—";
      soldPrice = b?.sold_price ?? null;
    } else if (r.service_type === "Saudi Visa") {
      const s = saudiMap.get(id);
      extra = "Saudi";
      soldPrice = s?.sold_price ?? null;
    } else if (r.service_type === "Kuwait Visa") {
      const k = kuwaitMap.get(id);
      extra = "Kuwait";
      soldPrice = k?.sold_price ?? null;
    } else {
      extra = "—";
    }
    return { extra, soldPrice };
  }, [ticketMap, bmetMap, saudiMap, kuwaitMap]);

  // Filtered datasets per section
  const filteredReceived = useMemo(() => received.filter((r) => {
    if (recvFrom && r.entry_date < recvFrom) return false;
    if (recvTo && r.entry_date > recvTo) return false;
    if (serviceFilter !== "all" && r.service_type !== serviceFilter) return false;
    return true;
  }), [recvFrom, recvTo, received, serviceFilter]);

  const myHandovers = useMemo(() => handovers.filter((h) => h.from_user === user?.id), [handovers, user?.id]);
  const myExpenses  = useMemo(() => expenses.filter((e) => e.spent_by === user?.id), [expenses, user?.id]);

  const filteredHandovers = useMemo(() => myHandovers.filter((h) =>
    (!handFrom || h.entry_date >= handFrom) && (!handTo || h.entry_date <= handTo)
  ), [myHandovers, handFrom, handTo]);

  const filteredExpenses = useMemo(() => myExpenses.filter((e) =>
    (!expFrom || e.entry_date >= expFrom) && (!expTo || e.entry_date <= expTo)
  ), [myExpenses, expFrom, expTo]);

  const runningReceived = useMemo(() => {
    let total = 0;
    return [...filteredReceived].reverse().map((r) => {
      total += Number(r.amount) || 0;
      const { extra, soldPrice } = enrichRecv(r);
      return { ...r, running: total, extra, soldPrice };
    }).reverse();
  }, [filteredReceived, enrichRecv]);

  const filteredTotal = filteredReceived.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const handTotal = filteredHandovers.reduce((sum, h) => sum + Number(h.amount || 0), 0);
  const expTotal  = filteredExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  // ---- Daily Report (combined আয়/ব্যায় ledger, all staff) ----
  type ReportRow = {
    serial: number;
    date: string;
    name: string;          // passenger / to / purpose
    service: string;       // service or category
    extra: string;         // country / route
    sold: number;          // মূল্য
    received: number;      // জমা
    due: number;           // বাকি
    incomeRunning: number; // মোট আয়
    expenseDesc: string;   // খরচ বিবরণ
    expenseAmt: number;    // খরচ পরিমান
    expenseRunning: number;// মোট খরচ
    balance: number;       // সর্বশেষ ব্যালেন্স
    user: string;          // user name
    kind: "received" | "handover" | "expense";
  };

  const reportRows = useMemo<ReportRow[]>(() => {
    type Item = { date: string; kind: ReportRow["kind"]; row: Recv | Hand | Exp };
    const items: Item[] = [];
    received.forEach((r) => {
      if (recpMatch(r.entry_date, repFrom, repTo)) items.push({ date: r.entry_date, kind: "received", row: r });
    });
    handovers.forEach((h) => {
      if (recpMatch(h.entry_date, repFrom, repTo)) items.push({ date: h.entry_date, kind: "handover", row: h });
    });
    expenses.forEach((e) => {
      if (recpMatch(e.entry_date, repFrom, repTo)) items.push({ date: e.entry_date, kind: "expense", row: e });
    });
    items.sort((a, b) => a.date.localeCompare(b.date));

    let income = 0, expenseRun = 0, serial = 0;
    return items.map((it) => {
      serial += 1;
      if (it.kind === "received") {
        const r = it.row as Recv;
        const { extra, soldPrice } = enrichRecv(r);
        const sold = soldPrice ?? Number(r.amount);
        const received = Number(r.amount);
        income += received;
        return {
          serial, date: r.entry_date, name: r.passenger_name, service: r.service_type, extra,
          sold, received, due: Math.max(sold - received, 0),
          incomeRunning: income, expenseDesc: "", expenseAmt: 0, expenseRunning: expenseRun,
          balance: income - expenseRun, user: r.received_by_name ?? "—", kind: "received",
        };
      }
      if (it.kind === "handover") {
        const h = it.row as Hand;
        expenseRun += Number(h.amount);
        return {
          serial, date: h.entry_date, name: h.to_name, service: "HANDOVER", extra: h.method,
          sold: 0, received: 0, due: 0,
          incomeRunning: income, expenseDesc: `Cash Handover → ${h.to_name}`, expenseAmt: Number(h.amount),
          expenseRunning: expenseRun, balance: income - expenseRun,
          user: h.from_name ?? "—", kind: "handover",
        };
      }
      const e = it.row as Exp;
      expenseRun += Number(e.amount);
      return {
        serial, date: e.entry_date, name: e.purpose ?? e.category, service: "EXPENSE", extra: e.category,
        sold: 0, received: 0, due: 0,
        incomeRunning: income, expenseDesc: e.purpose ?? e.category, expenseAmt: Number(e.amount),
        expenseRunning: expenseRun, balance: income - expenseRun,
        user: e.spent_by_name ?? "—", kind: "expense",
      };
    });
  }, [received, handovers, expenses, repFrom, repTo, enrichRecv]);

  const reportTotals = useMemo(() => {
    const inc = reportRows.reduce((s, r) => s + r.received, 0);
    const exp = reportRows.reduce((s, r) => s + r.expenseAmt, 0);
    return { inc, exp, bal: inc - exp };
  }, [reportRows]);

  const saveHandover = async () => {
    if (!user?.id) return toast.error("লগ-ইন করুন");
    if (hForm.amount <= 0) return toast.error("টাকার পরিমাণ দিন");
    const temp: Hand = { id: `tmp-${Date.now()}`, handover_id: "Saving...", ...hForm, remarks: hForm.remarks || null, from_name: displayName(profile, user), from_user: user.id };
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
    const temp: Exp = { id: `tmp-${Date.now()}`, expense_id: "Saving...", ...eForm, purpose: eForm.purpose || null, remarks: eForm.remarks || null, spent_by_name: displayName(profile, user), spent_by: user.id };
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
      received_by: user.id,
    };
    setReceived((prev) => [temp, ...prev]);
    setRForm({ ...rForm, ref_id: "", passenger_name: "", amount: 0, remarks: "" });

    const receiptId = `RCV-${new Date().toISOString().slice(2, 7).replace("-", "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const { error } = await supabase.from("payment_receipts").insert({
      receipt_id: receiptId,
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
    if (id.startsWith("tmp-")) return;
    const { error } = await supabase.from("cash_handovers").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("✓ ডিলেট হয়েছে"); void reload(true); }
  };
  const delExp = async (id: string) => {
    if (id.startsWith("tmp-")) return;
    const { error } = await supabase.from("cash_expenses").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("✓ ডিলেট হয়েছে"); void reload(true); }
  };
  const delReceipt = async (r: Recv) => {
    if (r.id.startsWith("tmp-")) return;
    const { error } = await supabase.from("payment_receipts").delete().eq("id", r.id);
    if (error) toast.error(error.message); else { toast.success("✓ ডিলেট হয়েছে"); void reload(true); }
  };

  const exportCsv = () => {
    const header = ["Date", "Receipt ID", "Service", "Country/Route", "Ref ID", "Passenger", "Method", "Sold", "Received", "Running Total", "User", "Source"];
    const lines = runningReceived.map((r) => [r.entry_date, r.receipt_id, r.service_type, r.extra, r.ref_id ?? "", r.passenger_name, r.method, r.soldPrice ?? "", r.amount, r.running, r.received_by_name ?? "", r.source]);
    downloadCsv(`received-ledger-${recvFrom}-to-${recvTo}.csv`, header, lines);
  };

  const exportReportCsv = () => {
    const header = ["ক্রঃনং", "তারিখ", "নাম", "সার্ভিস বিবরণ", "Country/Route", "মূল্য", "জমা পরিমান", "বাকি", "মোট আয়", "খরচ বিবরণ", "খরচ পরিমান", "মোট খরচ", "সর্বশেষ ব্যালেন্স", "User"];
    const lines = reportRows.map((r) => [r.serial, r.date, r.name, r.service, r.extra, r.sold || "", r.received || "", r.due || "", r.incomeRunning, r.expenseDesc, r.expenseAmt || "", r.expenseRunning, r.balance, r.user]);
    downloadCsv(`daily-report-${repFrom}-to-${repTo}.csv`, header, lines);
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
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="received">Received</TabsTrigger>
          <TabsTrigger value="add">Add</TabsTrigger>
          <TabsTrigger value="handover">Hand-over</TabsTrigger>
          <TabsTrigger value="expense">Expense</TabsTrigger>
          <TabsTrigger value="report"><FileText className="h-3.5 w-3.5 mr-1" /> Report</TabsTrigger>
        </TabsList>

        {/* RECEIVED */}
        <TabsContent value="received" className="space-y-4">
          <Card>
            <CardHeader className="pb-2 space-y-2">
              <CardTitle className="text-base">Received Ledger ({filteredReceived.length}) — Total ৳ {filteredTotal.toLocaleString()}</CardTitle>
              <PresetBar value={recvPreset} onChange={(p) => applyPreset(p, setRecvFrom, setRecvTo, setRecvPreset)} />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <div><Label>From</Label><Input type="date" value={recvFrom} onChange={(e) => { setRecvFrom(e.target.value); setRecvPreset("custom"); }} /></div>
                <div><Label>To</Label><Input type="date" value={recvTo} onChange={(e) => { setRecvTo(e.target.value); setRecvPreset("custom"); }} /></div>
                <div className="col-span-2 md:col-span-2"><Label>Service</Label><Select value={serviceFilter} onValueChange={setServiceFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Service</SelectItem>{SERVICES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
                <div className="col-span-2 md:col-span-1 flex items-end"><Button variant="outline" onClick={exportCsv} className="w-full gap-1.5"><Download className="h-4 w-4" /> Export</Button></div>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Ref</TableHead>
                    <TableHead>Passenger / Service</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead></TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {runningReceived.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">এই সময়ে কোনো received entry নেই</TableCell></TableRow>
                      : runningReceived.map((r) => (
                        <TableRow key={`${r.source}-${r.id}`}>
                          <TableCell className="py-3 align-top min-w-[140px]">
                            <div className="font-mono text-xs font-semibold">{r.receipt_id}</div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">{formatDate(r.entry_date)}</div>
                            {r.received_by_name && <div className="text-[11px] text-muted-foreground/80 mt-0.5">By: {r.received_by_name}</div>}
                          </TableCell>
                          <TableCell className="py-3 align-top min-w-[200px]">
                            <div className="font-semibold leading-tight">{r.passenger_name}</div>
                            <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-1.5">
                              <span>{r.service_type}</span>
                              {r.extra && r.extra !== "—" && <><span className="opacity-50">·</span><span>{r.extra}</span></>}
                            </div>
                            {r.ref_id && <div className="text-[11px] text-muted-foreground/70 mt-0.5 font-mono">Ref: {r.ref_id}</div>}
                          </TableCell>
                          <TableCell className="py-3 align-top"><Badge variant="outline">{r.method}</Badge></TableCell>
                          <TableCell className="text-right py-3 align-top min-w-[140px]">
                            <div className="font-bold tabular-nums text-success">৳ {Number(r.amount).toLocaleString()}</div>
                            <div className="text-[11px] tabular-nums text-primary mt-0.5">Total: {Number(r.running).toLocaleString()}</div>
                          </TableCell>
                          <TableCell className="py-3 align-top"><ConfirmDeleteButton onConfirm={() => delReceipt(r)} description={`${r.service_type} — ${r.passenger_name} এর Received entry (৳${Number(r.amount).toLocaleString()}) ডিলেট করবেন?`} /></TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ADD */}
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

        {/* HANDOVER */}
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
          <Card>
            <CardHeader className="pb-2 space-y-2">
              <CardTitle className="text-base">Hand-over History ({filteredHandovers.length}) — ৳ {handTotal.toLocaleString()}</CardTitle>
              <PresetBar value={handPreset} onChange={(p) => applyPreset(p, setHandFrom, setHandTo, setHandPreset)} />
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" value={handFrom} onChange={(e) => { setHandFrom(e.target.value); setHandPreset("custom"); }} />
                <Input type="date" value={handTo} onChange={(e) => { setHandTo(e.target.value); setHandPreset("custom"); }} />
              </div>
            </CardHeader>
            <CardContent>
              <HistoryTableInner kind="handover" handovers={filteredHandovers} onDelete={delHand} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* EXPENSE */}
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
          <Card>
            <CardHeader className="pb-2 space-y-2">
              <CardTitle className="text-base">Expense History ({filteredExpenses.length}) — ৳ {expTotal.toLocaleString()}</CardTitle>
              <PresetBar value={expPreset} onChange={(p) => applyPreset(p, setExpFrom, setExpTo, setExpPreset)} />
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" value={expFrom} onChange={(e) => { setExpFrom(e.target.value); setExpPreset("custom"); }} />
                <Input type="date" value={expTo} onChange={(e) => { setExpTo(e.target.value); setExpPreset("custom"); }} />
              </div>
            </CardHeader>
            <CardContent>
              <HistoryTableInner kind="expense" expenses={filteredExpenses} onDelete={delExp} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* REPORT */}
        <TabsContent value="report" className="space-y-4">
          <Card>
            <CardHeader className="pb-2 space-y-2">
              <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> দৈনিক আয় ব্যায়ের হিসাব</CardTitle>
              <PresetBar value={repPreset} onChange={(p) => applyPreset(p, setRepFrom, setRepTo, setRepPreset)} />
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <Input type="date" value={repFrom} onChange={(e) => { setRepFrom(e.target.value); setRepPreset("custom"); }} />
                <Input type="date" value={repTo} onChange={(e) => { setRepTo(e.target.value); setRepPreset("custom"); }} />
                <Button variant="outline" onClick={exportReportCsv} className="gap-1.5"><Download className="h-4 w-4" /> CSV Export</Button>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1">
                <MiniStat label="মোট আয়" value={reportTotals.inc} tone="success" />
                <MiniStat label="মোট খরচ" value={reportTotals.exp} tone="destructive" />
                <MiniStat label="ব্যালেন্স" value={reportTotals.bal} tone="primary" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ক্রঃ</TableHead>
                      <TableHead>তারিখ</TableHead>
                      <TableHead>নাম</TableHead>
                      <TableHead>সার্ভিস</TableHead>
                      <TableHead>Country/Route</TableHead>
                      <TableHead className="text-right">মূল্য</TableHead>
                      <TableHead className="text-right">জমা</TableHead>
                      <TableHead className="text-right">বাকি</TableHead>
                      <TableHead className="text-right bg-success/5">মোট আয়</TableHead>
                      <TableHead>খরচ বিবরণ</TableHead>
                      <TableHead className="text-right">খরচ</TableHead>
                      <TableHead className="text-right bg-destructive/5">মোট খরচ</TableHead>
                      <TableHead className="text-right bg-primary/5">ব্যালেন্স</TableHead>
                      <TableHead>User</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportRows.length === 0 ? <TableRow><TableCell colSpan={14} className="text-center py-6 text-muted-foreground">এই সময়ে কোনো এন্ট্রি নেই</TableCell></TableRow>
                      : reportRows.map((r) => (
                        <TableRow key={`${r.kind}-${r.serial}`} className={r.kind === "received" ? "" : r.kind === "handover" ? "bg-warning/5" : "bg-destructive/5"}>
                          <TableCell className="text-xs">{r.serial}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs">{formatDate(r.date)}</TableCell>
                          <TableCell className="font-medium text-xs min-w-28">{r.name}</TableCell>
                          <TableCell><Badge variant="secondary" className="text-[10px]">{r.service}</Badge></TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{r.extra}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs">{r.sold ? r.sold.toLocaleString() : "—"}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs text-success">{r.received ? r.received.toLocaleString() : "—"}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs text-warning">{r.due ? r.due.toLocaleString() : "—"}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs font-semibold bg-success/5">{r.incomeRunning.toLocaleString()}</TableCell>
                          <TableCell className="text-xs min-w-28">{r.expenseDesc || "—"}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs text-destructive">{r.expenseAmt ? r.expenseAmt.toLocaleString() : "—"}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs font-semibold bg-destructive/5">{r.expenseRunning.toLocaleString()}</TableCell>
                          <TableCell className="text-right tabular-nums text-xs font-bold bg-primary/5 text-primary">{r.balance.toLocaleString()}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{r.user}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function recpMatch(date: string, from: string, to: string) {
  return (!from || date >= from) && (!to || date <= to);
}

function downloadCsv(filename: string, header: (string | number)[], lines: (string | number)[][]) {
  const csv = [header, ...lines].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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

function MiniStat({ label, value, tone }: { label: string; value: number; tone: "success" | "destructive" | "primary" }) {
  const cls = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-primary";
  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className={`text-base font-bold tabular-nums ${cls}`}>৳ {value.toLocaleString()}</p>
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

function HistoryTableInner(props: { kind: "handover"; handovers: Hand[]; onDelete: (id: string) => void } | { kind: "expense"; expenses: Exp[]; onDelete: (id: string) => void }) {
  const isHand = props.kind === "handover";
  const rows = isHand ? props.handovers : props.expenses;
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Ref</TableHead>
          <TableHead>{isHand ? "To / Method" : "Category / Purpose"}</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">কোনো এন্ট্রি নেই</TableCell></TableRow>
            : rows.map((row) => {
              const id = isHand ? (row as Hand).handover_id : (row as Exp).expense_id;
              const label = isHand ? (row as Hand).to_name : (row as Exp).category;
              const desc = isHand ? (row as Hand).method : ((row as Exp).purpose ?? "—");
              const remarks = (row as Hand | Exp).remarks ?? "";
              return (
                <TableRow key={row.id}>
                  <TableCell className="py-3 align-top min-w-[140px]">
                    <div className="font-mono text-xs font-semibold">{id}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{formatDate(row.entry_date)}</div>
                  </TableCell>
                  <TableCell className="py-3 align-top min-w-[200px]">
                    <div className="font-semibold leading-tight">{label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{desc}</div>
                    {remarks && <div className="text-[11px] text-muted-foreground/70 italic mt-0.5 truncate max-w-[260px]">{remarks}</div>}
                  </TableCell>
                  <MoneyCell value={Number(row.amount)} tone={isHand ? "warning" : "destructive"} />
                  <TableCell className="py-3 align-top"><ConfirmDeleteButton onConfirm={() => props.onDelete(row.id)} description={`${isHand ? "Hand-over" : "Expense"} entry (৳${Number(row.amount).toLocaleString()}) ডিলেট করবেন?`} /></TableCell>
                </TableRow>
              );
            })}
        </TableBody>
      </Table>
    </div>
  );
}
