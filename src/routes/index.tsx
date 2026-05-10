import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { MODULES, formatDate } from "@/lib/modules";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plane, IdCard, Globe2, StickyNote, Users, Truck, ClipboardList } from "lucide-react";

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
  manpower: StickyNote, "agency-ledger": Users, "vendor-ledger": Truck,
};

interface Counts { [key: string]: number }
interface Recent { module: string; id: string; name: string; date: string }

function DashboardPage() {
  const [counts, setCounts] = useState<Counts>({});
  const [recent, setRecent] = useState<Recent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const targets = MODULES.filter((m) => m.key !== "agents" && m.key !== "vendors");
      const c: Counts = {};
      const r: Recent[] = [];
      await Promise.all(targets.map(async (m) => {
        const { count } = await supabase.from(m.table as never).select("*", { count: "exact", head: true });
        c[m.key] = count ?? 0;
        const { data } = await supabase.from(m.table as never).select(`id,${m.idColumn},passenger_name,agent_name,vendor_name,created_at`).order("created_at", { ascending: false }).limit(3);
        for (const row of (data as unknown as Record<string, string>[] | null) ?? []) {
          r.push({
            module: m.label,
            id: String(row[m.idColumn] ?? ""),
            name: String(row.passenger_name ?? row.agent_name ?? row.vendor_name ?? "—"),
            date: String(row.created_at ?? ""),
          });
        }
      }));
      r.sort((a, b) => (a.date < b.date ? 1 : -1));
      setCounts(c);
      setRecent(r.slice(0, 10));
      setLoading(false);
    })();
  }, []);

  const statCards = useMemo(() => MODULES.filter((m) => m.key !== "agents" && m.key !== "vendors"), []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">আপনার travel agency-র সারসংক্ষেপ</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {statCards.map((m) => {
          const Icon = ICONS[m.key] ?? ClipboardList;
          return (
            <Link key={m.key} to={`/${m.key}` as string}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">{m.label}</p>
                      <p className="text-2xl font-bold mt-1">{loading ? "…" : (counts[m.key] ?? 0)}</p>
                    </div>
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">সাম্প্রতিক এন্ট্রি</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">লোড হচ্ছে...</p>
          ) : recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">এখনো কোনো এন্ট্রি নেই।</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((r, i) => (
                <li key={i} className="py-2 flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.module} • <span className="font-mono">{r.id}</span></p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(r.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
