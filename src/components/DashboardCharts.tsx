import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie, Legend, ComposedChart, Area, Line,
} from "recharts";
import { TrendingUp, TrendingDown, Percent } from "lucide-react";
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
  pieModule: NameValue[];
  userReceived: { name: string; amount: number }[];
  userEntries: NameValue[];
  topGroup: { name: string; count: number }[];
  cashByMethod: NameValue[];
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

const bdt = (n: number) => "৳ " + Math.round(n).toLocaleString();
const compact = (n: number) =>
  n >= 1e7 ? (n / 1e7).toFixed(1) + "Cr" : n >= 1e5 ? (n / 1e5).toFixed(1) + "L" : n >= 1e3 ? (n / 1e3).toFixed(0) + "k" : String(n);

const TREND_LABELS: Record<string, string> = { sold: "বিক্রি", received: "রিসিভ", due: "বকেয়া" };

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number; color: string }[]; label?: string }) {
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

export default function DashboardCharts({
  isLoading, moduleFilter, monthlyTrend, pieModule, userReceived, userEntries, topGroup, cashByMethod,
}: DashboardChartsProps) {
  return (
    <>
      {/* Trend + Pie */}
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
          {cashByMethod.length === 0 ? <Empty loading={isLoading} text="কোনো Accounts নেই" /> : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={cashByMethod} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                  {cashByMethod.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </>
  );
}
