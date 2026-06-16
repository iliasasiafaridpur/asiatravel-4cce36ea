import {
  ResponsiveContainer, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, ComposedChart, Area, Line, XAxis, YAxis, Legend,
} from "recharts";
import { TrendingUp, TrendingDown, Percent, Trophy, Medal, Award, Crown } from "lucide-react";
import { cn } from "@/lib/utils";

const PIE_COLORS = [
  "#67e8f9", // cyan-300
  "#6ee7b7", // emerald-300
  "#fdba74", // orange-300
  "#c4b5fd", // violet-300
  "#f0abfc", // fuchsia-300
  "#fcd34d", // amber-300
  "#cbd5e1", // slate-300
];

const CARD_TINTS = [
  "bg-cyan-500/24 border-cyan-400/40",
  "bg-emerald-500/24 border-emerald-400/40",
  "bg-orange-500/24 border-orange-400/40",
  "bg-violet-500/24 border-violet-400/40",
  "bg-fuchsia-500/24 border-fuchsia-400/40",
  "bg-amber-500/24 border-amber-400/40",
  "bg-slate-500/24 border-slate-400/40",
];

type NameValue = { name: string; value: number };

export interface DashboardChartsProps {
  isLoading: boolean;
  moduleFilter: string;
  monthlyTrend: { month: string; sold: number; received: number; due: number; collection: number }[];
  moduleBreakdown: { name: string; key: string; count: number; sold: number; received: number; due: number; collection: number; color: string }[];
  userReceived: { name: string; amount: number; count: number }[];
  userEntries: NameValue[];
  topGroup: { name: string; count: number; sold: number }[];
  cashByMethod: NameValue[];
}

const bdt = (n: number) => "৳ " + Math.round(n).toLocaleString();
const compact = (n: number) =>
  n >= 1e7 ? (n / 1e7).toFixed(1) + "Cr" : n >= 1e5 ? (n / 1e5).toFixed(1) + "L" : n >= 1e3 ? (n / 1e3).toFixed(0) + "k" : String(n);

/* ----------------------------- shared shells ----------------------------- */

function ChartCard({ title, subtitle, children, className, tint }: { title: string; subtitle?: string; children: React.ReactNode; className?: string; tint?: string }) {
  return (
    <div className={cn("rounded-xl border shadow-sm flex flex-col", tint ?? "bg-card border-border/60", className)}>
      <div className="p-4 pb-2">
        <h3 className="text-sm font-semibold leading-tight">{title}</h3>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="px-4 pb-4 flex-1 min-h-0">{children}</div>
    </div>
  );
}

function Empty({ loading, text }: { loading: boolean; text?: string }) {
  return (
    <div className="h-full min-h-[180px] flex items-center justify-center text-sm text-muted-foreground">
      {loading ? "লোড হচ্ছে..." : (text ?? "কোনো ডাটা নেই")}
    </div>
  );
}

/* ----------------------------- ranked list ------------------------------- */

const RANK_ICONS = [Crown, Medal, Award];

function RankList({
  items, format, accent,
}: {
  items: { label: string; value: number; sub?: string }[];
  format: (n: number) => string;
  accent: (i: number) => string;
}) {
  const max = Math.max(1, ...items.map((x) => x.value));
  return (
    <div className="h-full overflow-y-auto pr-1 space-y-2">
      {items.map((it, i) => {
        const Icon = RANK_ICONS[i];
        return (
          <div key={it.label + i} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 min-w-0">
                {Icon ? (
                  <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: accent(i) }} />
                ) : (
                  <span className="h-4 w-4 shrink-0 text-center text-[10px] font-bold text-muted-foreground">{i + 1}</span>
                )}
                <span className="truncate font-medium">{it.label}</span>
              </span>
              <span className="flex items-center gap-1.5 shrink-0">
                {it.sub && <span className="text-[10px] text-muted-foreground">{it.sub}</span>}
                <span className="font-semibold tabular-nums">{format(it.value)}</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-foreground/10 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${(it.value / max) * 100}%`, background: accent(i) }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------- trend tooltip ----------------------------- */

const TREND_LABELS: Record<string, string> = { sold: "বিক্রি", received: "রিসিভ", due: "বকেয়া" };

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number; color: string; payload?: { collection?: number } }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as { collection?: number } | undefined;
  return (
    <div className="rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-semibold mb-1">{label}</p>
      {payload.filter((p) => p.dataKey !== "collection").map((p) => (
        <p key={p.dataKey} className="flex items-center justify-between gap-3" style={{ color: p.color }}>
          <span>{TREND_LABELS[p.dataKey] ?? p.dataKey}</span>
          <span className="font-medium tabular-nums">{bdt(p.value)}</span>
        </p>
      ))}
      {row?.collection != null && (
        <p className="flex items-center justify-between gap-3 mt-1 pt-1 border-t border-border/40 text-muted-foreground">
          <span>কালেকশন রেট</span>
          <span className="font-medium tabular-nums">{row.collection}%</span>
        </p>
      )}
    </div>
  );
}

function TrendSummary({ data }: { data: DashboardChartsProps["monthlyTrend"] }) {
  const totSold = data.reduce((s, m) => s + m.sold, 0);
  const totRecv = data.reduce((s, m) => s + m.received, 0);
  const totDue = data.reduce((s, m) => s + m.due, 0);
  const rate = totSold > 0 ? Math.round((totRecv / totSold) * 100) : 0;
  const last = data[data.length - 1]?.sold ?? 0;
  const prev = data[data.length - 2]?.sold ?? 0;
  const growth = prev > 0 ? Math.round(((last - prev) / prev) * 100) : last > 0 ? 100 : 0;
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-2 text-[11px]">
      <span className="rounded-md bg-emerald-500/15 text-emerald-400 px-2 py-0.5">বিক্রি {bdt(totSold)}</span>
      <span className="rounded-md bg-cyan-500/15 text-cyan-300 px-2 py-0.5">রিসিভ {bdt(totRecv)}</span>
      <span className="rounded-md bg-rose-500/15 text-rose-300 px-2 py-0.5">বকেয়া {bdt(totDue)}</span>
      <span className="rounded-md bg-violet-500/15 text-violet-300 px-2 py-0.5 inline-flex items-center gap-1">
        <Percent className="h-3 w-3" /> কালেকশন {rate}%
      </span>
      <span className={cn("rounded-md px-2 py-0.5 inline-flex items-center gap-1", growth >= 0 ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-300")}>
        {growth >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {growth >= 0 ? "+" : ""}{growth}% MoM
      </span>
    </div>
  );
}

/* --------------------------- donut with center --------------------------- */

function DonutCard({
  title, subtitle, tint, data, isLoading, emptyText, colorAt,
}: {
  title: string; subtitle?: string; tint: string;
  data: { name: string; value: number }[]; isLoading: boolean; emptyText?: string;
  colorAt: (i: number) => string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <ChartCard title={title} subtitle={subtitle} tint={tint} className="h-64">
      {data.length === 0 ? <Empty loading={isLoading} text={emptyText} /> : (
        <div className="grid grid-cols-2 gap-2 h-full items-center">
          <div className="relative h-full min-h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={70} paddingAngle={2} stroke="none">
                  {data.map((_, i) => <Cell key={i} fill={colorAt(i)} />)}
                </Pie>
                <Tooltip formatter={(v: number, n: string) => [bdt(Number(v)), n]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[10px] text-muted-foreground">মোট</span>
              <span className="text-sm font-bold tabular-nums">{compact(total)}</span>
            </div>
          </div>
          <div className="h-full overflow-y-auto pr-1 space-y-1.5">
            {data.map((d, i) => (
              <div key={d.name + i} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: colorAt(i) }} />
                  <span className="truncate">{d.name}</span>
                </span>
                <span className="font-semibold tabular-nums shrink-0">{compact(d.value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </ChartCard>
  );
}

/* ------------------------------- main view ------------------------------- */

export default function DashboardCharts({
  isLoading, moduleFilter, monthlyTrend, moduleBreakdown, userReceived, userEntries, topGroup, cashByMethod,
}: DashboardChartsProps) {
  const topEntries = userEntries.slice(0, 8);
  return (
    <>
      {/* Trend + Smart module breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={cn("rounded-xl border shadow-sm lg:col-span-2", CARD_TINTS[0])}>
          <div className="p-4 pb-1"><h3 className="text-sm font-semibold">মাসিক বিক্রি · রিসিভ · বকেয়া</h3></div>
          {monthlyTrend.length === 0 ? (
            <div className="px-4 pb-4 h-64"><Empty loading={isLoading} /></div>
          ) : (
            <>
              <TrendSummary data={monthlyTrend} />
              <div className="px-2 pb-4 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={monthlyTrend} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="g-sold" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6ee7b7" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#6ee7b7" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="g-recv" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#67e8f9" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#67e8f9" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={compact} width={44} />
                    <Tooltip content={<TrendTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => TREND_LABELS[v] ?? v} />
                    <Area type="monotone" dataKey="sold" stroke="#6ee7b7" strokeWidth={2} fill="url(#g-sold)" name="sold" />
                    <Area type="monotone" dataKey="received" stroke="#67e8f9" strokeWidth={2} fill="url(#g-recv)" name="received" />
                    <Line type="monotone" dataKey="due" stroke="#fb7185" strokeWidth={2} dot={false} name="due" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>

        {/* Smart module breakdown: donut + per-module money & collection */}
        <div className={cn("rounded-xl border shadow-sm", CARD_TINTS[1])}>
          <div className="p-4 pb-2">
            <h3 className="text-sm font-semibold leading-tight">মডিউল অনুযায়ী এন্ট্রি</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">এন্ট্রি · বিক্রি · কালেকশন রেট</p>
          </div>
          <div className="px-4 pb-4">
            {moduleBreakdown.length === 0 ? <div className="h-56"><Empty loading={isLoading} /></div> : (
              <>
                <div className="relative h-28">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={moduleBreakdown} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={36} outerRadius={54} paddingAngle={2} stroke="none">
                        {moduleBreakdown.map((m, i) => <Cell key={i} fill={m.color} />)}
                      </Pie>
                      <Tooltip formatter={(v: number, n: string) => [`${v} এন্ট্রি`, n]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[10px] text-muted-foreground">মোট</span>
                    <span className="text-base font-bold tabular-nums">{moduleBreakdown.reduce((s, m) => s + m.count, 0)}</span>
                  </div>
                </div>
                <div className="mt-2 space-y-2">
                  {moduleBreakdown.map((m) => (
                    <div key={m.key} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: m.color }} />
                          <span className="truncate font-medium">{m.name}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">· {m.count}</span>
                        </span>
                        <span className="font-semibold tabular-nums shrink-0">{compact(m.sold)}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 flex-1 rounded-full bg-foreground/10 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${m.collection}%`, background: m.color }} />
                        </div>
                        <span className="text-[10px] tabular-nums text-muted-foreground w-9 text-right">{m.collection}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Per-user received + Per-user entries + Top groups + Cash methods */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="কে কত টাকা রিসিভ করেছে" subtitle="পরিমাণ অনুযায়ী র‍্যাংকিং" tint={CARD_TINTS[2]} className="h-64">
          {userReceived.length === 0 ? <Empty loading={isLoading} text="এখনো কেউ টাকা রিসিভ করেনি" /> : (
            <RankList
              items={userReceived.slice(0, 8).map((u) => ({ label: u.name, value: u.amount, sub: `${u.count} টি` }))}
              format={bdt}
              accent={(i) => PIE_COLORS[i % PIE_COLORS.length]}
            />
          )}
        </ChartCard>

        <ChartCard title="কে কত এন্ট্রি দিয়েছে" subtitle="এন্ট্রি সংখ্যা অনুযায়ী র‍্যাংকিং" tint={CARD_TINTS[3]} className="h-64">
          {topEntries.length === 0 ? <Empty loading={isLoading} text="ইউজার-ভিত্তিক ডাটা নেই" /> : (
            <RankList
              items={topEntries.map((u) => ({ label: u.name, value: u.value, sub: "এন্ট্রি" }))}
              format={(n) => String(n)}
              accent={(i) => PIE_COLORS[i % PIE_COLORS.length]}
            />
          )}
        </ChartCard>

        <ChartCard
          title={moduleFilter === "tickets" ? "টপ এয়ারলাইন্স" : "টপ দেশ / এয়ারলাইন্স"}
          subtitle="এন্ট্রি ও বিক্রি অনুযায়ী"
          tint={CARD_TINTS[4]}
          className="h-64"
        >
          {topGroup.length === 0 ? <Empty loading={isLoading} /> : (
            <RankList
              items={topGroup.map((g) => ({ label: g.name, value: g.count, sub: bdt(g.sold) }))}
              format={(n) => `${n} টি`}
              accent={(i) => PIE_COLORS[i % PIE_COLORS.length]}
            />
          )}
        </ChartCard>

        <DonutCard
          title="Accounts Methods"
          subtitle="মাধ্যম অনুযায়ী হস্তান্তর"
          tint={CARD_TINTS[5]}
          data={cashByMethod}
          isLoading={isLoading}
          emptyText="কোনো Accounts নেই"
          colorAt={(i) => PIE_COLORS[i % PIE_COLORS.length]}
        />
      </div>
    </>
  );
}
