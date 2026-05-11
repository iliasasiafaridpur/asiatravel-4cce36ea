import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
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
  PieChart, Pie, Legend,
} from "recharts";
import { CalendarIcon, Plane, IdCard, Globe2, Users, Truck, ClipboardList, TrendingUp, TrendingDown, Wallet, FileText } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Travel Manager" },
      { name: "description", content: "Travel agency overview: tickets, BMET, visas, ledgers." },
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
};

type Range = "all" | "today" | "month" | "year" | "custom";

const TARGET_MODULES = MODULES.filter((m) => ["tickets", "bmet", "saudi-visa", "kuwait-visa"].includes(m.key));

function DashboardPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>("month");
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [country, setCountry] = useState<string>("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const all: Row[] = [];
      await Promise.all(TARGET_MODULES.map(async (m) => {
        // Pick fields that exist; non-existent ones return undefined and are dropped.
        const cols = `id,${m.idColumn},passenger_name,status,country_name,airline,sold_price,received,received_amount,cost_price,entry_date,created_at`;
        const { data } = await supabase.from(m.table as never).select(cols).limit(1000);
        for (const r of (data as unknown as Record<string, unknown>[] | null) ?? []) {
          all.push({
            module: m.key,
            moduleLabel: m.label,
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
          });
        }
      }));
      setRows(all);
      setLoading(false);
    })();
  }, []);

  // Apply date range
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

  // Apply module + country filter
  const filtered = useMemo(() => {
    let xs = filteredByDate;
    if (moduleFilter !== "all") xs = xs.filter((r) => r.module === moduleFilter);
    if (country !== "all" && (moduleFilter === "bmet" || moduleFilter === "tickets" || moduleFilter === "all")) {
      xs = xs.filter((r) => {
        if (r.module === "bmet") return r.country_name === country;
        if (r.module === "tickets") return r.airline === country; // for tickets, "country" filter doubles as airline
        return moduleFilter === "all" ? true : false;
      });
    }
    return xs;
  }, [filteredByDate, moduleFilter, country]);

  // Stats
  const stats = useMemo(() => {
    const total = filtered.length;
    const sold = filtered.reduce((s, r) => s + (r.sold_price ?? 0), 0);
    const received = filtered.reduce((s, r) => s + (r.received ?? 0), 0);
    const due = sold - received;
    return { total, sold, received, due };
  }, [filtered]);

  // Pie: module-wise count
  const pieModule = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((r) => m.set(r.moduleLabel, (m.get(r.moduleLabel) ?? 0) + 1));
    return Array.from(m.entries()).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  // Bar: monthly entries
  const monthly = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((r) => {
      const d = new Date(r.entry_date || r.created_at);
      if (isNaN(d.getTime())) return;
      const k = format(d, "MMM-yy");
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    return Array.from(map.entries()).map(([month, count]) => ({ month, count })).slice(-12);
  }, [filtered]);

  // Pie: status distribution
  const statusPie = useMemo(() => {
    const m = new Map<string, number>();
    filtered.forEach((r) => {
      const s = r.status || "—";
      m.set(s, (m.get(s) ?? 0) + 1);
    });
    return Array.from(m.entries()).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  // Bar: top countries (BMET) or top airlines (Tickets)
  const topGroup = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((r) => {
      const k = r.module === "bmet" ? r.country_name : r.airline;
      if (!k) return;
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [filtered]);

  const recent = useMemo(() => [...filtered].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 8), [filtered]);

  // Country/airline options for filter
  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    filteredByDate.forEach((r) => {
      if (moduleFilter === "tickets" || moduleFilter === "all") {
        if (r.airline) set.add(r.airline);
      }
      if (moduleFilter === "bmet" || moduleFilter === "all") {
        if (r.country_name) set.add(r.country_name);
      }
    });
    return Array.from(set).sort();
  }, [filteredByDate, moduleFilter]);

  const showCountryFilter = moduleFilter === "bmet" || moduleFilter === "tickets" || moduleFilter === "all";

  const PIE_COLORS = ["hsl(217 91% 60%)", "hsl(160 84% 45%)", "hsl(27 96% 55%)", "hsl(280 65% 60%)", "hsl(190 80% 50%)", "hsl(0 84% 60%)", "hsl(48 96% 53%)"];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Smart Dashboard</h1>
          <p className="text-sm text-muted-foreground">তারিখ, মডিউল ও দেশ অনুযায়ী ফিল্টার করুন</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-3 sm:p-4 flex flex-wrap gap-2 items-center">
          <div className="flex flex-wrap gap-1">
            {(["today", "month", "year", "all", "custom"] as Range[]).map((r) => (
              <Button
                key={r}
                size="sm"
                variant={range === r ? "default" : "outline"}
                onClick={() => setRange(r)}
              >
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
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="মোট এন্ট্রি" value={stats.total} icon={FileText} tone="text-primary bg-primary/10" />
        <StatCard label="মোট Sold" value={stats.sold} money icon={TrendingUp} tone="text-emerald-500 bg-emerald-500/10" />
        <StatCard label="মোট Received" value={stats.received} money icon={Wallet} tone="text-blue-500 bg-blue-500/10" />
        <StatCard label="মোট Due" value={stats.due} money icon={TrendingDown} tone="text-rose-500 bg-rose-500/10" />
      </div>

      {/* Module shortcuts */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {TARGET_MODULES.map((m) => {
          const Icon = ICONS[m.key] ?? ClipboardList;
          const count = filtered.filter((r) => r.module === m.key).length;
          return (
            <Link key={m.key} to={`/${m.key}` as string}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                    <p className="text-xl font-bold mt-0.5">{count}</p>
                  </div>
                  <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ background: `${MODULE_COLORS[m.key]}20`, color: MODULE_COLORS[m.key] }}>
                    <Icon className="h-4 w-4" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="মডিউল অনুযায়ী এন্ট্রি (Pie)">
          {pieModule.length === 0 ? <Empty loading={loading} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieModule} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {pieModule.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="মাসিক এন্ট্রি (Bar)">
          {monthly.length === 0 ? <Empty loading={loading} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} fill="hsl(217 91% 60%)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Status Distribution">
          {statusPie.length === 0 ? <Empty loading={loading} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {statusPie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title={moduleFilter === "tickets" ? "Top Airlines" : "Top Countries (BMET)"}>
          {topGroup.length === 0 ? <Empty loading={loading} /> : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topGroup} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={100} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} fill="hsl(160 84% 45%)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Recent */}
      <Card>
        <CardHeader><CardTitle className="text-base">সাম্প্রতিক এন্ট্রি</CardTitle></CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">{loading ? "লোড হচ্ছে..." : "এই ফিল্টারে কোনো এন্ট্রি নেই।"}</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((r, i) => (
                <li key={i} className="py-2 flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{r.passenger_name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{r.moduleLabel} • <span className="font-mono">{r.id}</span></p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.status && <Badge variant="outline" className={statusBadgeClass(r.status)}>{r.status}</Badge>}
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(r.entry_date || r.created_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, tone, money }: {
  label: string; value: number; icon: React.ComponentType<{ className?: string }>; tone: string; money?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl sm:text-2xl font-bold mt-0.5 tabular-nums truncate">
            {money && "৳ "}{value.toLocaleString()}
          </p>
        </div>
        <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center shrink-0", tone)}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="h-64">{children}</CardContent>
    </Card>
  );
}

function Empty({ loading }: { loading: boolean }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
      {loading ? "লোড হচ্ছে…" : "কোনো ডেটা নেই"}
    </div>
  );
}
