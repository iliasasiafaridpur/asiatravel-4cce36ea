import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { MODULES, formatDate, statusBadgeClass } from "@/lib/modules";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie, Legend, AreaChart, Area,
} from "recharts";
import { DigitalClock } from "@/components/DigitalClock";
import {
  CalendarIcon, Plane, IdCard, Globe2, Users, Truck, ClipboardList,
  TrendingUp, TrendingDown, Wallet, FileText, ArrowRightLeft, BadgeDollarSign, Zap,
} from "lucide-react";

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
  "agency-ledger": Users, "vendor-ledger": Truck,
};

// Soft pastel colors matching the 7 stat cards palette
// (slate, emerald, cyan, orange, violet, fuchsia, amber)
const MODULE_COLORS: Record<string, string> = {
  tickets: "#67e8f9",       // cyan-300
  bmet: "#6ee7b7",          // emerald-300
  "saudi-visa": "#fdba74",  // orange-300
  "kuwait-visa": "#c4b5fd", // violet-300
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
  sold_price?: number;
  received?: number;
  cost_price?: number;
  entry_date?: string;
  created_at: string;
  created_by?: string | null;
  received_by?: string | null;
  entry_by?: string | null;
};

type Range = "all" | "today" | "month" | "year" | "custom";
const TARGET_MODULES = MODULES.filter((m) => ["tickets", "bmet", "saudi-visa", "kuwait-visa"].includes(m.key));
const DASHBOARD_CACHE_KEY = "dashboard_entries_v2";
const DASHBOARD_SELECTS: Record<string, string> = {
  tickets: "ticket_id,passenger_name,status,airline,sold_price,received,cost_price,entry_date,created_at,created_by,received_by,entry_by",
  bmet_cards: "bmet_id,passenger_name,status,country_name,sold_price,received_amount,cost_price,entry_date,created_at,created_by,received_by,entry_by",
  saudi_visas: "saudi_id,passenger_name,status,sold_price,received_amount,cost_price,entry_date,created_at,created_by,received_by,entry_by",
  kuwait_visas: "kuwait_id,passenger_name,status,sold_price,received,cost_price,entry_date,created_at,created_by,received_by,entry_by",
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
  const meName = displayName(profile, user);
  const qc = useQueryClient();
  const [range, setRange] = useState<Range>("month");
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [country, setCountry] = useState<string>("all");
  const refreshTimerRef = useRef<number | null>(null);

  // === Realtime: invalidate queries whenever ANY of these tables change ===
  useEffect(() => {
    const tables = ["tickets", "bmet_cards", "saudi_visas", "kuwait_visas", "cash_handovers", "cash_expenses", "agency_ledger", "vendor_ledger"];
    const refresh = () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      }, 300);
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
            .limit(100),
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
            sold_price: Number(r.sold_price ?? 0),
            received: Number((r.received ?? r.received_amount) ?? 0),
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
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id,full_name");
      return (data ?? []) as { user_id: string; full_name: string }[];
    },
  });

  const { data: cashTransfers = [] } = useQuery({
    queryKey: ["dashboard", "cash_handovers"],
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

  const { data: myAccount } = useQuery({
    queryKey: ["dashboard", "my_account", user?.id],
    enabled: !!user?.id,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_user_account" as never, { _user_id: user!.id } as never);
      if (error) throw error;
      return (((data as unknown) as Array<{ full_name: string; current_balance: number }> | null)?.[0] ?? null);
    },
  });

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
    const cost = filtered.reduce((s, r) => s + (r.cost_price ?? 0), 0);
    const due = sold - received;
    const profit = sold - cost;
    // Realized profit = Σ (profit_i / sold_i) * received_i  (cash-basis profit)
    const realizedProfit = filtered.reduce((s, r) => {
      const rSold = r.sold_price ?? 0;
      const rCost = r.cost_price ?? 0;
      const rRecv = r.received ?? 0;
      if (rSold <= 0) return s;
      const margin = (rSold - rCost) / rSold;
      return s + margin * rRecv;
    }, 0);
    return { total, sold, received, due, profit, realizedProfit };
  }, [filtered]);

  // === Per-user received ===
  const userReceived = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((r) => {
      if (!r.received_by || !r.received) return;
      const name = profileName(r.received_by) ?? "Unknown";
      m.set(name, (m.get(name) ?? 0) + (r.received ?? 0));
    });
    return Array.from(m.entries()).map(([name, amount]) => ({ name, amount }));
  }, [filtered, profiles]);

  // === Per-user entries ===
  const userEntries = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((r) => {
      if (!r.created_by) return;
      const name = profileName(r.created_by) ?? "Unknown";
      m.set(name, (m.get(name) ?? 0) + 1);
    });
    return Array.from(m.entries()).map(([name, value]) => ({ name, value }));
  }, [filtered, profiles]);

  // === Sold vs Received by month (Area chart) ===
  const monthlyTrend = useMemo(() => {
    const map = new Map<string, { month: string; sold: number; received: number }>();
    filtered.forEach((r) => {
      const d = new Date(r.entry_date || r.created_at);
      if (isNaN(d.getTime())) return;
      const k = format(d, "MMM-yy");
      const prev = map.get(k) ?? { month: k, sold: 0, received: 0 };
      prev.sold += r.sold_price ?? 0;
      prev.received += r.received ?? 0;
      map.set(k, prev);
    });
    return Array.from(map.values()).slice(-12);
  }, [filtered]);

  // === Pie: module-wise count ===
  const pieModule = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((r) => m.set(r.moduleLabel, (m.get(r.moduleLabel) ?? 0) + 1));
    return Array.from(m.entries()).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  // === Top countries / airlines ===
  const topGroup = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((r) => {
      const k = r.module === "bmet" ? r.country_name : r.airline;
      if (!k) return;
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count).slice(0, 6);
  }, [filtered]);

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
      <div className="rounded-2xl p-5 sm:p-6 flex flex-col gap-4 bg-card border border-border/60 shadow-sm">
        <div className="flex flex-col md:flex-row md:justify-between md:items-center w-full gap-6">
          <div className="flex flex-col min-w-0 md:basis-1/2 md:flex-1 w-full max-w-[25.5rem]">
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
          <div className="flex md:justify-end md:flex-shrink-0">
            <DigitalClock />
          </div>
        </div>
        <div className="flex justify-end">
          <Link to="/action-board">
            <Button size="sm" variant="outline" className="gap-1"><ClipboardList className="h-4 w-4" /> Action Board</Button>
          </Link>
        </div>
      </div>

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
                <Calendar mode="single" selected={customDate} onSelect={setCustomDate} initialFocus className={cn("p-3 pointer-events-auto")} />
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
      <div className="grid grid-cols-4 gap-3 auto-rows-fr">
        <GradientStat label="মোট এন্ট্রি" value={stats.total} icon={FileText} from="from-sky-500" to="to-blue-600" />
        <GradientStat label="মোট Sold" value={stats.sold} money icon={TrendingUp} from="from-emerald-500" to="to-teal-600" />
        <GradientStat label="মোট Received" value={stats.received} money icon={Wallet} from="from-blue-500" to="to-indigo-600" />
        <GradientStat label="মোট Due" value={stats.due} money icon={TrendingDown} from="from-rose-500" to="to-pink-600" />
        <GradientStat label="Estimated Profit" sublabel="আনুমানিক লাভ" value={stats.profit} money icon={BadgeDollarSign} from="from-violet-500" to="to-purple-600" />
        <GradientStat label="Realized Profit" sublabel="নগদ লাভ" value={Math.round(stats.realizedProfit)} money icon={BadgeDollarSign} from="from-fuchsia-500" to="to-pink-600" />
        <Link to="/accounts" className="block col-start-4 row-start-1 row-span-2">
          <GradientStat
            label={myAccount?.full_name ?? meName}
            sublabel="Current Balance"
            value={Number(myAccount?.current_balance ?? 0)}
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

      {/* Trend + Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="মাসিক বিক্রি ও রিসিভ (Trend)" className="lg:col-span-2" tint={CARD_TINTS[0]}>
          {monthlyTrend.length === 0 ? <Empty loading={isLoading} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyTrend}>
                <defs>
                  <linearGradient id="g-sold" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6ee7b7" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#6ee7b7" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="g-recv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#67e8f9" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#67e8f9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="sold" stroke="#6ee7b7" fill="url(#g-sold)" name="Sold" />
                <Area type="monotone" dataKey="received" stroke="#67e8f9" fill="url(#g-recv)" name="Received" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="মডিউল অনুযায়ী এন্ট্রি" tint={CARD_TINTS[1]}>
          {pieModule.length === 0 ? <Empty loading={isLoading} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieModule} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                  {pieModule.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* User stats + Top groups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Per-User Received Amount (কে কত টাকা রিসিভ করেছে)" tint={CARD_TINTS[2]}>
          {userReceived.length === 0 ? <Empty loading={isLoading} text="এখনো কেউ টাকা রিসিভ করেনি" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={userReceived}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                  {userReceived.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Per-User Entries (কে কত এন্ট্রি দিয়েছে)" tint={CARD_TINTS[3]}>
          {userEntries.length === 0 ? <Empty loading={isLoading} text="ইউজার-ভিত্তিক ডাটা নেই" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={userEntries} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                  {userEntries.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title={moduleFilter === "tickets" ? "Top Airlines" : "Top Countries"} tint={CARD_TINTS[4]}>
          {topGroup.length === 0 ? <Empty loading={isLoading} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topGroup} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} fill="#6ee7b7" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Accounts Methods" tint={CARD_TINTS[5]}>
          {cashSummary.byMethod.length === 0 ? <Empty loading={isLoading} text="কোনো Accounts নেই" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={cashSummary.byMethod} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                  {cashSummary.byMethod.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

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
                      <p className="text-xs text-muted-foreground"><Badge variant="secondary" className="mr-1">{c.method}</Badge>{formatDate(c.entry_date)}</p>
                    </div>
                    <span className="text-sm font-semibold text-emerald-600 tabular-nums whitespace-nowrap">৳ {Number(c.amount).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
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

function ChartCard({ title, children, className, tint }: { title: string; children: React.ReactNode; className?: string; tint?: string }) {
  return (
    <div className={cn("rounded-xl border shadow-sm", tint ?? "bg-card border-border/60", className)}>
      <div className="p-4 pb-2"><h3 className="text-sm font-semibold">{title}</h3></div>
      <div className="px-4 pb-4 h-64">{children}</div>
    </div>
  );
}

function Empty({ loading, text }: { loading: boolean; text?: string }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
      {loading ? "লোড হচ্ছে..." : (text ?? "কোনো ডাটা নেই")}
    </div>
  );
}
