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

export default function DashboardCharts({
  isLoading, moduleFilter, monthlyTrend, pieModule, userReceived, userEntries, topGroup, cashByMethod,
}: DashboardChartsProps) {
  return (
    <>
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
