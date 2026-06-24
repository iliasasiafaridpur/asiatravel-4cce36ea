import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ModulePage } from "@/components/ModulePage";
import { moduleByKey } from "@/lib/modules";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SettleModeBadge } from "@/components/SettleModeBadge";

export const Route = createFileRoute("/agents")({
  head: () => ({ meta: [{ title: "Agent List — Travel Manager" }] }),
  component: AgentsPage,
});

interface Bal { agent_name: string; total_bill: number; total_received: number; balance_due: number; advance_balance: number; }

function AgentsPage() {
  const [bals, setBals] = useState<Bal[]>([]);
  const [modes, setModes] = useState<Record<string, string>>({});
  const load = async () => {
    const [{ data }, { data: agents }] = await Promise.all([
      supabase.rpc("get_agent_balances" as never),
      supabase.from("agents").select("name,settle_mode").limit(5000),
    ]);
    setBals(((data as unknown) as Bal[]) ?? []);
    const map: Record<string, string> = {};
    for (const a of ((agents as unknown as { name: string; settle_mode: string | null }[]) ?? [])) {
      if (a.name) map[a.name] = a.settle_mode === "one_by_one" ? "one_by_one" : a.settle_mode === "total" ? "total" : "";
    }
    setModes(map);
  };
  useEffect(() => {
    void load();
    const ch = supabase.channel("agent_bal_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "agency_ledger" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">প্রতিটি Agent এর Balance (Live)</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Agent</TableHead><TableHead>হিসাব ধরন</TableHead><TableHead className="text-right">Total Bill</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Balance Due</TableHead><TableHead className="text-right">Advance Balance</TableHead></TableRow></TableHeader>
              <TableBody>
                {bals.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">কোনো হিসাব নেই</TableCell></TableRow>
                  : bals.map((b, idx) => (
                    <TableRow key={b.agent_name} className={`row-tint-${idx % 4}`}>
                      <TableCell className="font-medium">{b.agent_name}</TableCell>
                      <TableCell><SettleModeBadge mode={modes[b.agent_name]} /></TableCell>
                      <TableCell className="text-right tabular-nums">৳ {Number(b.total_bill).toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600">৳ {Number(b.total_received).toLocaleString()}</TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${b.balance_due > 0 ? "text-rose-600" : "text-muted-foreground"}`}>৳ {Number(b.balance_due).toLocaleString()}</TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${Number(b.advance_balance) > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>৳ {Number(b.advance_balance ?? 0).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <ModulePage module={moduleByKey("agents")!} />
    </div>
  );
}
