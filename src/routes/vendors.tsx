import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ModulePage } from "@/components/ModulePage";
import { moduleByKey } from "@/lib/modules";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Eye, Wallet } from "lucide-react";
import { PartyProfileDrawer } from "@/components/PartyProfileDrawer";
import { SettleModeBadge } from "@/components/SettleModeBadge";
import { NewPartyDialog } from "@/components/NewPartyDialog";
import { partySerialCode } from "@/lib/format";
import { cacheRead, isOffline } from "@/lib/offline-cache";

export const Route = createFileRoute("/vendors")({
  head: () => ({ meta: [{ title: "Vendor List — Travel Manager" }] }),
  component: VendorsPage,
});

interface Bal { vendor_name: string; total_payable: number; total_paid: number; balance_due: number; advance_balance: number; }

function VendorsPage() {
  const [bals, setBals] = useState<Bal[]>([]);
  const [modes, setModes] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, number | null>>({});
  const [profileVendor, setProfileVendor] = useState<string | null>(null);
  const navigate = useNavigate();
  const load = async () => {
    let data: unknown;
    let vendors: unknown;
    if (isOffline()) {
      data = cacheRead<Bal[]>("bal_vendor") ?? [];
      vendors = cacheRead<{ name: string; settle_mode: string | null; serial_no: number | null }[]>("vendors") ?? [];
    } else {
      const [balRes, venRes] = await Promise.all([
        supabase.rpc("get_vendor_balances" as never),
        supabase.from("vendors").select("name,settle_mode,serial_no").limit(5000),
      ]);
      data = balRes.data;
      vendors = venRes.data;
    }
    const rows = ((data as unknown) as Bal[]) ?? [];
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
    for (const v of ((vendors as unknown as { name: string; settle_mode: string | null; serial_no: number | null }[]) ?? [])) {
      if (!v.name) continue;
      // Defensive against legacy duplicate rows: "one_by_one" must never be
      // overwritten by a sibling row's "total"/empty value.
      if (v.settle_mode === "one_by_one") map[v.name] = "one_by_one";
      else if (!map[v.name]) map[v.name] = v.settle_mode === "total" ? "total" : "";
      if (v.serial_no != null && smap[v.name] == null) smap[v.name] = v.serial_no;
    }
    setModes(map);
    setSerials(smap);
  };
  useEffect(() => {
    void load();
    const ch = supabase.channel("vendor_bal_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "vendor_ledger" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "vendors" }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">প্রতিটি Vendor এর Balance (Live)</CardTitle>
          <NewPartyDialog kind="vendor" onCreated={() => void load()} />
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Vendor</TableHead><TableHead>হিসাব ধরন</TableHead><TableHead className="text-right">Total Payable</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Balance Due</TableHead><TableHead className="text-right">Advance Balance</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {bals.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">কোনো হিসাব নেই</TableCell></TableRow>
                  : bals.map((b, idx) => (
                    <TableRow key={b.vendor_name} className={`row-tint-${idx % 4}`}>
                      <TableCell className="font-mono text-xs tabular-nums font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">{partySerialCode("vendor", serials[b.vendor_name] ?? (idx + 1))}</TableCell>
                      <TableCell className="font-medium">{b.vendor_name}</TableCell>
                      <TableCell><SettleModeBadge mode={modes[b.vendor_name]} /></TableCell>
                      <TableCell className="text-right tabular-nums">৳ {Number(b.total_payable).toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600">৳ {Number(b.total_paid).toLocaleString()}</TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${b.balance_due > 0 ? "text-rose-600" : "text-muted-foreground"}`}>৳ {Number(b.balance_due).toLocaleString()}</TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${Number(b.advance_balance) > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>৳ {Number(b.advance_balance ?? 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="বিস্তারিত / পেমেন্ট দেখুন"
                            onClick={() => setProfileVendor(b.vendor_name)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs"
                            title="পেমেন্ট দিন"
                            onClick={() => navigate({ to: "/vendor-ledger/$name", params: { name: b.vendor_name }, search: { pay: b.vendor_name } })}
                          >
                            <Wallet className="h-3.5 w-3.5" /> Pay
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <ModulePage module={moduleByKey("vendors")!} />
      <PartyProfileDrawer
        open={!!profileVendor}
        onOpenChange={(o) => !o && setProfileVendor(null)}
        kind="vendor"
        partyName={profileVendor}
      />
    </div>
  );
}
