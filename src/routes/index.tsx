import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { MODULES, formatDate, statusBadgeClass } from "@/lib/modules";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { useRole } from "@/hooks/useRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { lazy, Suspense } from "react";
import { DigitalClock } from "@/components/DigitalClock";

const DashboardCharts = lazy(() => import("@/components/DashboardCharts"));
import { isCashMethod, vendorExpenseHitsUserBalance, handoverReducesBalance } from "@/lib/payment-methods";
import {
  CalendarIcon, Plane, IdCard, Globe2, Users, Truck, ClipboardList,
  TrendingUp, TrendingDown, Wallet, FileText, ArrowRightLeft, BadgeDollarSign, Zap,
  BellRing, Search, StickyNote,
} from "lucide-react";
import { MasterSearch } from "@/components/MasterSearch";
import { NotePad } from "@/components/NotePad";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Asia Travel Manager" },
      { name: "description", content: "Travel agency overview: tickets, BMET, visas, ledgers, cash transfers." },
    ],
  }),
  component: DashboardPage,
});

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  tickets: Plane, bmet: IdCard, "saudi-visa": Globe2, "kuwait-visa": Globe2,
  other: ClipboardList, "agency-ledger": Users, "vendor-ledger": Truck,
};

// Soft pastel colors matching the 7 stat cards palette
// (slate, emerald, cyan, orange, violet, fuchsia, amber)
const MODULE_COLORS: Record<string, string> = {
  tickets: "#67e8f9",       // cyan-300
  bmet: "#6ee7b7",          // emerald-300
  "saudi-visa": "#fdba74",  // orange-300
  "kuwait-visa": "#c4b5fd", // violet-300
  other: "#f0abfc",         // fuchsia-300
};

const PIE_COLORS = [
  "#67e8f9", // cyan-300
  "#6ee7b7", // emerald-300
  "#fdba74", // orange-300
  "#c4b5fd", // violet-300
  "#f0abfc", // fuchsia-300
  "#fcd34d", // amber-300
  "#cbd5e1", // slate-300
];

// Tints for ChartCard / shortcut cards — same family as the 7 stat cards
const CARD_TINTS = [
  "bg-cyan-500/24 border-cyan-400/40",
  "bg-emerald-500/24 border-emerald-400/40",
  "bg-orange-500/24 border-orange-400/40",
  "bg-violet-500/24 border-violet-400/40",
  "bg-fuchsia-500/24 border-fuchsia-400/40",
  "bg-amber-500/24 border-amber-400/40",
  "bg-slate-500/24 border-slate-400/40",
];

type Row = {
  module: string;
  moduleLabel: string;
  id: string;
  passenger_name?: string;
  status?: string;
  country_name?: string;
  airline?: string;
  trip_road?: string;
  service_name?: string;
  sold_price?: number;
  received?: number;
  discount?: number;
  cost_price?: number;
  entry_date?: string;
  created_at: string;
  created_by?: string | null;
  received_by?: string | null;
  entry_by?: string | null;
};

type Range = "all" | "today" | "month" | "year" | "custom";
const TARGET_MODULES = MODULES.filter((m) => ["tickets", "bmet", "saudi-visa", "kuwait-visa", "other"].includes(m.key));
const DASHBOARD_CACHE_KEY = "dashboard_entries_v3";
const DASHBOARD_SELECTS: Record<string, string> = {
  tickets: "ticket_id,passenger_name,status,airline,trip_road,sold_price,received,discount_amount,cost_price,entry_date,created_at,created_by,received_by,entry_by",
  bmet_cards: "bmet_id,passenger_name,status,country_name,sold_price,received_amount,discount_amount,cost_price,entry_date,created_at,created_by,received_by,entry_by",
  saudi_visas: "saudi_id,passenger_name,status,sold_price,received_amount,discount_amount,cost_price,entry_date,created_at,created_by,received_by,entry_by",
  kuwait_visas: "kuwait_id,passenger_name,status,sold_price,received,discount_amount,cost_price,entry_date,created_at,created_by,received_by,entry_by",
  others: "other_id,passenger_name,status,service_name,airline,trip_road,sold_price,received_amount,discount_amount,cost_price,entry_date,created_at,created_by,received_by,entry_by",
};

function withTimeout<T>(promise: PromiseLike<T>, ms = 6500): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error("Request timed out")), ms);
    promise.then(
      (value) => { globalThis.clearTimeout(timer); resolve(value); },
      (error) => { globalThis.clearTimeout(timer); reject(error); },
    );
  });
}

function readDashboardCache(): Row[] | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(DASHBOARD_CACHE_KEY);
    const rows = raw ? JSON.parse(raw) : undefined;
    return Array.isArray(rows) ? rows : undefined;
  } catch {
    return undefined;
  }
}

function DashboardPage() {
  const { user, profile } = useCurrentUser();
  const { isAdmin, isMd } = useRole();
  const meName = displayName(profile, user);
  const qc = useQueryClient();
  const [range, setRange] = useState<Range>("month");
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [country, setCountry] = useState<string>("all");
  const [masterSearchOpen, setMasterSearchOpen] = useState(false);
  const [notePadOpen, setNotePadOpen] = useState(false);
  const refreshTimerRef = useRef<number | null>(null);

  // === Realtime: invalidate queries whenever ANY of these tables change ===
  useEffect(() => {
    const tables = ["tickets", "bmet_cards", "saudi_visas", "kuwait_visas", "payment_receipts", "cash_handovers", "cash_expenses", "agency_ledger", "vendor_ledger"];
    const refresh = () => {
      // Skip refetch while the tab is hidden — it refetches on mount anyway.
      if (typeof document !== "undefined" && document.hidden) return;
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      }, 1200);
    };
    const channel = tables.reduce(
      (ch, t) => ch.on("postgres_changes", { event: "*", schema: "public", table: t }, refresh),
      supabase.channel("dash_rt")
    ).subscribe();
    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [qc]);

  // === Main data query (realtime refetch only; no continuous polling loop) ===
  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["dashboard", "entries"],
    placeholderData: () => readDashboardCache(),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const all: Row[] = [];
      const results = await Promise.allSettled(TARGET_MODULES.map(async (m) => {
        const { data, error } = await withTimeout(
          supabase
            .from(m.table as never)
            .select(DASHBOARD_SELECTS[m.table] ?? "*")
            .order("created_at", { ascending: false })
            .limit(5000),
        );
        if (error) throw error;
        for (const r of (data as unknown as Record<string, unknown>[] | null) ?? []) {
          all.push({
            module: m.key, moduleLabel: m.label,
            id: String(r[m.idColumn] ?? ""),
            passenger_name: r.passenger_name as string | undefined,
            status: r.status as string | undefined,
            country_name: r.country_name as string | undefined,
            airline: r.airline as string | undefined,
            trip_road: r.trip_road as string | undefined,
            service_name: r.service_name as string | undefined,
            sold_price: Number(r.sold_price ?? 0),
            received: Number((r.received ?? r.received_amount) ?? 0),
            discount: Number(r.discount_amount ?? 0),
            cost_price: Number(r.cost_price ?? 0),
            entry_date: r.entry_date as string | undefined,
            created_at: String(r.created_at ?? ""),
            created_by: (r.created_by as string | null) ?? null,
            received_by: (r.received_by as string | null) ?? null,
            entry_by: (r.entry_by as string | null) ?? null,
          });
        }
      }));
      results.forEach((result, index) => {
        if (result.status === "rejected") console.warn(`[dashboard] ${TARGET_MODULES[index].table}`, result.reason);
      });
      try { localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(all)); } catch { /* ignore cache quota */ }
      return all;
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["dashboard", "profiles"],
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id,full_name");
      return (data ?? []) as { user_id: string; full_name: string }[];
    },
  });

  const { data: cashTransfers = [] } = useQuery({
    queryKey: ["dashboard", "cash_handovers"],
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data } = await supabase.from("cash_handovers")
        .select("id,entry_date,from_user,from_name,to_name,amount,method")
        .order("entry_date", { ascending: false })
        .limit(100);
      return (data ?? []) as Array<{
        id: string; entry_date: string; from_user: string | null;
        from_name: string | null; to_name: string | null; amount: number; method: string;
      }>;
    },
  });

  // Payment receipts — used for "who received how much" (cash per user vs MD other-method)
  // and for the Accounts Methods split (hand cash vs bank/bKash/etc).
  // Only fetch receipts within the selected range. Default "month" pulls a
  // small slice instead of the full 3000-row table → much faster cold-open.
  const receiptsBounds = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const now = new Date();
    if (range === "today") return { gte: ymd(now), lt: undefined as string | undefined };
    if (range === "month") return { gte: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), lt: undefined };
    if (range === "year") return { gte: ymd(new Date(now.getFullYear(), 0, 1)), lt: undefined };
    if (range === "custom" && customDate) {
      const start = new Date(customDate.getFullYear(), customDate.getMonth(), 1);
      const end = new Date(customDate.getFullYear(), customDate.getMonth() + 1, 1);
      return { gte: ymd(start), lt: ymd(end) };
    }
    return { gte: undefined, lt: undefined }; // "all"
  }, [range, customDate]);

  const { data: receipts = [] } = useQuery({
    queryKey: ["dashboard", "receipts", receiptsBounds.gte ?? "all", receiptsBounds.lt ?? ""],
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      let q = supabase.from("payment_receipts")
        .select("amount,method,source,received_by,received_by_name,entry_date")
        .order("entry_date", { ascending: false });
      if (receiptsBounds.gte) q = q.gte("entry_date", receiptsBounds.gte);
      if (receiptsBounds.lt) q = q.lt("entry_date", receiptsBounds.lt);
      const { data } = await q.limit(3000);
      return (data ?? []) as Array<{
        amount: number; method: string | null; source: string | null;
        received_by: string | null; received_by_name: string | null; entry_date: string;
      }>;
    },
  });


  // Robust per-user balance: query receipts/expenses/handovers directly.
  // Works even if RPC permissions/cache hiccup.
  const { data: myBalance } = useQuery({
    queryKey: ["dashboard", "my_balance", user?.id],
    enabled: !!user?.id,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const [recv, exp, hand] = await Promise.all([
        supabase.from("payment_receipts")
          .select("amount,entry_date,approval_status,source,method,handover_id")
          .eq("received_by", user!.id),
        supabase.from("cash_expenses").select("amount,entry_date,category,linked_source_table").eq("spent_by", user!.id),
        supabase.from("cash_handovers").select("amount,status").eq("from_user", user!.id),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      const receipts = (recv.data ?? []) as Array<{ amount: number; entry_date: string; approval_status: string; source: string | null; method: string | null; handover_id: string | null }>;
      const expenses = (exp.data ?? []) as Array<{ amount: number; entry_date: string; category: string | null; linked_source_table: string | null }>;
      const handovers = (hand.data ?? []) as Array<{ amount: number; status: string | null }>;
      const expenseHitsBalance = (row: { category: string | null; linked_source_table: string | null }) =>
        row.linked_source_table === "vendor_ledger" ? vendorExpenseHitsUserBalance(row.category) : true;
      const nonDiscount = receipts.filter((r) => r.source !== "discount" && (r.method ?? "").toLowerCase() !== "discount");
      const cashReceipts = nonDiscount.filter((r) => isCashMethod(r.method));
      const totalReceived = cashReceipts.reduce((s, r) => s + Number(r.amount || 0), 0);
      const totalReceivedToday = cashReceipts.filter((r) => r.entry_date === today).reduce((s, r) => s + Number(r.amount || 0), 0);
      const totalExpenses = expenses.reduce((s, r) => s + (expenseHitsBalance(r) ? Number(r.amount || 0) : 0), 0);
      const totalExpensesToday = expenses.filter((r) => r.entry_date === today).reduce((s, r) => s + (expenseHitsBalance(r) ? Number(r.amount || 0) : 0), 0);
      // Match /accounts "হাতে আছে": a handover reduces the shown cash balance as soon as it is submitted (pending), not only after MD approval.
      const totalHandedOver = handovers.filter((h) => handoverReducesBalance(h.status)).reduce((s, h) => s + Number(h.amount || 0), 0);
      const pendingHandover = nonDiscount.some((r) => r.approval_status === "pending_md" && r.handover_id);
      return {
        currentBalance: totalReceived - totalExpenses - totalHandedOver,
        todayBalance: totalReceivedToday - totalExpensesToday,
        pendingHandover,
      };
    },
  });

  // MD: count of pending handover requests
  const { data: pendingHandoverCount = 0 } = useQuery({
    queryKey: ["dashboard", "pending_handovers"],
    enabled: isMd,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { count } = await supabase
        .from("cash_handovers")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      return count ?? 0;
    },
  });

  const { data: officeCashBalance = 0 } = useQuery({
    queryKey: ["dashboard", "office_cash_balance", isAdmin],
    enabled: isAdmin,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const [receipts, handovers, expenses] = await Promise.all([
        supabase.from("payment_receipts").select("amount,approval_status,source,method"),
        supabase.from("cash_handovers").select("amount,status"),
        supabase.from("cash_expenses").select("amount,category,linked_source_table"),
      ]);
      const err = receipts.error || handovers.error || expenses.error;
      if (err) throw err;
      const totalReceived = ((receipts.data ?? []) as Array<{ amount: number; approval_status: string; source: string | null; method: string | null }>).reduce((sum, row) => {
        const isDiscount = row.source === "discount" || (row.method ?? "").toLowerCase() === "discount";
        return !isDiscount && isCashMethod(row.method) ? sum + Number(row.amount || 0) : sum;
      }, 0);
      const totalHandedOver = ((handovers.data ?? []) as Array<{ amount: number; status: string | null }>)
        .filter((row) => handoverReducesBalance(row.status))
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const totalExpenses = ((expenses.data ?? []) as Array<{ amount: number; category: string | null; linked_source_table: string | null }>).reduce((sum, row) => {
        const hitsCash = row.linked_source_table === "vendor_ledger" ? vendorExpenseHitsUserBalance(row.category) : true;
        return hitsCash ? sum + Number(row.amount || 0) : sum;
      }, 0);
      return totalReceived - totalHandedOver - totalExpenses;
    },
  });

  const shownCashBalance = isAdmin ? officeCashBalance : Number(myBalance?.currentBalance ?? 0);
  const shownCashLabel = isAdmin ? "Office Cash" : meName;
  const profileName = (uid?: string | null) =>
    profiles.find((p) => p.user_id === uid)?.full_name ?? null;

  // === Date filter ===
  const filteredByDate = useMemo(() => {
    const now = new Date();
    const inRange = (dStr: string) => {
      const d = new Date(dStr);
      if (range === "all") return true;
      if (range === "today") return d.toDateString() === now.toDateString();
      if (range === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      if (range === "year") return d.getFullYear() === now.getFullYear();
      if (range === "custom" && customDate) {
        return d.getMonth() === customDate.getMonth() && d.getFullYear() === customDate.getFullYear();
      }
      return true;
    };
    return rows.filter((r) => inRange(r.entry_date || r.created_at));
  }, [rows, range, customDate]);

  const filtered = useMemo(() => {
    let xs = filteredByDate;
    if (moduleFilter !== "all") xs = xs.filter((r) => r.module === moduleFilter);
    if (country !== "all" && (moduleFilter === "bmet" || moduleFilter === "tickets" || moduleFilter === "all")) {
      xs = xs.filter((r) => {
        if (r.module === "bmet") return r.country_name === country;
        if (r.module === "tickets") return r.airline === country;
        return moduleFilter === "all" ? true : false;
      });
    }
    return xs;
  }, [filteredByDate, moduleFilter, country]);

  // === Stats ===
  const stats = useMemo(() => {
    const total = filtered.length;
    const sold = filtered.reduce((s, r) => s + (r.sold_price ?? 0), 0);
    const received = filtered.reduce((s, r) => s + (r.received ?? 0), 0);
    const discount = filtered.reduce((s, r) => s + (r.discount ?? 0), 0);
    const cost = filtered.reduce((s, r) => s + (r.cost_price ?? 0), 0);
    const due = Math.max(0, sold - received - discount);
    const profit = filtered.reduce((s, r) => {
      const rRecv = r.received ?? 0;
      const rCost = r.cost_price ?? 0;
      // Profit hidden until vendor cost is entered
      if (rRecv <= 0 || rCost <= 0) return s;
      return s + (r.sold_price ?? 0) - (r.discount ?? 0) - rCost;
    }, 0);
    // Realized profit = Σ (profit_i / sold_i) * received_i  (cash-basis profit)
    const realizedProfit = filtered.reduce((s, r) => {
      const rSold = r.sold_price ?? 0;
      const rCost = r.cost_price ?? 0;
      const rDiscount = r.discount ?? 0;
      const rRecv = r.received ?? 0;
      if (rSold <= 0 || rCost <= 0) return s;
      const margin = (rSold - rDiscount - rCost) / rSold;
      return s + margin * rRecv;
    }, 0);
    return { total, sold, received, due, profit, realizedProfit };
  }, [filtered]);

  // === Receipts within the active date range (excludes discount rows) ===
  const filteredReceipts = useMemo(() => {
    const now = new Date();
    const inRange = (dStr: string) => {
      const d = new Date(dStr);
      if (range === "all") return true;
      if (range === "today") return d.toDateString() === now.toDateString();
      if (range === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      if (range === "year") return d.getFullYear() === now.getFullYear();
      if (range === "custom" && customDate) {
        return d.getMonth() === customDate.getMonth() && d.getFullYear() === customDate.getFullYear();
      }
      return true;
    };
    return receipts.filter((r) => {
      if (r.source === "discount" || (r.method ?? "").toLowerCase() === "discount") return false;
      return inRange(r.entry_date);
    });
  }, [receipts, range, customDate]);

  // Actual cash/payment received within the selected period (payment-date based).
  // This is the same source as the "কে কত টাকা রিসিভ করেছে" board and Accounts
  // Methods, so the top "মোট Received" card stays consistent with them — a
  // booking's `received` column is keyed to when the booking was created, which
  // wrongly showed ৳0 for "আজ" even when money was collected today on old dues.
  const periodReceived = useMemo(
    () => filteredReceipts.reduce((s, r) => s + Number(r.amount || 0), 0),
    [filteredReceipts],
  );


  // === Per-user received ===
  // Cash physically reaches the staff member → counted under that user.
  // Non-cash (bank / bKash / Nagad / cheque …) goes straight to MD →
  // aggregated under "MD (অন্যান্য মাধ্যম)".
  const userReceived = useMemo(() => {
    const m = new Map<string, { amount: number; count: number }>();
    let mdCashAmount = 0, mdCashCount = 0;       // method === "Md cash"
    let mdOtherAmount = 0, mdOtherCount = 0;     // bank / bKash / Nagad / cheque …
    filteredReceipts.forEach((r) => {
      const amt = Number(r.amount || 0);
      if (!amt) return;
      if (isCashMethod(r.method)) {
        const name = profileName(r.received_by) ?? r.received_by_name ?? "Unknown";
        const prev = m.get(name) ?? { amount: 0, count: 0 };
        prev.amount += amt;
        prev.count += 1;
        m.set(name, prev);
      } else if ((r.method ?? "").trim().toLowerCase() === "md cash") {
        mdCashAmount += amt;
        mdCashCount += 1;
      } else {
        mdOtherAmount += amt;
        mdOtherCount += 1;
      }
    });
    const list = Array.from(m.entries()).map(([name, v]) => ({ name, amount: v.amount, count: v.count }));
    // Sort staff (cash) first, then append the two MD buckets at the bottom.
    list.sort((a, b) => b.amount - a.amount);
    if (mdCashAmount > 0) list.push({ name: "MD Cash", amount: mdCashAmount, count: mdCashCount });
    if (mdOtherAmount > 0) list.push({ name: "MD ( Bank, Bkash, etc)", amount: mdOtherAmount, count: mdOtherCount });
    return list;
  }, [filteredReceipts, profiles]);

  // === Accounts methods: hand cash vs each non-cash method (bank/bKash/…) ===
  const accountsMethods = useMemo(() => {
    const m = new Map<string, number>();
    filteredReceipts.forEach((r) => {
      const amt = Number(r.amount || 0);
      if (!amt) return;
      const label = isCashMethod(r.method) ? "হ্যান্ড ক্যাশ" : (r.method?.trim() || "অন্যান্য মাধ্যম");
      m.set(label, (m.get(label) ?? 0) + amt);
    });
    return Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredReceipts]);

  // === Per-user entries (ranked) ===
  const userEntries = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((r) => {
      if (!r.created_by) return;
      const name = profileName(r.created_by) ?? "Unknown";
      m.set(name, (m.get(name) ?? 0) + 1);
    });
    return Array.from(m.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered, profiles]);

  // === Sold vs Received vs Due by month (smart trend) ===
  const monthlyTrend = useMemo(() => {
    const map = new Map<string, { month: string; sort: number; sold: number; received: number; due: number; collection: number }>();
    filtered.forEach((r) => {
      const d = new Date(r.entry_date || r.created_at);
      if (isNaN(d.getTime())) return;
      const k = format(d, "MMM-yy");
      const sort = d.getFullYear() * 12 + d.getMonth();
      const prev = map.get(k) ?? { month: k, sort, sold: 0, received: 0, due: 0, collection: 0 };
      const sold = r.sold_price ?? 0;
      const recv = r.received ?? 0;
      const disc = r.discount ?? 0;
      prev.sold += sold;
      prev.received += recv;
      prev.due += Math.max(0, sold - recv - disc);
      map.set(k, prev);
    });
    return Array.from(map.values())
      .sort((a, b) => a.sort - b.sort)
      .slice(-12)
      .map((m) => ({ ...m, collection: m.sold > 0 ? Math.round((m.received / m.sold) * 100) : 0 }));
  }, [filtered]);

  // === Smart module breakdown (count + money + collection rate) ===
  const moduleBreakdown = useMemo(() => {
    const m = new Map<string, { name: string; key: string; count: number; sold: number; received: number; due: number }>();
    filtered.forEach((r) => {
      const prev = m.get(r.module) ?? { name: r.moduleLabel, key: r.module, count: 0, sold: 0, received: 0, due: 0 };
      prev.count += 1;
      prev.sold += r.sold_price ?? 0;
      prev.received += r.received ?? 0;
      prev.due += Math.max(0, (r.sold_price ?? 0) - (r.received ?? 0) - (r.discount ?? 0));
      m.set(r.module, prev);
    });
    return Array.from(m.values())
      .map((x) => ({
        ...x,
        collection: x.sold > 0 ? Math.round((x.received / x.sold) * 100) : 0,
        color: MODULE_COLORS[x.key] ?? "#cbd5e1",
      }))
      .sort((a, b) => b.count - a.count);
  }, [filtered]);

  // === Generic grouping helper for service-level breakdowns ===
  const groupByKey = (rows: Row[], keyFn: (r: Row) => string | undefined | null) => {
    const map = new Map<string, { count: number; sold: number; received: number }>();
    rows.forEach((r) => {
      const k = keyFn(r);
      if (!k) return;
      const prev = map.get(k) ?? { count: 0, sold: 0, received: 0 };
      prev.count += 1;
      prev.sold += r.sold_price ?? 0;
      prev.received += r.received ?? 0;
      map.set(k, prev);
    });
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, count: v.count, sold: v.sold, received: v.received }))
      .sort((a, b) => b.count - a.count);
  };

  // === Service-based breakdown (adapts to the selected module) ===
  const serviceBreakdown = useMemo<import("@/components/DashboardCharts").ServiceBreakdown>(() => {
    if (moduleFilter === "tickets") {
      return {
        mode: "tickets",
        tripRoad: groupByKey(filtered, (r) => r.trip_road).slice(0, 8),
        airline: groupByKey(filtered, (r) => r.airline).slice(0, 8),
      };
    }
    if (moduleFilter === "bmet") {
      return { mode: "bmet", country: groupByKey(filtered, (r) => r.country_name).slice(0, 12) };
    }
    if (moduleFilter === "other") {
      return { mode: "service", service: groupByKey(filtered, (r) => r.service_name).slice(0, 12) };
    }
    if (moduleFilter === "saudi-visa" || moduleFilter === "kuwait-visa") {
      const label = TARGET_MODULES.find((m) => m.key === moduleFilter)?.label ?? moduleFilter;
      const count = filtered.length;
      const sold = filtered.reduce((s, r) => s + (r.sold_price ?? 0), 0);
      const received = filtered.reduce((s, r) => s + (r.received ?? 0), 0);
      const due = Math.max(0, sold - received - filtered.reduce((s, r) => s + (r.discount ?? 0), 0));
      return { mode: "single", label, count, sold, received, due, collection: sold > 0 ? Math.round((received / sold) * 100) : 0 };
    }
    return { mode: "all", modules: moduleBreakdown };
  }, [filtered, moduleFilter, moduleBreakdown]);

  // === Top countries (BMET) + airlines (tickets) ===
  const topGroup = useMemo(() => ({
    airlines: groupByKey(filtered.filter((r) => r.module === "tickets"), (r) => r.airline).slice(0, 6),
    countries: groupByKey(filtered.filter((r) => r.module === "bmet"), (r) => r.country_name).slice(0, 6),
  }), [filtered]);

  // === Cash transfer summary (within date range) ===
  const cashSummary = useMemo(() => {
    const now = new Date();
    const inRange = (dStr: string) => {
      const d = new Date(dStr);
      if (range === "all") return true;
      if (range === "today") return d.toDateString() === now.toDateString();
      if (range === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      if (range === "year") return d.getFullYear() === now.getFullYear();
      if (range === "custom" && customDate) {
        return d.getMonth() === customDate.getMonth() && d.getFullYear() === customDate.getFullYear();
      }
      return true;
    };
    const xs = cashTransfers.filter((c) => inRange(c.entry_date));
    const total = xs.reduce((s, c) => s + Number(c.amount), 0);
    const byMethod = new Map<string, number>();
    xs.forEach((c) => byMethod.set(c.method, (byMethod.get(c.method) ?? 0) + Number(c.amount)));
    return { total, count: xs.length, recent: xs.slice(0, 5), byMethod: Array.from(byMethod.entries()).map(([name, value]) => ({ name, value })) };
  }, [cashTransfers, range, customDate]);

  const recent = useMemo(
    () => [...filtered].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 8),
    [filtered]
  );

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    filteredByDate.forEach((r) => {
      if (moduleFilter === "tickets" || moduleFilter === "all") { if (r.airline) set.add(r.airline); }
      if (moduleFilter === "bmet" || moduleFilter === "all") { if (r.country_name) set.add(r.country_name); }
    });
    return Array.from(set).sort();
  }, [filteredByDate, moduleFilter]);

  const showCountryFilter = moduleFilter === "bmet" || moduleFilter === "tickets" || moduleFilter === "all";

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Hero header */}
      <div className="rounded-2xl p-3 sm:p-4 flex flex-col gap-2 bg-card border border-border/60 shadow-sm">
        <div className="flex flex-col md:flex-row md:justify-between md:items-center w-full gap-4">
          <div className="flex flex-col min-w-0 w-full max-w-[19rem] md:flex-shrink-0 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 sm:p-4 shadow-sm backdrop-blur-sm">
            <h1 className="sr-only">ASIA TRAVELS MANAGEMENT SYSTEM</h1>
            <svg
              viewBox="0 0 100 22"
              preserveAspectRatio="xMidYMid meet"
              className="block w-full text-foreground"
              aria-hidden="true"
            >
              <text
                x="0"
                y="11"
                textLength="100"
                lengthAdjust="spacingAndGlyphs"
                fontSize="13"
                fontWeight="900"
                fill="currentColor"
                style={{ fontFamily: "inherit" }}
              >
                ASIA TRAVELS
              </text>
              <text
                x="0"
                y="21"
                textLength="100"
                lengthAdjust="spacingAndGlyphs"
                fontSize="9"
                fontWeight="900"
                fill="currentColor"
                style={{ fontFamily: "inherit" }}
              >
                MANAGEMENT SYSTEM
              </text>
            </svg>
          </div>

          <div className="flex md:justify-center md:flex-1">
            <DigitalClock />
          </div>
          <div className="flex flex-col md:items-end md:flex-shrink-0 gap-2 w-full md:w-auto">
            <button
              type="button"
              onClick={() => setMasterSearchOpen(true)}
              className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 h-8 text-sm text-muted-foreground hover:bg-muted/60 transition-colors w-full md:w-64"
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="truncate">সব কিছু খুঁজুন…</span>
            </button>
            <div className="flex flex-wrap gap-2 md:justify-end">
              <Link to="/action-board">
                <Button size="sm" variant="outline" className="gap-1"><ClipboardList className="h-4 w-4" /> Action Board</Button>
              </Link>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setNotePadOpen(true)}>
                <StickyNote className="h-4 w-4" /> Note Pad
              </Button>
            </div>
          </div>
        </div>
      </div>

      {isMd && pendingHandoverCount > 0 && (
        <Card className="border-amber-400/40 bg-amber-500/10">
          <CardContent className="p-3 sm:p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-500/20 text-amber-600 flex items-center justify-center">
                <BellRing className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-sm">{pendingHandoverCount} টি স্টাফ ক্যাশ হ্যান্ডওভার অপেক্ষমাণ</p>
                <p className="text-xs text-muted-foreground">Approve করলে স্টাফের Current Balance ০ হবে।</p>
              </div>
            </div>
            <Link to="/md-panel">
              <Button size="sm">Review &amp; Approve</Button>
            </Link>
          </CardContent>
        </Card>
      )}


      {/* Filters */}
      <Card>
        <CardContent className="p-3 sm:p-4 flex flex-wrap gap-2 items-center">
          <div className="flex flex-wrap gap-1">
            {(["today", "month", "year", "all", "custom"] as Range[]).map((r) => (
              <Button key={r} size="sm" variant={range === r ? "default" : "outline"} onClick={() => setRange(r)}>
                {r === "today" ? "আজ" : r === "month" ? "এই মাস" : r === "year" ? "এই বছর" : r === "all" ? "সব" : "নির্দিষ্ট"}
              </Button>
            ))}
          </div>
          {range === "custom" && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("justify-start font-normal", !customDate && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {customDate ? format(customDate, "MMM yyyy") : "মাস বাছুন"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={customDate} onSelect={setCustomDate} defaultMonth={customDate} captionLayout="dropdown" startMonth={new Date(2015, 0)} endMonth={new Date(new Date().getFullYear() + 5, 11)} initialFocus className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
          )}
          <div className="h-6 w-px bg-border mx-1" />
          <Select value={moduleFilter} onValueChange={(v) => { setModuleFilter(v); setCountry("all"); }}>
            <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">সব মডিউল</SelectItem>
              {TARGET_MODULES.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {showCountryFilter && countryOptions.length > 0 && (
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue placeholder={moduleFilter === "tickets" ? "Airline" : "Country"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{moduleFilter === "tickets" ? "সব Airline" : "সব Country"}</SelectItem>
                {countryOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Live
          </span>
        </CardContent>
      </Card>

      {/* Stats — 3 cols × 2 rows of small cards + tall Current Balance card on right (same view for all viewports) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 auto-rows-fr">
        <GradientStat label="মোট এন্ট্রি" value={stats.total} icon={FileText} from="from-sky-500" to="to-blue-600" />
        <GradientStat label="মোট Sold" value={stats.sold} money icon={TrendingUp} from="from-emerald-500" to="to-teal-600" />
        <GradientStat label="মোট Received" sublabel="এই সময়ে গৃহীত" value={periodReceived} money icon={Wallet} from="from-blue-500" to="to-indigo-600" />
        <GradientStat label="মোট Due" value={stats.due} money icon={TrendingDown} from="from-rose-500" to="to-pink-600" />
        <GradientStat label="Estimated Profit" sublabel="আনুমানিক লাভ" value={stats.profit} money icon={BadgeDollarSign} from="from-violet-500" to="to-purple-600" />
        <GradientStat label="Realized Profit" sublabel="নগদ লাভ" value={Math.round(stats.realizedProfit)} money icon={BadgeDollarSign} from="from-fuchsia-500" to="to-pink-600" />
        <Link to="/accounts" className="block col-span-2 lg:col-span-1 lg:col-start-4 lg:row-start-1 lg:row-span-2">
          <GradientStat
            label={shownCashLabel}
            sublabel="Current Balance"
            value={shownCashBalance}
            money
            icon={Wallet}
            from="from-amber-500"
            to="to-orange-600"
            large
          />
        </Link>
      </div>

      {/* Module shortcuts */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {TARGET_MODULES.map((m, i) => {
          const Icon = ICONS[m.key] ?? ClipboardList;
          const count = filtered.filter((r) => r.module === m.key).length;
          const tint = CARD_TINTS[i % CARD_TINTS.length];
          return (
            <Link key={m.key} to={`/${m.key}` as string}>
              <div className={cn("rounded-xl border shadow-sm p-4 flex items-center justify-between hover:-translate-y-0.5 hover:shadow-lg transition-all cursor-pointer", tint)}>
                <div>
                  <p className="text-xs text-muted-foreground">{m.label}</p>
                  <p className="text-xl font-bold mt-0.5">{count}</p>
                </div>
                <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ background: `${MODULE_COLORS[m.key]}33`, color: MODULE_COLORS[m.key] }}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Charts (recharts is lazy-loaded so the dashboard paints fast) */}
      <Suspense fallback={<div className="h-64 rounded-xl border border-border/60 bg-card flex items-center justify-center text-sm text-muted-foreground">চার্ট লোড হচ্ছে...</div>}>
        <DashboardCharts
          isLoading={isLoading}
          moduleFilter={moduleFilter}
          monthlyTrend={monthlyTrend}
          serviceBreakdown={serviceBreakdown}
          userReceived={userReceived}
          userEntries={userEntries}
          topGroup={topGroup}
          accountsMethods={accountsMethods}
        />
      </Suspense>

      {/* Recent + Recent cash */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className={cn(CARD_TINTS[6])}>
          <CardHeader><CardTitle className="text-base">সাম্প্রতিক এন্ট্রি</CardTitle></CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">{isLoading ? "লোড হচ্ছে..." : "এই ফিল্টারে কোনো এন্ট্রি নেই।"}</p>
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((r, i) => (
                  <li key={i} className="py-2.5 flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{r.passenger_name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {r.moduleLabel} • <span className="font-mono">{r.id}</span>
                        {r.entry_by && <> • <span className="text-primary">{r.entry_by}</span></>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {r.status && <Badge variant="outline" className={statusBadgeClass(r.status)}>{r.status}</Badge>}
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(r.entry_date || r.created_at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className={cn(CARD_TINTS[1])}>
          <CardHeader><CardTitle className="text-base">সাম্প্রতিক Accounts</CardTitle></CardHeader>
          <CardContent>
            {cashSummary.recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">কোনো Accounts নেই</p>
            ) : (
              <ul className="divide-y divide-border">
                {cashSummary.recent.map((c) => (
                  <li key={c.id} className="py-2.5 flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{c.from_name ?? "—"} → {c.to_name ?? "—"}</p>
                      <div className="text-xs text-muted-foreground flex items-center"><Badge variant="secondary" className="mr-1">{c.method}</Badge>{formatDate(c.entry_date)}</div>
                    </div>
                    <span className="text-sm font-semibold text-emerald-600 tabular-nums whitespace-nowrap">৳ {Number(c.amount).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <MasterSearch open={masterSearchOpen} onOpenChange={setMasterSearchOpen} />
      <NotePad open={notePadOpen} onOpenChange={setNotePadOpen} />
    </div>
  );
}

function AutoFitText({ text, max, min = 10, className }: { text: string; max: number; min?: number; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const spanRef = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(max);
  useLayoutEffect(() => {
    const fit = () => {
      const c = containerRef.current, s = spanRef.current;
      if (!c || !s) return;
      let fs = max;
      s.style.fontSize = `${fs}px`;
      while (s.scrollWidth > c.clientWidth && fs > min) {
        fs -= 1;
        s.style.fontSize = `${fs}px`;
      }
      setSize(fs);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [text, max, min]);
  return (
    <div ref={containerRef} className={cn("w-full overflow-hidden", className)}>
      <span ref={spanRef} className="font-bold tabular-nums whitespace-nowrap inline-block" style={{ fontSize: size, lineHeight: 1.1 }}>
        {text}
      </span>
    </div>
  );
}

function GradientStat({ label, sublabel, value, icon: Icon, from, money, large }: {
  label: string; sublabel?: string; value: number; icon: React.ComponentType<{ className?: string }>;
  from: string; to?: string; money?: boolean; large?: boolean;
}) {
  const text = `${money ? "৳ " : ""}${value.toLocaleString()}`;
  // Explicit lookup so Tailwind JIT can detect full class strings.
  const palette: Record<string, { accent: string; border: string; bg: string }> = {
    "from-sky-500":     { accent: "text-slate-200",   border: "border-slate-500/40",  bg: "bg-slate-500/24" },
    "from-blue-500":    { accent: "text-cyan-300",    border: "border-cyan-400/40",   bg: "bg-cyan-500/24" },
    "from-emerald-500": { accent: "text-emerald-300", border: "border-emerald-400/40", bg: "bg-emerald-500/24" },
    "from-violet-500":  { accent: "text-violet-300",  border: "border-violet-400/40", bg: "bg-violet-500/24" },
    "from-fuchsia-500": { accent: "text-fuchsia-300", border: "border-fuchsia-400/40", bg: "bg-fuchsia-500/24" },
    "from-rose-500":    { accent: "text-orange-300",  border: "border-orange-400/40", bg: "bg-orange-500/24" },
    "from-amber-500":   { accent: "text-amber-300",   border: "border-amber-400/40",  bg: "bg-amber-500/24" },
  };
  const { accent, border, bg } = palette[from] ?? { accent: "text-foreground", border: "border-border/60", bg: "bg-card" };
  return (
    <div
      className={cn(
        "rounded-xl border shadow-sm min-w-0 h-full flex flex-col",
        bg,
        border,
        large ? "p-4 sm:p-5" : "p-4",
      )}
      title={text}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {large ? (
            <>
              <AutoFitText text={label} max={22} min={11} className="font-semibold uppercase tracking-wide text-muted-foreground" />
              {sublabel && (
                <div className="mt-1">
                  <AutoFitText text={sublabel} max={22} min={11} className="font-semibold uppercase tracking-wide text-muted-foreground/80" />
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-xs uppercase tracking-wide text-muted-foreground leading-tight truncate font-semibold">{label}</p>
              {sublabel && (
                <p className="text-[11px] tracking-wide text-muted-foreground/80 leading-tight truncate font-medium mt-0.5">{sublabel}</p>
              )}
            </>
          )}
        </div>
        <Icon className={cn(accent, "shrink-0", large ? "h-5 w-5" : "h-4 w-4")} />
      </div>
      <div className={cn("mt-auto pt-3", accent)}>
        <AutoFitText text={text} max={large ? 44 : 28} min={10} />
      </div>
    </div>
  );
}
