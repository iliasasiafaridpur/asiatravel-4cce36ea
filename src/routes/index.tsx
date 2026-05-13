import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { MODULES, formatDate, statusBadgeClass } from "@/lib/modules";
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

const MODULE_COLORS: Record<string, string> = {
  tickets: "hsl(217 91% 60%)",
  bmet: "hsl(160 84% 45%)",
  "saudi-visa": "hsl(27 96% 55%)",
  "kuwait-visa": "hsl(280 65% 60%)",
};

const PIE_COLORS = [
  "hsl(217 91% 60%)", "hsl(160 84% 45%)", "hsl(27 96% 55%)", "hsl(280 65% 60%)",
  "hsl(190 80% 50%)", "hsl(0 84% 60%)", "hsl(48 96% 53%)",
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
    return { total, sold, received, due, profit };
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
      <div
        className="rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-primary-foreground"
        style={{ background: "var(--gradient-hero)", boxShadow: "var(--shadow-glow)" }}
      >
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <Zap className="h-6 w-6" /> Smart Dashboard
          </h1>
          <p className="text-sm opacity-90 mt-1">রিয়েল-টাইম আপডেট • সব মডিউলের সম্পূর্ণ সারাংশ</p>
        </div>
        <div className="flex gap-2">
          <Link to="/action-board">
            <Button size="sm" variant="secondary" className="gap-1"><ClipboardList className="h-4 w-4" /> Action Board</Button>
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

      {/* Stats — gradient cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <GradientStat label="মোট এন্ট্রি" value={stats.total} icon={FileText} from="from-sky-500" to="to-blue-600" />
        <GradientStat label="মোট Sold" value={stats.sold} money icon={TrendingUp} from="from-emerald-500" to="to-teal-600" />
        <GradientStat label="মোট Received" value={stats.received} money icon={Wallet} from="from-blue-500" to="to-indigo-600" />
        <GradientStat label="মোট Due" value={stats.due} money icon={TrendingDown} from="from-rose-500" to="to-pink-600" />
        <GradientStat label="আনুমানিক লাভ" value={stats.profit} money icon={BadgeDollarSign} from="from-violet-500" to="to-purple-600" />
      </div>

      {/* Module shortcuts */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {TARGET_MODULES.map((m) => {
          const Icon = ICONS[m.key] ?? ClipboardList;
          const count = filtered.filter((r) => r.module === m.key).length;
          return (
            <Link key={m.key} to={`/${m.key}` as string}>
              <Card className="hover:shadow-lg transition-all hover:-translate-y-0.5 cursor-pointer">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                    <p className="text-xl font-bold mt-0.5">{count}</p>
                  </div>
                  <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ background: `${MODULE_COLORS[m.key]}22`, color: MODULE_COLORS[m.key] }}>
                    <Icon className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
        <Link to="/accounts">
          <Card className="hover:shadow-lg transition-all hover:-translate-y-0.5 cursor-pointer">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Accounts</p>
                <p className="text-xl font-bold mt-0.5">৳ {cashSummary.total.toLocaleString()}</p>
              </div>
              <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-amber-500/15 text-amber-600">
                <ArrowRightLeft className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Trend + Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="মাসিক বিক্রি ও রিসিভ (Trend)" className="lg:col-span-2">
          {monthlyTrend.length === 0 ? <Empty loading={isLoading} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyTrend}>
                <defs>
                  <linearGradient id="g-sold" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(160 84% 45%)" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="hsl(160 84% 45%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="g-recv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(217 91% 60%)" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="hsl(217 91% 60%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="sold" stroke="hsl(160 84% 45%)" fill="url(#g-sold)" name="Sold" />
                <Area type="monotone" dataKey="received" stroke="hsl(217 91% 60%)" fill="url(#g-recv)" name="Received" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="মডিউল অনুযায়ী এন্ট্রি">
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
        <ChartCard title="Per-User Received Amount (কে কত টাকা রিসিভ করেছে)">
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

        <ChartCard title="Per-User Entries (কে কত এন্ট্রি দিয়েছে)">
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

        <ChartCard title={moduleFilter === "tickets" ? "Top Airlines" : "Top Countries"}>
          {topGroup.length === 0 ? <Empty loading={isLoading} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topGroup} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} fill="hsl(160 84% 45%)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Accounts Methods">
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
        <Card>
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

        <Card>
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

function GradientStat({ label, value, icon: Icon, from, to, money }: {
  label: string; value: number; icon: React.ComponentType<{ className?: string }>;
  from: string; to: string; money?: boolean;
}) {
  return (
    <div className={cn("rounded-xl p-4 text-white shadow-lg bg-gradient-to-br", from, to)}>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide opacity-90">{label}</p>
          <p className="text-xl sm:text-2xl font-bold mt-1 tabular-nums truncate">
            {money && "৳ "}{value.toLocaleString()}
          </p>
        </div>
        <div className="h-10 w-10 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function ChartCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="h-64">{children}</CardContent>
    </Card>
  );
}

function Empty({ loading, text }: { loading: boolean; text?: string }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
      {loading ? "লোড হচ্ছে..." : (text ?? "কোনো ডাটা নেই")}
    </div>
  );
}
