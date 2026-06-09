import { DateInput } from "@/components/ui/date-input";
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
import { LookupSelect } from "@/components/LookupSelect";
import { toast } from "sonner";
import { formatDate, isAdvancePayment } from "@/lib/modules";
import { AdvanceBadge } from "@/components/AdvanceBadge";
import { generateNextId } from "@/lib/idgen";
import {
  Wallet, ArrowDownLeft, ArrowUpRight, Receipt, Plus, RefreshCw, Send, Banknote,
  CalendarDays, TrendingUp, TrendingDown, Layers, Printer, MessageSquare, Search, History, X, PencilLine,
  Lock as LockIcon,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useRole } from "@/hooks/useRole";
import { isCashMethod, isMdReceivedMethod, DUE_RECEIVE_METHODS } from "@/lib/payment-methods";


export const Route = createFileRoute("/accounts")({
  head: () => ({ meta: [{ title: "আমার হিসাব — My Accounts" }] }),
  component: AccountsPage,
});

const METHODS = [...DUE_RECEIVE_METHODS];
const EXPENSE_CATEGORIES = ["Office", "Transport", "Food", "Stationery", "Bill", "Other"];
const RECEIVERS = ["MD Sir", "Office", "Bank Deposit", "Other"];

const today = () => new Date().toISOString().slice(0, 10);


interface Hand { id: string; handover_id: string; entry_date: string; to_name: string; amount: number; method: string; remarks: string | null; from_user: string | null; status?: string | null; submitted_amount?: number | null; confirmed_amount?: number | null; closing_date?: string | null; approved_at?: string | null; approved_by?: string | null; }
interface Exp  { id: string; expense_id: string; entry_date: string; category: string; purpose: string | null; amount: number; remarks: string | null; spent_by: string | null; handover_id?: string | null; linked_source_table?: string | null; linked_source_id?: string | null; }
interface Recv { id: string; receipt_id: string; entry_date: string; service_type: string; service_table: string | null; service_row_id: string | null; ref_id: string | null; passenger_name: string; amount: number; method: string; source: string; remarks: string | null; received_by: string | null; handover_id?: string | null; }

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
  const { isAdmin, isMd, isStaff, loading: roleLoading } = useRole();
  // "আমার হিসাব" — সব ইউজার (MD/Admin সহ) শুধুমাত্র নিজের এন্ট্রি দেখবে
  const seeAll = false;
  const [received, setReceived] = useState<Recv[]>([]);
  const [handovers, setHandovers] = useState<Hand[]>([]);
  const [expenses, setExpenses] = useState<Exp[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [latestInput, setLatestInput] = useState("10");
  const [dateFrom, setDateFrom] = useState(today());
  const [dateTo, setDateTo] = useState(today());
  const [printOrientation, setPrintOrientation] = useState<"portrait" | "landscape">("portrait");

  const printRef = useRef<HTMLDivElement>(null);
  const reloadSeqRef = useRef(0);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dialog forms
  
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTab, setManualTab] = useState<"income" | "expense">("income");
  const [eForm, setEForm] = useState({ entry_date: today(), category: "Office", purpose: "", amount: "", remarks: "" });
  const [iForm, setIForm] = useState({ entry_date: today(), passenger_name: "", amount: "", method: "Cash", remarks: "" });
  const [savingIncome, setSavingIncome] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);


  const reload = useCallback(async (quiet = false) => {
    if (!user?.id) return;
    const seq = reloadSeqRef.current + 1;
    reloadSeqRef.current = seq;
    if (!quiet) setSyncing(true);

    const parsedLimit = /^\d+$/.test(latestInput.trim()) ? Math.max(parseInt(latestInput.trim(), 10), 1) : 1000;
    let recvQuery = supabase.from("payment_receipts").select("id,receipt_id,entry_date,created_at,service_type,service_table,service_row_id,ref_id,passenger_name,amount,method,source,remarks,received_by,handover_id").not("source", "eq", "discount").not("method", "ilike", "discount").order("created_at", { ascending: false });
    let handQuery = supabase.from("cash_handovers").select("id,handover_id,entry_date,created_at,to_name,amount,method,remarks,from_user,status,submitted_amount,confirmed_amount,closing_date,approved_at,approved_by").order("created_at", { ascending: false });
    let expQuery  = supabase.from("cash_expenses").select("id,expense_id,entry_date,created_at,category,purpose,amount,remarks,spent_by,handover_id,linked_source_table,linked_source_id").order("created_at", { ascending: false });

    // Load the opening history too. The visible list is still filtered below,
    // but "হাতে আছে" must be the real running cash balance as of dateTo — not
    // only this period's net. Otherwise a previous handover inside today's
    // filter incorrectly reduces today's newly received cash.
    if (dateTo) {
      recvQuery = recvQuery.lte("entry_date", dateTo);
      handQuery = handQuery.lte("entry_date", dateTo);
      expQuery = expQuery.lte("entry_date", dateTo);
    }
    const historyLimit = Math.max(parsedLimit, 5000);
    recvQuery = recvQuery.limit(historyLimit);
    handQuery = handQuery.limit(historyLimit);
    expQuery = expQuery.limit(historyLimit);

    const [r, h, e] = await Promise.all([
      seeAll ? recvQuery : recvQuery.or(`received_by.eq.${user.id},created_by.eq.${user.id}`),
      seeAll ? handQuery : handQuery.or(`from_user.eq.${user.id},created_by.eq.${user.id}`),
      seeAll ? expQuery  : expQuery.or(`spent_by.eq.${user.id},created_by.eq.${user.id}`),
    ]);

    const err = r.error || h.error || e.error;
    if (seq !== reloadSeqRef.current) return;
    if (err) {
      if (!quiet) toast.error("সিঙ্ক সমস্যা: " + err.message);
    }
    setReceived(r.error ? [] : (((r.data as unknown) as Recv[]) ?? []));
    setHandovers(h.error ? [] : (((h.data as unknown) as Hand[]) ?? []));
    setExpenses(e.error ? [] : (((e.data as unknown) as Exp[]) ?? []));

    setSyncing(false);
    setLoading(false);
  }, [user?.id, seeAll, dateTo, latestInput]);

  useEffect(() => {
    void reload(true);
    // Debounce realtime refreshes: any change across the 3 tables (from ANY
    // user) used to trigger an immediate full reload (5000 rows × 3 tables).
    // Bursts of changes caused the UI to freeze. Coalesce them into one reload.
    const scheduleReload = () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => { void reload(true); }, 1200);
    };
    const ch = supabase.channel("my_acct_v1")
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_receipts" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_handovers" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_expenses" }, scheduleReload)
      .subscribe();
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      supabase.removeChannel(ch);
    };
  }, [user?.id, reload]);


  // Filter mode: date range takes priority over latest-N
  const parsedN = /^\d+$/.test(latestInput.trim()) ? parseInt(latestInput.trim(), 10) : NaN;
  const latestN = Number.isFinite(parsedN) && parsedN > 0 ? parsedN : 0;
  const useDateFilter = !!(dateFrom || dateTo);
  const isInvalidInput = !useDateFilter && latestN === 0;
  const inDateRange = useCallback((d: string) => {
    if (!d) return false;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  }, [dateFrom, dateTo]);

  // Service detail map (for timeline secondary text & due display)
   type SvcDetail = {
     country?: string | null; route?: string | null; airline?: string | null;
     service_name?: string | null;
     flight_date?: string | null; vendor?: string | null; cost?: number;
      sold?: number; received_total?: number; discount?: number; agent?: string | null;
      delivery_date?: string | null; has_delivery?: boolean;
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
        cols: "id,airline,trip_road,flight_date,vendor_bought,agency_sold,sold_price,cost_price,received,discount_amount",
        map: (r) => ({ airline: r.airline as string, route: r.trip_road as string, flight_date: r.flight_date as string, vendor: r.vendor_bought as string, agent: r.agency_sold as string, cost: Number(r.cost_price ?? 0), sold: Number(r.sold_price ?? 0), received_total: Number(r.received ?? 0), discount: Number(r.discount_amount ?? 0), has_delivery: false }),
      },
      bmet_cards: {
        cols: "id,country_name,vendor_bought,agency_sold,sold_price,cost_price,received_amount,discount_amount,delivery_date",
        map: (r) => ({ country: r.country_name as string, vendor: r.vendor_bought as string, agent: r.agency_sold as string, cost: Number(r.cost_price ?? 0), sold: Number(r.sold_price ?? 0), received_total: Number(r.received_amount ?? 0), discount: Number(r.discount_amount ?? 0), delivery_date: r.delivery_date as string, has_delivery: true }),
      },
      saudi_visas: {
        cols: "id,vendor_bought,agency_sold,sold_price,cost_price,received_amount,discount_amount,delivery_date",
        map: (r) => ({ country: "Saudi Arabia", vendor: r.vendor_bought as string, agent: r.agency_sold as string, cost: Number(r.cost_price ?? 0), sold: Number(r.sold_price ?? 0), received_total: Number(r.received_amount ?? 0), discount: Number(r.discount_amount ?? 0), delivery_date: r.delivery_date as string, has_delivery: true }),
      },
      kuwait_visas: {
        cols: "id,vendor_bought,agency_sold,sold_price,cost_price,received,discount_amount,delivery_date",
        map: (r) => ({ country: "Kuwait", vendor: r.vendor_bought as string, agent: r.agency_sold as string, cost: Number(r.cost_price ?? 0), sold: Number(r.sold_price ?? 0), received_total: Number(r.received ?? 0), discount: Number(r.discount_amount ?? 0), delivery_date: r.delivery_date as string, has_delivery: true }),
      },
      others: {
        cols: "id,service_name,airline,trip_road,flight_date,vendor_bought,agency_sold,sold_price,cost_price,received_amount,discount_amount,delivery_date",
        map: (r) => ({ service_name: r.service_name as string, airline: r.airline as string, route: r.trip_road as string, flight_date: r.flight_date as string, vendor: r.vendor_bought as string, agent: r.agency_sold as string, cost: Number(r.cost_price ?? 0), sold: Number(r.sold_price ?? 0), received_total: Number(r.received_amount ?? 0), discount: Number(r.discount_amount ?? 0), delivery_date: r.delivery_date as string, has_delivery: true }),
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

  const fRecv = useMemo(() => useDateFilter ? received.filter(r => inDateRange(r.entry_date)) : received.slice(0, latestN), [received, latestN, useDateFilter, inDateRange]);
  const fHand = useMemo(() => useDateFilter ? handovers.filter(h => inDateRange(h.entry_date)) : handovers.slice(0, latestN), [handovers, latestN, useDateFilter, inDateRange]);
  const fExp  = useMemo(() => useDateFilter ? expenses.filter(e => inDateRange(e.entry_date)) : expenses.slice(0, latestN), [expenses, latestN, useDateFilter, inDateRange]);
  const isHandoverSubmitted = (h: Hand) => Boolean(h.submitted_amount !== null && h.submitted_amount !== undefined) || Boolean(h.closing_date) || (h.status ?? "approved") === "pending";

  // Only Cash receipts add to the staff's balance. Non-cash (bKash, Nagad, Md cash…)
  // go straight to MD — kept as entries but excluded from balance.
  const periodIncome = fRecv.reduce((s, r) => s + (isCashMethod(r.method) ? Number(r.amount || 0) : 0), 0);
  const periodMdIncome = fRecv.reduce((s, r) => s + (isMdReceivedMethod(r.method) ? Number(r.amount || 0) : 0), 0);
  const periodHand   = fHand.filter((h) => (h.status ?? "approved") === "approved").reduce((s, h) => s + Number(h.amount || 0), 0);
  const periodExp    = fExp.reduce((s, e) => s + Number(e.amount || 0), 0);
  const balance = useMemo(() => {
    const cashIn = received.reduce((s, r) => s + (isCashMethod(r.method) ? Number(r.amount || 0) : 0), 0);
    const cashOut = handovers
      .filter((h) => (h.status ?? "approved") === "approved")
      .reduce((s, h) => s + Number(h.amount || 0), 0);
    const spent = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    return cashIn - cashOut - spent;
  }, [received, handovers, expenses]);

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
      // Non-cash (MD-received) income does NOT change the running balance.
      if (it.kind === "received") bal += isCashMethod((it.row as Recv).method) ? Number(it.row.amount) : 0;
      else if (it.kind === "handover") bal -= (it.row.status ?? "approved") === "approved" ? Number(it.row.amount) : 0;
      else bal -= Number(it.row.amount);
      return { ...it, running: bal };
    });
  }, [received, handovers, expenses]);

  const timeline = useMemo<(TLItem & { running: number })[]>(() => {
    const desc = [...fullAsc].reverse();
    if (useDateFilter) return desc.filter(it => inDateRange(it.date));
    if (latestN === 0) return [];
    return desc.slice(0, latestN);
  }, [fullAsc, latestN, useDateFilter, inDateRange]);

  // Print rows — running balance is SCOPED to the filtered entries only
  // (starts from 0), so a "সর্বশেষ ৩" print shows exactly those 3 lines and
  // does NOT carry the historical/actual balance (e.g. 38,000) into the table.
  const printAscRows = useMemo<{ it: TLItem & { running: number }; running: number }[]>(() => {
    const asc = [...timeline].reverse();
    let bal = 0;
    return asc.map((it) => {
      if (it.kind === "received") bal += isCashMethod((it.row as Recv).method) ? Number((it.row as Recv).amount) : 0;
      else if (it.kind === "handover") bal -= ((it.row as Hand).status ?? "approved") === "approved" ? Number((it.row as Hand).amount) : 0;
      else bal -= Number((it.row as Exp).amount);
      return { it, running: bal };
    });
  }, [timeline]);


  // Save expense
  const saveExpense = async () => {
    if (savingExpense) return;
    if (!user?.id) return toast.error("লগ-ইন করুন");
    const amt = Number(eForm.amount);
    if (!amt || amt <= 0) return toast.error("সঠিক টাকার পরিমাণ দিন");
    setSavingExpense(true);
    try {
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
      setManualOpen(false);
      void reload(true);
    } finally {
      setSavingExpense(false);
    }
  };

  // Save manual income (payment_receipts with source="manual")
  const saveManualIncome = async () => {
    if (savingIncome) return;
    if (!user?.id) return toast.error("লগ-ইন করুন");
    const amt = Number(iForm.amount);
    if (!amt || amt <= 0) return toast.error("সঠিক টাকার পরিমাণ দিন");
    setSavingIncome(true);
    try {
      const receiptId = await generateNextId({
        key: "_rcpt", label: "", short: "", table: "payment_receipts",
        idColumn: "receipt_id", idPrefix: "RCPT", monthlyId: true, fields: [],
      });
      const me = displayName(profile, user);
      const { error } = await supabase.from("payment_receipts").insert({
        receipt_id: receiptId,
        entry_date: iForm.entry_date,
        service_type: "Manual",
        service_table: null,
        service_row_id: null,
        ref_id: null,
        passenger_name: iForm.passenger_name || "Manual Entry",
        amount: amt,
        method: iForm.method,
        source: "manual",
        remarks: iForm.remarks || null,
        received_by: user.id,
        received_by_name: me,
        created_by: user.id,
      } as never);
      if (error) return toast.error(error.message);
      toast.success("✓ আয় সংরক্ষিত");
      setIForm({ entry_date: today(), passenger_name: "", amount: "", method: "Cash", remarks: "" });
      setManualOpen(false);
      void reload(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingIncome(false);
    }
  };

  const deleteHand = async (id: string): Promise<void> => {
    const { error } = await supabase.from("cash_handovers").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("ডিলেট সম্পন্ন");
    void reload(true);
  };
  // Which column holds the "received" total on each service table
  const RECV_COL: Record<string, string> = {
    tickets: "received",
    kuwait_visas: "received",
    bmet_cards: "received_amount",
    saudi_visas: "received_amount",
    others: "received_amount",
    extra_services: "received_amount",
  };
  const deleteRecv = async (id: string): Promise<void> => {
    // Find the receipt first so we can roll back the linked service's received total.
    const rec = received.find((r) => r.id === id);
    const { error } = await supabase.from("payment_receipts").delete().eq("id", id);
    if (error) { toast.error("ডিলেট ব্যর্থ: " + error.message); return; }

    // Roll back the service row's received amount so module pages stop showing it.
    if (rec?.service_table && rec.service_row_id && RECV_COL[rec.service_table]) {
      const col = RECV_COL[rec.service_table];
      const { data: svcRow } = await supabase
        .from(rec.service_table as never)
        .select(`id,${col}`)
        .eq("id", rec.service_row_id)
        .maybeSingle();
      if (svcRow) {
        const current = Number((svcRow as Record<string, unknown>)[col] ?? 0);
        const next = Math.max(0, current - Number(rec.amount || 0));
        await supabase
          .from(rec.service_table as never)
          .update({ [col]: next } as never)
          .eq("id", rec.service_row_id);
      }
    }

    toast.success("ডিলেট সম্পন্ন");
    await reload(true);
  };
  const deleteExp = async (id: string): Promise<void> => {
    const { error } = await supabase.from("cash_expenses").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("ডিলেট সম্পন্ন");
    void reload(true);
  };

  // Print timeline
  const handlePrint = () => {
    const node = printRef.current;
    if (!node) return;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) { toast.error("পপ-আপ ব্লক হয়েছে"); return; }
    const periodLabel = useDateFilter
      ? `${dateFrom || "শুরু"} → ${dateTo || "এখন"}`
      : `সর্বশেষ ${latestN} লেনদেন`;
    const totals = timeline.reduce(
      (acc, it) => {
        const amt = Number((it.row as { amount: number }).amount || 0);
        if (it.kind === "received") {
          if (isCashMethod((it.row as Recv).method)) acc.inAmt += amt;
          else acc.mdAmt += amt;
        }
        else if (it.kind === "handover") acc.outAmt += ((it.row as Hand).status ?? "approved") === "approved" ? amt : 0;
        else acc.outAmt += amt;
        return acc;
      },
      { inAmt: 0, outAmt: 0, mdAmt: 0 },
    );
    // Balance shown on the print is SCOPED to the filtered entries (net of the
    // printed lines only), so it never carries the historical 38,000 balance.
    const scopedBalance = totals.inAmt - totals.outAmt;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>আজকের হিসাব- এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্</title>
<style>
  @page{size:A4 ${printOrientation};margin:5mm}
  body{font-family:'Noto Sans Bengali',system-ui,sans-serif;padding:4px;color:#111;margin:0}
  h1{margin:0 0 2px;font-size:15px}
  .meta{color:#555;font-size:10.5px;margin-bottom:6px}
  .summary{display:flex;gap:5px;margin-bottom:6px;font-size:11px;font-weight:700}
  .summary div{padding:3px 6px;border:1px solid #ddd;border-radius:4px;flex:1}
  table{width:100%;border-collapse:collapse;font-size:10px;table-layout:auto}
  th,td{border-bottom:1px solid #e5e5e5;padding:2px 3px;text-align:left;vertical-align:top;line-height:1.25}
  td.wrap,th.wrap{white-space:normal;word-break:break-word}
  th{background:#f5f5f5;font-weight:600}
  th.num{text-align:right}
  td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  td.num.in{text-align:left}
  .in{color:#059669}.out{color:#b45309}.hand{color:#0284c7}.due{color:#b91c1c}
  tfoot td{font-weight:700;background:#fafafa}
  @media print{body{padding:2px}}
</style></head><body>
<h1>আজকের হিসাব- এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্</h1>
<div class="meta">${displayName(profile, user)} · ${formatDate(today())} · সময়: ${periodLabel} · মোট ${timeline.length} এন্ট্রি</div>
<div class="summary">
  <div>এই ${timeline.length} লেনদেনের নিট: <b>${fmt(scopedBalance)}</b></div>
  <div class="in">নগদ আয়: <b>+ ${fmt(totals.inAmt)}</b></div>
  ${totals.mdAmt > 0 ? `<div class="hand">MD রিসিভ (ব্যালেন্সে নয়): <b>${fmt(totals.mdAmt)}</b></div>` : ""}
  <div class="out">খরচ/জমা: <b>− ${fmt(totals.outAmt)}</b></div>
</div>
${node.innerHTML.replace(
  "</tbody>",
  `<tr><td colspan="6" style="font-weight:700">Total</td>` +
  `<td class="num in" style="font-weight:700">+ ${fmt(totals.inAmt)}</td>` +
  `<td></td>` +
  `<td></td>` +
  `<td class="num out" style="font-weight:700">− ${fmt(totals.outAmt)}</td>` +
  `<td class="num" style="font-weight:700">${fmt(scopedBalance)}</td></tr></tbody>`
)}
<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script>
</body></html>`);
    w.document.close();
  };

  if (roleLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  // TEMP: Admin has full master access — no redirect.

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
        <StatCard label="নগদ আয় (ব্যালেন্সে)" value={periodIncome} icon={TrendingUp} tone="success" />
        <StatCard label="Submit Cash Handover" value={periodHand} icon={Send} tone="info" />
        <StatCard label="মোট খরচ" value={periodExp} icon={TrendingDown} tone="warning" />
      </div>

      {/* Action Bar */}
      <Card className="overflow-hidden">
        <CardContent className="p-3 flex flex-wrap items-center gap-2 justify-between">
          <div className="flex items-center gap-2 flex-wrap flex-1 min-w-[220px]">
            {/* Latest-N input */}
            <div className="relative flex-1 min-w-[180px] max-w-[260px] group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={latestInput}
                disabled={useDateFilter}
                onChange={(e) => setLatestInput(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="সংখ্যা (যেমন: 5)"
                className="h-10 pl-9 pr-20 text-sm font-medium tabular-nums bg-gradient-to-br from-card to-muted/40 border-primary/20 focus-visible:ring-primary/40 focus-visible:border-primary/50 shadow-sm rounded-xl disabled:opacity-50"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1 pointer-events-none">
                <History className="h-3 w-3" />
                সর্বশেষ
              </span>
            </div>

            {/* Date range */}
            <div className="flex items-center gap-1.5 flex-1 basis-full sm:basis-auto min-w-[240px]">
              <div className="relative flex-1">
                <CalendarDays className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <DateInput
                  
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-10 pl-8 text-xs tabular-nums bg-gradient-to-br from-card to-muted/40 border-sky-500/20 focus-visible:ring-sky-500/40 shadow-sm rounded-xl"
                  aria-label="শুরুর তারিখ"
                />
              </div>
              <span className="text-muted-foreground text-xs">→</span>
              <div className="relative flex-1">
                <CalendarDays className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <DateInput
                  
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-10 pl-8 text-xs tabular-nums bg-gradient-to-br from-card to-muted/40 border-sky-500/20 focus-visible:ring-sky-500/40 shadow-sm rounded-xl"
                  aria-label="শেষ তারিখ"
                />
              </div>
              {useDateFilter && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0"
                  onClick={() => { setDateFrom(""); setDateTo(""); }}
                  aria-label="তারিখ ফিল্টার মুছুন"
                  title="তারিখ ফিল্টার মুছুন"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* Quick: Today */}
            {(() => {
              const t = today();
              const isToday = useDateFilter && dateFrom === t && dateTo === t;
              return (
                <Button
                  type="button"
                  size="sm"
                  variant={isToday ? "default" : "outline"}
                  onClick={() => {
                    if (isToday) { setDateFrom(""); setDateTo(""); }
                    else { setDateFrom(t); setDateTo(t); }
                  }}
                  className="h-9 gap-1.5 rounded-xl text-xs font-semibold shrink-0"
                  title="আজকের লেনদেন"
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  আজকের গুলো
                </Button>
              );
            })()}

            {/* Active badge */}
            <div className="hidden md:flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary text-[11px] font-semibold whitespace-nowrap">
              {useDateFilter
                ? `${fRecv.length + fHand.length + fExp.length} এন্ট্রি · তারিখ`
                : isInvalidInput ? "ফিল্টার নেই" : `${latestN} সর্বশেষ`}
            </div>
          </div>
          <div className="flex gap-2">
            {(isStaff || isAdmin) && (
              <Button asChild size="sm" variant="outline" className="gap-1.5 h-9">
                <Link to="/my-handover">
                  <LockIcon className="h-4 w-4" /> আমার ক্যাশ হিসাব
                </Link>
              </Button>
            )}


            <Dialog open={manualOpen} onOpenChange={setManualOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="secondary" className="gap-1.5 h-9">
                  <PencilLine className="h-4 w-4" /> ম্যানুয়াল এন্ট্রি
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>ম্যানুয়াল এন্ট্রি</DialogTitle>
                  <DialogDescription>সরাসরি আয় বা খরচ যোগ করুন।</DialogDescription>
                </DialogHeader>
                <Tabs value={manualTab} onValueChange={(v) => setManualTab(v as "income" | "expense")}>
                  <TabsList className="grid grid-cols-2 w-full">
                    <TabsTrigger value="income" className="gap-1.5"><ArrowDownLeft className="h-3.5 w-3.5" />ম্যানুয়ালী আয় যোগ</TabsTrigger>
                    <TabsTrigger value="expense" className="gap-1.5"><ArrowUpRight className="h-3.5 w-3.5" />ম্যানুয়ালী খরচ যোগ</TabsTrigger>
                  </TabsList>

                  <TabsContent value="income" className="space-y-3 mt-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">তারিখ</Label>
                        <DateInput value={iForm.entry_date} onChange={(e) => setIForm({ ...iForm, entry_date: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs">মাধ্যম</Label>
                        <LookupSelect kind="payment_method" defaults={METHODS} value={iForm.method} onChange={(v) => setIForm({ ...iForm, method: v })} />
                      </div>
                    </div>
                    {isMdReceivedMethod(iForm.method) && (
                      <div className="rounded-md border border-sky-500/40 bg-sky-500/10 p-2 text-[11px] text-sky-700 dark:text-sky-300">
                        ⚠️ এই টাকা সরাসরি MD-এর কাছে যাবে — আপনার ক্যাশ ব্যালেন্সে যোগ হবে না, শুধু এন্ট্রি থাকবে ({iForm.method})।
                      </div>
                    )}
                    <div>
                      <Label className="text-xs">উৎস / নাম</Label>
                      <Input placeholder="যেমন: কাস্টমার নাম বা উৎস" value={iForm.passenger_name} onChange={(e) => setIForm({ ...iForm, passenger_name: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">পরিমাণ (৳)</Label>
                      <Input type="number" inputMode="numeric" placeholder="0" value={iForm.amount} onChange={(e) => setIForm({ ...iForm, amount: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">মন্তব্য</Label>
                      <Textarea rows={2} placeholder="ঐচ্ছিক" value={iForm.remarks} onChange={(e) => setIForm({ ...iForm, remarks: e.target.value })} />
                    </div>
                    <DialogFooter>
                      <Button onClick={saveManualIncome} disabled={savingIncome} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"><Plus className="h-4 w-4" />{savingIncome ? "সংরক্ষণ হচ্ছে..." : "আয় সংরক্ষণ"}</Button>
                    </DialogFooter>
                  </TabsContent>

                  <TabsContent value="expense" className="space-y-3 mt-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">তারিখ</Label>
                        <DateInput value={eForm.entry_date} onChange={(e) => setEForm({ ...eForm, entry_date: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs">ক্যাটাগরি</Label>
                        <LookupSelect kind="expense_category" defaults={EXPENSE_CATEGORIES} value={eForm.category} onChange={(v) => setEForm({ ...eForm, category: v })} />
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
                    <DialogFooter>
                      <Button onClick={saveExpense} disabled={savingExpense} className="gap-1.5"><Plus className="h-4 w-4" />{savingExpense ? "সংরক্ষণ হচ্ছে..." : "খরচ সংরক্ষণ"}</Button>
                    </DialogFooter>
                  </TabsContent>
                </Tabs>
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
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Submit Cash Handover</p>
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
          <TabsTrigger value="handover" className="text-xs gap-1"><ArrowUpRight className="h-3.5 w-3.5" />Cash Handover</TabsTrigger>
        </TabsList>

        {/* Timeline */}
        <TabsContent value="timeline" className="mt-3 space-y-3">
          {/* Timeline header strip with count + print */}
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="text-xs text-muted-foreground">
              {isInvalidInput
                ? <span className="text-amber-600 font-medium">⚠ সঠিক সংখ্যা বা তারিখ দিন</span>
                : useDateFilter
                ? <>{dateFrom || "শুরু"} → {dateTo || "এখন"} · <b className="text-foreground">{timeline.length}</b> লেনদেন</>
                : <>সর্বশেষ <b className="text-foreground">{timeline.length}</b> লেনদেন</>}
            </div>
            <div className="flex items-center gap-1.5">
              <Select value={printOrientation} onValueChange={(v) => setPrintOrientation(v as "portrait" | "landscape")}>
                <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="portrait">Portrait</SelectItem>
                  <SelectItem value="landscape">Landscape</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={handlePrint} disabled={timeline.length === 0} className="h-8 text-xs gap-1.5">
                <Printer className="h-3.5 w-3.5" /> প্রিন্ট
              </Button>
            </div>
          </div>

          <Card><CardContent className="p-0">
            {loading ? <EmptyRow>লোড হচ্ছে...</EmptyRow>
              : isInvalidInput ? (
                <div className="text-center py-16 px-4 space-y-3">
                  <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 grid place-items-center">
                    <Search className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">সংখ্যা লিখুন</p>
                    <p className="text-xs text-muted-foreground mt-1">কতগুলো সর্বশেষ লেনদেন দেখতে চান? উপরের বক্সে একটি সংখ্যা (যেমন: ৫, ১০, ২৫) লিখুন।</p>
                  </div>
                </div>
              )
              : timeline.length === 0 ? <EmptyRow>কোনো লেনদেন পাওয়া যায়নি</EmptyRow>
              : <div className="divide-y">
                {timeline.map((it, idx) => {
                  const isIn = it.kind === "received";
                  const isHand = it.kind === "handover";
                  const r = it.row as Recv; const h = it.row as Hand; const e = it.row as Exp;
                  const amt = Number(isIn ? r.amount : isHand ? h.amount : e.amount);
                  const isPendingHand = isHand && (h.status ?? "approved") === "pending";
                  const tone = isIn ? "text-emerald-600" : isHand ? "text-sky-600" : "text-amber-600";
                  const bgTone = isIn ? "bg-emerald-500/10 border-emerald-500/20" : isHand ? "bg-sky-500/10 border-sky-500/20" : "bg-amber-500/10 border-amber-500/20";
                  const kindLabel = isIn ? "আয়" : isHand ? (isPendingHand ? "Pending Handover" : "জমা") : "ব্যয়";
                  // Col 1: উৎস/নাম (source/name)
                  const name = isIn
                    ? (r.passenger_name || (r.source === "manual" ? "ম্যানুয়াল আয়" : "—"))
                    : isHand
                    ? (h.to_name || "প্রাপক")
                    : (e.category || "খরচ");

                  // Col 2: উদ্দেশ্য (purpose) — primary line
                  const svc = isIn && r.service_row_id ? svcMap[r.service_row_id] : undefined;
                  const servicePrimary = isIn
                    ? (r.source === "manual"
                        ? (r.remarks || "ম্যানুয়াল আয়")
                        : (r.service_type || "Service"))
                    : isHand
                    ? "জমা / Handover"
                    : (e.purpose || "—");

                  const svcLines: string[] = [];
                  if (isIn && svc) {
                    if (r.service_table === "tickets") {
                      if (svc.route) svcLines.push(svc.route);
                      if (svc.airline) svcLines.push(svc.airline);
                      if (svc.flight_date) svcLines.push(`✈ ${formatDate(svc.flight_date)}`);
                    } else if (r.service_table === "others") {
                      if (svc.service_name) svcLines.push(svc.service_name);
                      if (svc.airline) svcLines.push(svc.airline);
                      if (svc.route) svcLines.push(svc.route);
                      if (svc.flight_date) svcLines.push(`✈ ${formatDate(svc.flight_date)}`);
                    } else if (svc.country) {
                      svcLines.push(svc.country);
                    }
                  }
                  const primaryBits: string[] = [];
                  if (isIn && r.method) primaryBits.push(`💳 ${r.method}`);
                  if (isIn && r.source && r.source !== "manual") primaryBits.push(`📒 ${r.source}`);
                  if (isHand && h.method) primaryBits.push(`💳 ${h.method}`);
                  const discountTotal = isIn && svc && typeof svc.discount === "number" ? svc.discount : 0;
                  const dueLeft = isIn && svc && typeof svc.sold === "number" && typeof svc.received_total === "number"
                    ? svc.sold - svc.received_total - discountTotal : null;

                  const totalBill = isIn && svc && typeof svc.sold === "number" ? svc.sold : null;
                  const totalPaid = isIn && svc && typeof svc.received_total === "number" ? svc.received_total : null;
                  const isAdvance = isIn && !!svc?.has_delivery && isAdvancePayment(r.entry_date, svc?.delivery_date);

                  return (
                    <div key={`${it.kind}-${(it.row as { id: string }).id}`} className={`row-tint-${idx % 4} grid grid-cols-[1fr_1.1fr_0.85fr_0.9fr_auto] gap-2 sm:gap-3 p-2.5 sm:p-3 transition-colors items-start`}>
                      {/* Col 1: Name */}
                      <div className="min-w-0">
                        <p className="font-semibold text-sm leading-tight break-words">{name}</p>
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1 flex-wrap">
                          <span className={`px-1.5 py-px rounded-full border ${bgTone} ${tone} font-medium`}>{kindLabel}</span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-0.5">
                          <CalendarDays className="h-2.5 w-2.5" />{formatDate(it.date)}
                        </p>
                        {isIn && r.ref_id && <p className="text-xs text-muted-foreground mt-0.5">Ref: <span className="font-mono">{r.ref_id}</span></p>}
                      </div>

                      {/* Col 2: Service + secondary (no due here) */}
                      <div className="min-w-0">
                        <p className="font-medium text-sm leading-tight break-words">{servicePrimary}</p>
                        {svcLines.map((line, i) => (
                          <p key={i} className="text-xs text-muted-foreground mt-0.5 leading-snug break-words">
                            {line}
                          </p>
                        ))}
                        {isPendingHand && (
                          <p className="text-xs text-amber-600 mt-0.5 leading-snug break-words">
                            MD approval pending
                          </p>
                        )}
                        {(isIn ? r.remarks : isHand ? h.remarks : e.remarks) && (
                          <p className="text-xs text-muted-foreground/90 mt-1 flex items-start gap-1">
                            <MessageSquare className="h-2.5 w-2.5 mt-0.5 shrink-0" />
                            <span className="break-words">{isIn ? r.remarks : isHand ? h.remarks : e.remarks}</span>
                          </p>
                        )}
                      </div>

                      {/* Col 3 (NEW): মোট বিল / মোট জমা / বাকি */}
                      <div className="min-w-0 text-xs space-y-0.5">
                        {totalBill !== null ? (
                          <>
                            <p className="text-muted-foreground">মোট বিল: <span className="font-semibold text-foreground tabular-nums">{fmt(totalBill)}</span></p>
                            {totalPaid !== null && (
                              <p className="text-muted-foreground">মোট জমা: <span className="font-semibold text-emerald-600 tabular-nums">{fmt(totalPaid)}</span></p>
                            )}
                            {discountTotal > 0 && (
                              <p className="text-muted-foreground">Discount: <span className="font-semibold text-amber-600 tabular-nums">{fmt(discountTotal)}</span></p>
                            )}
                            {dueLeft !== null && (
                              <p className="text-muted-foreground">বাকি: <span className={`font-semibold tabular-nums ${dueLeft > 0.005 ? "text-rose-600" : "text-emerald-600"}`}>{fmt(dueLeft)}</span></p>
                            )}
                          </>
                        ) : (
                          <p className="text-muted-foreground/50">—</p>
                        )}
                      </div>

                      {/* Col 4: Agent + Vendor + cost */}
                      <div className="min-w-0">
                        {isIn && svc?.agent && (
                          <p className="text-sm font-semibold leading-tight break-words text-foreground">{svc.agent}</p>
                        )}
                        {isIn && svc?.vendor ? (
                          <>
                            <p className={`text-xs font-medium leading-tight break-words ${svc?.agent ? "mt-0.5 text-muted-foreground" : ""}`}>{svc.vendor}</p>
                            {typeof svc.cost === "number" && svc.cost > 0 && (
                              <p className="text-xs text-muted-foreground tabular-nums mt-0.5">{fmt(svc.cost)}</p>
                            )}
                          </>
                        ) : (
                          !svc?.agent && <p className="text-xs text-muted-foreground/50">—</p>
                        )}
                      </div>

                      {/* Col 4: Amount + Balance */}
                      <div className="text-right shrink-0">
                        <p className={`font-bold tabular-nums whitespace-nowrap text-sm ${tone}`}>
                          {isAdvance ? <><AdvanceBadge advance /> </> : null}{isIn ? "+" : "−"} {fmt(amt)}
                        </p>
                        {isPendingHand && <p className="text-[10px] text-amber-600 whitespace-nowrap">Balance থেকে বাদ হয়নি</p>}
                        {isIn && isMdReceivedMethod(r.method) && (
                          <p className="text-[10px] text-sky-600 dark:text-sky-400 whitespace-nowrap leading-tight">MD রিসিভ · {r.method}<br />ব্যালেন্সে যোগ হয়নি</p>
                        )}
                        <p className="text-[10px] text-primary tabular-nums whitespace-nowrap mt-1 font-medium">
                          ব্যালেন্স
                        </p>
                        <p className="text-[11px] tabular-nums whitespace-nowrap font-semibold text-primary">
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
                  <th>#</th><th>তারিখ</th>
                  <th>নাম</th><th>সার্ভিস</th><th>দেশ/রোড</th>
                  <th className="num">মোট বিল</th>
                  <th className="num">আয়</th>
                  <th className="num">বাকি</th>
                  <th className="wrap">Adv:/ discu:</th>
                  <th className="num">খরচ/জমা</th>
                  <th className="num">ব্যালেন্স</th>
                </tr>
              </thead>
              <tbody>
                {printAscRows.map(({ it, running }, i) => {
                  const isIn = it.kind === "received";
                  const isHand = it.kind === "handover";
                  const r = it.row as Recv; const h = it.row as Hand; const e = it.row as Exp;
                  const amt = Number(isIn ? r.amount : isHand ? h.amount : e.amount);
                  const mdRecv = isIn && isMdReceivedMethod(r.method);
                  const name = isIn ? r.passenger_name : isHand ? `জমা → ${h.to_name}` : (e.purpose || e.category);
                  const svc = isIn && r.service_row_id ? svcMap[r.service_row_id] : undefined;
                  const service = isIn ? r.service_type : isHand ? "জমা" : "খরচ";
                  let region = "";
                  if (isIn && svc) {
                    if (r.service_table === "tickets") {
                      region = [svc.route, svc.airline].filter(Boolean).join(" · ");
                    } else if (r.service_table === "others") {
                      region = [svc.service_name, svc.airline, svc.route, svc.flight_date ? `✈ ${formatDate(svc.flight_date)}` : ""].filter(Boolean).join(" · ");
                    } else if (svc.country) {
                      region = svc.country;
                    }
                  }
                  const discAmt = isIn && svc ? Number(svc.discount ?? 0) : 0;
                  const grossBill = isIn && svc && typeof svc.sold === "number" ? svc.sold : null;
                  const totalBill = grossBill !== null ? grossBill : null;
                  const isAdvance = isIn && !!svc?.has_delivery && isAdvancePayment(r.entry_date, svc?.delivery_date);
                  // পূর্ববর্তী জমা/Discount: NOTE column only — calculation happens below explicitly.
                  const advLines: { text: string }[] = [];
                  let sumPrev = 0;
                  let lastAdvDate = "";
                  if (isIn && r.service_row_id) {
                    const curDate = r.entry_date;
                    const prior = received.filter(p =>
                      p.service_row_id === r.service_row_id &&
                      p.id !== r.id &&
                      (p.entry_date < curDate || (p.entry_date === curDate && p.id < r.id))
                    );
                    for (const p of prior) {
                      const pv = Number(p.amount || 0);
                      sumPrev += pv;
                      if (!lastAdvDate || p.entry_date > lastAdvDate) lastAdvDate = p.entry_date;
                    }
                    if (sumPrev > 0.005) advLines.push({ text: `${fmt(sumPrev)} (${formatDate(lastAdvDate)})` });
                  }
                  if (discAmt > 0.005) advLines.push({ text: `${fmt(discAmt)} Discount` });
                  // বাকি = মোট বিল − নগদ জমা − Discount
                  const due = totalBill !== null && isIn ? Math.max(0, totalBill - amt - sumPrev - discAmt) : null;
                  const cls = isHand ? "hand" : "out";
                  return (
                    <tr key={`p-${it.kind}-${(it.row as { id: string }).id}`} className={`row-tint-${i % 4}`}>
                      <td>{i + 1}</td>
                      <td>{formatDate(it.date)}</td>
                      <td className="wrap">{name}</td>
                      <td className="wrap">{service}{isIn && r.method ? ` · ${r.method}` : ""}</td>
                      <td className="wrap">{region}{mdRecv ? " · MD রিসিভ (ব্যালেন্সে নয়)" : ""}</td>
                      <td className="num">{totalBill !== null ? fmt(totalBill) : ""}</td>
                      <td className={`num ${mdRecv ? "hand" : "in"}`}>{isIn ? (mdRecv ? `(MD) ${fmt(amt)}` : `+ ${fmt(amt)}`) : ""}{isAdvance ? " (Adv)" : ""}</td>
                      <td className="num due">{due !== null && due > 0.005 ? fmt(due) : ""}</td>
                      <td className="wrap" style={{whiteSpace:"nowrap"}}>
                        {advLines.map((l, idx) => (
                          <div key={idx} style={{whiteSpace:"nowrap"}}>{l.text}</div>
                        ))}
                      </td>
                      <td className={`num ${cls}`}>{!isIn ? `− ${fmt(amt)}` : ""}</td>
                      <td className="num">{fmt(running)}</td>
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
              : <div>
                {fRecv.map((r, idx) => {
                  const svc = r.service_row_id ? svcMap[r.service_row_id] : undefined;
                  const bits: string[] = [];
                  if (svc) {
                    if (r.service_table === "tickets") {
                      if (svc.route) bits.push(svc.route);
                      if (svc.airline) bits.push(svc.airline);
                    } else if (r.service_table === "others") {
                      if (svc.service_name) bits.push(svc.service_name);
                      if (svc.airline) bits.push(svc.airline);
                      if (svc.route) bits.push(svc.route);
                      if (svc.flight_date) bits.push(`✈ ${formatDate(svc.flight_date)}`);
                    } else if (svc.country) {
                      bits.push(svc.country);
                    }
                  }
                  const mdRecv = isMdReceivedMethod(r.method);
                  const isAdvance = !!svc?.has_delivery && isAdvancePayment(r.entry_date, svc?.delivery_date);
                  return (
                    <div key={r.id} className={`row-tint-${idx % 4} flex items-start gap-3 p-3`}>
                      <div className={`shrink-0 h-9 w-9 rounded-full grid place-items-center border ${mdRecv ? "bg-sky-500/10 text-sky-600 border-sky-500/20" : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"}`}>
                        <ArrowDownLeft className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="font-semibold text-sm truncate">{r.passenger_name}</p>
                          <p className={`font-bold tabular-nums text-sm whitespace-nowrap ${mdRecv ? "text-sky-600" : "text-emerald-600"}`}>{isAdvance ? <><AdvanceBadge advance /> </> : null}+ {fmt(Number(r.amount))}</p>
                        </div>
                         <p className="text-xs text-muted-foreground break-words">
                           {r.service_type}{r.method ? <> · 💳 {r.method}</> : null}{bits.length > 0 && <> · {bits.join(" · ")}</>}
                         </p>
                         {mdRecv && (
                           <p className="text-[11px] text-sky-600 dark:text-sky-400 mt-0.5">MD রিসিভ — ব্যালেন্সে যোগ হয়নি</p>
                         )}
                       </div>
                       <ConfirmDeleteButton allowOwner onConfirm={() => deleteRecv(r.id)} description={`আয় ${r.receipt_id} ডিলেট করতে চান?`} />
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
              : <div>
                {fExp.map((e, idx) => {
                  return (
                  <div key={e.id} className={`row-tint-${idx % 4} flex items-start gap-3 p-3`}>
                    <div className="shrink-0 h-9 w-9 rounded-full grid place-items-center bg-amber-500/10 text-amber-600 border border-amber-500/20">
                      <Receipt className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-semibold text-sm truncate">{e.purpose || e.category}</p>
                        <p className="font-bold text-amber-600 tabular-nums text-sm whitespace-nowrap">− {fmt(Number(e.amount))}</p>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {e.category} · {formatDate(e.entry_date)} · <span className="font-mono">{e.expense_id}</span>
                      </p>
                      {e.remarks && <p className="text-xs text-muted-foreground/80 mt-0.5 truncate">{e.remarks}</p>}
                    </div>
                    <ConfirmDeleteButton allowOwner onConfirm={() => deleteExp(e.id)} description={`খরচ ${e.expense_id} ডিলেট করতে চান?`} />
                  </div>
                );
                })}
              </div>}
          </CardContent></Card>
        </TabsContent>

        {/* Handover */}
        <TabsContent value="handover" className="mt-3">
          <Card><CardContent className="p-0">
            {fHand.length === 0 ? <EmptyRow>এই সময়সীমায় কোনো জমা নেই</EmptyRow>
              : <div>
                {fHand.map((h, idx) => {
                  const submitted = isHandoverSubmitted(h);
                  const status = h.status ?? "approved";
                  const isApproved = status === "approved";
                  const isPending = status === "pending";
                  const isRejected = status === "rejected";

                  // Icon + Bengali label
                  let statusIcon = "📤";
                  let statusLabel = "এমডিকে পাঠানো হয়েছে";
                  let statusCls = "text-sky-700 dark:text-sky-300 bg-sky-500/10 border-sky-500/30";
                  if (isApproved) {
                    statusIcon = "✅";
                    statusLabel = "এমডি বুঝে নিয়েছেন";
                    statusCls = "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/30";
                  } else if (isRejected) {
                    statusIcon = "❌";
                    statusLabel = "এমডি ফেরত দিয়েছেন";
                    statusCls = "text-rose-700 dark:text-rose-300 bg-rose-500/10 border-rose-500/30";
                  } else if (isPending) {
                    statusIcon = "📤";
                    statusLabel = "এমডিকে পাঠানো হয়েছে";
                  }

                  // Approved details
                  const approvedAt = (h as Hand & { approved_at?: string | null }).approved_at;
                  const approvedTime = approvedAt
                    ? new Date(approvedAt).toLocaleString("en-GB", {
                        day: "2-digit", month: "2-digit", year: "numeric",
                        hour: "2-digit", minute: "2-digit", hour12: true,
                      })
                    : null;

                  return (
                  <div key={h.id} className={`row-tint-${idx % 4} flex items-start gap-3 p-3`}>
                    <div className="shrink-0 h-9 w-9 rounded-full grid place-items-center bg-sky-500/10 text-sky-600 border border-sky-500/20">
                      <Send className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-semibold text-sm truncate">{h.to_name}</p>
                        <p className="font-bold text-sky-600 tabular-nums text-sm whitespace-nowrap">− {fmt(Number(h.amount))}</p>
                      </div>
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                        <Banknote className="h-3 w-3" />{h.method} · {formatDate(h.entry_date)} · <span className="font-mono">{h.handover_id}</span>
                      </p>
                      <div className={`mt-1.5 inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-semibold ${statusCls}`}>
                        <span>{statusIcon}</span><span>{statusLabel}</span>
                      </div>
                      {isApproved && (
                        <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1 font-medium">
                          {approvedTime
                            ? <>তারিখ ও সময়: <b>{approvedTime}</b> · 👤 cash handover গ্রহীতা: <b>MD (Elias)</b></>
                            : <>👤 cash handover গ্রহীতা: <b>MD (Elias)</b></>}
                        </p>
                      )}
                      {h.remarks && <p className="text-xs text-muted-foreground/80 mt-0.5 truncate">{h.remarks}</p>}
                    </div>
                    <ConfirmDeleteButton allowOwner onConfirm={() => deleteHand(h.id)} description={`জমা ${h.handover_id} ডিলেট করতে চান?`} />
                  </div>
                );
                })}
              </div>}
          </CardContent></Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}
