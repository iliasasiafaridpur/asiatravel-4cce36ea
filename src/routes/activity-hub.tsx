import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { Activity, CalendarIcon, RefreshCw, Search } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from "recharts";
import { format } from "date-fns";

export const Route = createFileRoute("/activity-hub")({
  head: () => ({ meta: [{ title: "Activity Hub — Travel Manager" }] }),
  component: ActivityHubPage,
});

type ActivityRow = {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  module: string;
  entity_id: string | null;
  entity_label: string | null;
  summary: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  amount: number | null;
  created_at: string;
};

type Profile = { user_id: string; full_name: string; role: string };

const MODULES = [
  { value: "tickets", label: "Air Ticket" },
  { value: "bmet", label: "BMET Card" },
  { value: "saudi_visa", label: "Saudi Visa" },
  { value: "kuwait_visa", label: "Kuwait Visa" },
  { value: "vendor_ledger", label: "Vendor Ledger" },
  { value: "agency_ledger", label: "Agency Ledger" },
  { value: "payment", label: "Payment Receipt" },
  { value: "handover", label: "Cash Handover" },
  { value: "expense", label: "Expense" },
  { value: "passenger", label: "Passenger" },
  { value: "agent", label: "Agent" },
  { value: "vendor", label: "Vendor" },
];

const ACTIONS = ["CREATED", "UPDATED", "DELETED", "PAYMENT_RECEIVED", "HANDOVER", "EXPENSE"];

const ACTION_STYLES: Record<string, string> = {
  CREATED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  UPDATED: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  DELETED: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  PAYMENT_RECEIVED: "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30",
  HANDOVER: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
  EXPENSE: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
};

const PAGE_SIZE = 50;

function startOf(range: "today" | "yesterday" | "week" | "all"): Date | null {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (range === "today") return d;
  if (range === "yesterday") { d.setDate(d.getDate() - 1); return d; }
  if (range === "week") { d.setDate(d.getDate() - 6); return d; }
  return null;
}
function endOf(range: "today" | "yesterday" | "week" | "all"): Date | null {
  if (range === "yesterday") {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }
  return null;
}

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function ActivityHubPage() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  // filters
  const [userId, setUserId] = useState<string>("all");
  const [module, setModule] = useState<string>("all");
  const [action, setAction] = useState<string>("all");
  const [range, setRange] = useState<"today" | "yesterday" | "week" | "all" | "custom">("week");
  const [customFrom, setCustomFrom] = useState<Date | undefined>();
  const [customTo, setCustomTo] = useState<Date | undefined>();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [live, setLive] = useState(true);

  // chart data (last 24h, all users — independent of feed filters)
  const [chartRows, setChartRows] = useState<ActivityRow[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // load profiles for user filter
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("profiles").select("user_id, full_name, role").order("full_name");
      setProfiles((data as Profile[]) ?? []);
    })();
  }, []);

  const dateFilter = useMemo(() => {
    if (range === "custom") return { from: customFrom, to: customTo };
    if (range === "all") return { from: null as Date | null, to: null as Date | null };
    return { from: startOf(range), to: endOf(range) };
  }, [range, customFrom, customTo]);

  const buildQuery = (offset: number) => {
    let q = supabase.from("activity_logs").select("*").order("created_at", { ascending: false });
    if (userId !== "all") q = q.eq("actor_id", userId);
    if (module !== "all") q = q.eq("module", module);
    if (action !== "all") q = q.eq("action", action);
    if (dateFilter.from) q = q.gte("created_at", dateFilter.from.toISOString());
    if (dateFilter.to) q = q.lt("created_at", dateFilter.to.toISOString());
    if (debounced) q = q.ilike("summary", `%${debounced}%`);
    return q.range(offset, offset + PAGE_SIZE - 1);
  };

  const load = async (reset = true) => {
    setLoading(true);
    const offset = reset ? 0 : rows.length;
    const { data, error } = await buildQuery(offset);
    if (!error) {
      const newRows = (data as ActivityRow[]) ?? [];
      setRows((prev) => (reset ? newRows : [...prev, ...newRows]));
      setHasMore(newRows.length === PAGE_SIZE);
    }
    setLoading(false);
  };

  useEffect(() => { void load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId, module, action, range, customFrom, customTo, debounced]);

  // chart data — last 24h
  const loadCharts = async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("activity_logs")
      .select("actor_name, created_at, action, module")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(2000);
    setChartRows(((data as unknown) as ActivityRow[]) ?? []);
  };
  useEffect(() => { void loadCharts(); }, []);

  // realtime
  useEffect(() => {
    if (!live) return;
    const ch = supabase
      .channel("activity_logs_rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_logs" }, (payload) => {
        const row = payload.new as ActivityRow;
        // Filter check
        if (userId !== "all" && row.actor_id !== userId) return;
        if (module !== "all" && row.module !== module) return;
        if (action !== "all" && row.action !== action) return;
        if (debounced && !row.summary.toLowerCase().includes(debounced.toLowerCase())) return;
        setRows((prev) => [row, ...prev]);
        setChartRows((prev) => [row, ...prev].slice(0, 2000));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [live, userId, module, action, debounced]);

  // chart aggregations
  const userChart = useMemo(() => {
    const todayStart = startOf("today")!.toISOString();
    const map = new Map<string, number>();
    for (const r of chartRows) {
      if (r.created_at < todayStart) continue;
      const k = r.actor_name || "Unknown";
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return Array.from(map, ([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [chartRows]);

  const hourChart = useMemo(() => {
    const todayStart = startOf("today")!;
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: `${String(h).padStart(2, "0")}:00`, count: 0 }));
    for (const r of chartRows) {
      const d = new Date(r.created_at);
      if (d < todayStart) continue;
      buckets[d.getHours()].count++;
    }
    return buckets;
  }, [chartRows]);

  // infinite scroll
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMore || loading) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) void load(false);
    }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loading, rows.length]);

  const refresh = () => { void load(true); void loadCharts(); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-lg flex items-center justify-center text-primary-foreground"
               style={{ background: "var(--gradient-hero)" }}>
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">Activity Hub</h1>
            <p className="text-xs text-muted-foreground">প্রতিটি অ্যাকশন এর লাইভ মনিটরিং</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={live ? "default" : "outline"}
            onClick={() => setLive((v) => !v)}
            className="gap-1.5"
          >
            <span className={cn("h-2 w-2 rounded-full", live ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground")} />
            {live ? "Live" : "Paused"}
          </Button>
          <Button size="sm" variant="outline" onClick={refresh} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">User Productivity (আজ)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              {userChart.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground">আজ কোনো অ্যাক্টিভিটি নেই</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={userChart} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={50} />
                    <YAxis fontSize={11} allowDecimals={false} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">System Traffic (গত ২৪ ঘণ্টা / ঘণ্টা ভিত্তিক)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={hourChart} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="hour" fontSize={10} tickLine={false} axisLine={false} interval={2} />
                  <YAxis fontSize={11} allowDecimals={false} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  />
                  <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-3">
          <div className="grid gap-2 grid-cols-2 md:grid-cols-6">
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger><SelectValue placeholder="User" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.user_id} value={p.user_id}>{p.full_name} ({p.role})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={module} onValueChange={setModule}>
              <SelectTrigger><SelectValue placeholder="Module" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modules</SelectItem>
                {MODULES.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger><SelectValue placeholder="Action" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                {ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={range} onValueChange={(v) => setRange(v as typeof range)}>
              <SelectTrigger><SelectValue placeholder="Date" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="week">Last 7 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="custom">Custom…</SelectItem>
              </SelectContent>
            </Select>
            {range === "custom" ? (
              <>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="justify-start font-normal">
                      <CalendarIcon className="h-3.5 w-3.5 mr-2" />
                      {customFrom ? format(customFrom, "dd MMM yyyy") : "From"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={customFrom} onSelect={setCustomFrom} initialFocus className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="justify-start font-normal">
                      <CalendarIcon className="h-3.5 w-3.5 mr-2" />
                      {customTo ? format(customTo, "dd MMM yyyy") : "To"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={customTo} onSelect={setCustomTo} initialFocus className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </>
            ) : (
              <div className="relative col-span-2">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search summary…" className="pl-8" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Feed */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Activity Timeline</CardTitle>
          <span className="text-xs text-muted-foreground">{rows.length} {hasMore ? "+" : ""} entries</span>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 && !loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              কোনো অ্যাক্টিভিটি পাওয়া যায়নি।
            </div>
          ) : (
            <ul className="divide-y">
              {rows.map((r, idx) => {
                const dt = new Date(r.created_at);
                const moduleLabel = MODULES.find((m) => m.value === r.module)?.label ?? r.module;
                return (
                  <li key={r.id} className={cn("flex gap-3 p-3 transition-colors hover:bg-muted/40", `row-tint-${idx % 6}`)}>
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarFallback className="text-xs font-semibold">{initials(r.actor_name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm">{r.actor_name || "System"}</span>
                        {r.actor_role && (
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">({r.actor_role})</span>
                        )}
                        <Badge variant="outline" className={cn("border text-[10px]", ACTION_STYLES[r.action] || "")}>
                          {r.action}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">{moduleLabel}</Badge>
                        {r.entity_id && (
                          <span className="text-[11px] text-muted-foreground font-mono">{r.entity_id}</span>
                        )}
                      </div>
                      <p className="text-sm mt-0.5 break-words">{r.summary}</p>
                      {r.changes && Object.keys(r.changes).length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {Object.entries(r.changes).slice(0, 4).map(([k, v]) => (
                            <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              <b>{k}:</b> {String(v.from ?? "∅")} → {String(v.to ?? "∅")}
                            </span>
                          ))}
                          {Object.keys(r.changes).length > 4 && (
                            <span className="text-[10px] text-muted-foreground">+{Object.keys(r.changes).length - 4} more</span>
                          )}
                        </div>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {format(dt, "dd MMM yyyy, hh:mm a")}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div ref={sentinelRef} />
          {loading && (
            <div className="py-4 text-center text-xs text-muted-foreground">লোড হচ্ছে…</div>
          )}
          {!hasMore && rows.length > 0 && (
            <div className="py-3 text-center text-[11px] text-muted-foreground">— শেষ —</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
