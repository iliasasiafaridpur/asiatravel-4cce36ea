import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ModulePage } from "@/components/ModulePage";
import { moduleByKey } from "@/lib/modules";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/vendors")({
  head: () => ({ meta: [{ title: "Vendor List — Travel Manager" }] }),
  component: VendorsPage,
});

interface Bal { vendor_name: string; total_payable: number; total_paid: number; balance_due: number; advance_balance: number; }

function VendorsPage() {
  const [bals, setBals] = useState<Bal[]>([]);
  const load = async () => {
    const { data } = await supabase.rpc("get_vendor_balances" as never);
    setBals(((data as unknown) as Bal[]) ?? []);
  };
  useEffect(() => {
    void load();
    const ch = supabase.channel("vendor_bal_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "vendor_ledger" }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">প্রতিটি Vendor এর Balance (Live)</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Vendor</TableHead><TableHead className="text-right">Total Payable</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Balance Due</TableHead></TableRow></TableHeader>
              <TableBody>
                {bals.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">কোনো হিসাব নেই</TableCell></TableRow>
                  : bals.map((b, idx) => (
                    <TableRow key={b.vendor_name} className={`row-tint-${idx % 6}`}>
                      <TableCell className="font-medium">{b.vendor_name}</TableCell>
                      <TableCell className="text-right tabular-nums">৳ {Number(b.total_payable).toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600">৳ {Number(b.total_paid).toLocaleString()}</TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${b.balance_due > 0 ? "text-rose-600" : "text-muted-foreground"}`}>৳ {Number(b.balance_due).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <ModulePage module={moduleByKey("vendors")!} />
    </div>
  );
}
