import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ModulePage } from "@/components/ModulePage";
import { moduleByKey } from "@/lib/modules";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/agents")({
  head: () => ({ meta: [{ title: "Agent List — Travel Manager" }] }),
  component: AgentsPage,
});

interface Bal { agent_name: string; total_bill: number; total_received: number; balance_due: number; }

function AgentsPage() {
  const [bals, setBals] = useState<Bal[]>([]);
  const load = async () => {
    const { data } = await supabase.rpc("get_agent_balances" as never);
    setBals(((data as unknown) as Bal[]) ?? []);
  };
  useEffect(() => {
    void load();
    const ch = supabase.channel("agent_bal_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "agency_ledger" }, () => void load())
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
              <TableHeader><TableRow><TableHead>Agent</TableHead><TableHead className="text-right">Total Bill</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Balance Due</TableHead></TableRow></TableHeader>
              <TableBody>
                {bals.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">কোনো হিসাব নেই</TableCell></TableRow>
                  : bals.map((b) => (
                    <TableRow key={b.agent_name}>
                      <TableCell className="font-medium">{b.agent_name}</TableCell>
                      <TableCell className="text-right tabular-nums">৳ {Number(b.total_bill).toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600">৳ {Number(b.total_received).toLocaleString()}</TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${b.balance_due > 0 ? "text-rose-600" : "text-muted-foreground"}`}>৳ {Number(b.balance_due).toLocaleString()}</TableCell>
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
