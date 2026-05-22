import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { STATUSES, statusStyle, formatDate, type Status } from "@/lib/passengers";
import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Users, Clock, Loader2, CheckCircle2, XCircle } from "lucide-react";

type Row = {
  passenger_id: string; passenger_name: string; passport: string;
  status: string; created_at: string;
};

const statusIcon: Record<Status, React.ElementType> = {
  Pending: Clock, Processing: Loader2, Done: CheckCircle2, Cancelled: XCircle,
};

export function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["passengers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("passengers")
        .select("passenger_id,passenger_name,passport,status,created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Row[];
    },
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = { total: 0 };
    STATUSES.forEach((s) => (c[s] = 0));
    (data ?? []).forEach((r) => { c.total++; c[r.status] = (c[r.status] ?? 0) + 1; });
    return c;
  }, [data]);

  const monthly = useMemo(() => {
    const map = new Map<string, number>();
    (data ?? []).forEach((r) => {
      const k = formatDate(r.created_at).slice(3); // MMM-YYYY
      map.set(k, (map.get(k) ?? 0) + 1);
    });
    return Array.from(map.entries()).slice(0, 6).reverse().map(([month, count]) => ({ month, count }));
  }, [data]);

  const recent = (data ?? []).slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">ড্যাশবোর্ড</h2>
        <p className="text-sm text-muted-foreground">সব প্যাসেঞ্জার এক নজরে</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="মোট" value={counts.total} icon={Users} accent="bg-primary/10 text-primary" />
        {STATUSES.map((s) => {
          const Icon = statusIcon[s];
          return (
            <StatCard
              key={s}
              label={s}
              value={counts[s] ?? 0}
              icon={Icon}
              accent={statusStyle[s]}
            />
          );
        })}
      </div>

      <Card className="p-4 sm:p-6">
        <h3 className="text-sm font-semibold mb-4">মাসিক এন্ট্রি</h3>
        <div className="h-56">
          {monthly.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {isLoading ? "লোড হচ্ছে…" : "কোনো ডাটা নেই"}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="month" tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} />
                <YAxis tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    color: "var(--color-foreground)",
                  }}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {monthly.map((_, i) => <Cell key={i} fill="var(--color-primary)" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <Card className="p-4 sm:p-6">
        <h3 className="text-sm font-semibold mb-4">সাম্প্রতিক এন্ট্রি</h3>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">কোনো এন্ট্রি নেই</p>
        ) : (
          <div className="divide-y divide-border">
            {recent.map((r) => (
              <div key={r.passenger_id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.passenger_name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{r.passenger_id} • {formatDate(r.created_at)}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-md border whitespace-nowrap ${statusStyle[r.status as Status] ?? ""}`}>
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

const cardTint: Record<string, { bg: string; ring: string }> = {
  "মোট":       { bg: "linear-gradient(180deg,#1e3a5f,#0f1f3a)", ring: "#3b82f6" },     // royal navy
  Pending:    { bg: "linear-gradient(180deg,#78350f,#451a03)", ring: "#f59e0b" },     // amber/crimson
  Processing: { bg: "linear-gradient(180deg,#1e3a8a,#172554)", ring: "#60a5fa" },     // deep blue
  Done:       { bg: "linear-gradient(180deg,#064e3b,#022c22)", ring: "#10b981" },     // emerald
  Cancelled:  { bg: "linear-gradient(180deg,#7f1d1d,#450a0a)", ring: "#ef4444" },     // crimson
};

function StatCard({ label, value, icon: Icon, accent }: { label: string; value: number; icon: React.ElementType; accent: string }) {
  const tint = cardTint[label];
  const style = tint
    ? { background: tint.bg, boxShadow: `0 4px 22px -10px ${tint.ring}88, inset 0 0 0 1px ${tint.ring}40` }
    : { background: "var(--gradient-card)", boxShadow: "var(--shadow-card)" };
  return (
    <Card className="p-4 relative overflow-hidden text-white" style={style}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs opacity-80">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        <div className={`p-2 rounded-lg border ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </Card>
  );
}
