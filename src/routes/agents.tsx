import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ModulePage } from "@/components/ModulePage";
import { moduleByKey } from "@/lib/modules";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SettleModeBadge } from "@/components/SettleModeBadge";
import { NewPartyDialog } from "@/components/NewPartyDialog";
import { partySerialCode } from "@/lib/format";
import { cacheRead, isOffline } from "@/lib/offline-cache";

export const Route = createFileRoute("/agents")({
  head: () => ({ meta: [{ title: "Agent List — Travel Manager" }] }),
  component: AgentsPage,
});

interface Bal { agent_name: string; total_bill: number; total_received: number; balance_due: number; advance_balance: number; }

function AgentsPage() {
  const [bals, setBals] = useState<Bal[]>([]);
  const [modes, setModes] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, number | null>>({});
  const load = async () => {
    let data: unknown;
    let agents: unknown;
    if (isOffline()) {
      data = cacheRead<Bal[]>("bal_agent") ?? [];
      agents = cacheRead<{ name: string; settle_mode: string | null; serial_no: number | null }[]>("agents") ?? [];
    } else {
      const [balRes, agRes] = await Promise.all([
        supabase.rpc("get_agent_balances" as never),
        supabase.from("agents").select("name,settle_mode,serial_no").limit(5000),
      ]);
      data = balRes.data;
      agents = agRes.data;
    }
    const rows = (((data as unknown) as Bal[]) ?? []).filter((b) => String(b.agent_name ?? "").trim().toLowerCase() !== "self");
    const rank = (b: Bal) => (Number(b.advance_balance ?? 0) > 0 ? 0 : Number(b.balance_due) > 0 ? 1 : 2);
    rows.sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      const av = Number(a.advance_balance ?? 0) > 0 ? Number(a.advance_balance) : Number(a.balance_due);
      const bv = Number(b.advance_balance ?? 0) > 0 ? Number(b.advance_balance) : Number(b.balance_due);
      return bv - av;
    });
    setBals(rows);
    const map: Record<string, string> = {};
    const smap: Record<string, number | null> = {};
    for (const a of ((agents as unknown as { name: string; settle_mode: string | null; serial_no: number | null }[]) ?? [])) {
      if (a.name) {
        map[a.name] = a.settle_mode === "one_by_one" ? "one_by_one" : a.settle_mode === "total" ? "total" : "";
        smap[a.name] = a.serial_no ?? null;
      }
    }
    setModes(map);
    setSerials(smap);
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
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">প্রতিটি Agent এর Balance (Live)</CardTitle>
          <NewPartyDialog kind="agent" onCreated={() => void load()} />
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Agent</TableHead><TableHead>হিসাব ধরন</TableHead><TableHead className="text-right">Total Bill</TableHead><TableHead className="text-right">Received</TableHead><TableHead className="text-right">Balance Due</TableHead><TableHead className="text-right">Advance Balance</TableHead></TableRow></TableHeader>
              <TableBody>
                {bals.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">কোনো হিসাব নেই</TableCell></TableRow>
                  : bals.map((b, idx) => (
                    <TableRow key={b.agent_name} className={`row-tint-${idx % 4}`}>
                      <TableCell className="font-mono text-xs tabular-nums font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">{partySerialCode("agent", serials[b.agent_name] ?? (idx + 1))}</TableCell>
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
