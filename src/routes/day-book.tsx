import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { MODULES, formatDate } from "@/lib/modules";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search } from "lucide-react";

export const Route = createFileRoute("/day-book")({
  head: () => ({ meta: [{ title: "Day Book — সব এন্ট্রি" }] }),
  component: DayBookPage,
});

interface Entry {
  module: string; idLabel: string; id: string; date: string; passenger: string;
  amount: number; received: number;
}

function DayBookPage() {
  const [rows, setRows] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState<string>("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const all: Entry[] = [];
      const targets = MODULES.filter((m) => !["agents", "vendors"].includes(m.key));
      await Promise.all(targets.map(async (m) => {
        const { data } = await supabase.from(m.table as never).select("*").order("created_at", { ascending: false }).limit(200);
        for (const r of ((data as unknown) as Record<string, unknown>[] | null) ?? []) {
          const sold = Number(r.sold_price ?? r.total_bill ?? r.total_payable ?? 0);
          const recv = Number(r.received ?? r.received_amount ?? r.paid_amount ?? 0);
          all.push({
            module: m.label,
            idLabel: m.idColumn,
            id: String(r[m.idColumn] ?? ""),
            date: String(r.entry_date ?? r.created_at ?? ""),
            passenger: String(r.passenger_name ?? r.agent_name ?? r.vendor_name ?? "—"),
            amount: sold,
            received: recv,
          });
        }
      }));
      all.sort((a, b) => (a.date < b.date ? 1 : -1));
      setRows(all);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    let xs = rows;
    if (date) xs = xs.filter((r) => r.date.slice(0, 10) === date);
    const q = search.trim().toLowerCase();
    if (q) xs = xs.filter((r) => `${r.id} ${r.passenger} ${r.module}`.toLowerCase().includes(q));
    return xs;
  }, [rows, date, search]);

  const totals = useMemo(() => {
    const t = { sold: 0, recv: 0 };
    for (const r of filtered) { t.sold += r.amount; t.recv += r.received; }
    return t;
  }, [filtered]);

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Day Book</h1>
        <p className="text-sm text-muted-foreground">সব মডিউলের এন্ট্রি একসাথে — তারিখ অনুযায়ী ফিল্টার করুন</p>
      </div>

      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="sm:w-48" />
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Module / Passenger / ID..." className="pl-8" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-3 text-center">
            <div className="rounded-md border border-border p-2">
              <p className="text-[10px] text-muted-foreground">Total Entries</p>
              <p className="text-lg font-bold">{filtered.length}</p>
            </div>
            <div className="rounded-md border border-border p-2">
              <p className="text-[10px] text-muted-foreground">Total Sold</p>
              <p className="text-lg font-bold text-emerald-600">{totals.sold.toLocaleString()}</p>
            </div>
            <div className="rounded-md border border-border p-2">
              <p className="text-[10px] text-muted-foreground">Total Received</p>
              <p className="text-lg font-bold text-blue-600">{totals.recv.toLocaleString()}</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Passenger / Party</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">লোড হচ্ছে...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">কোনো এন্ট্রি নেই</TableCell></TableRow>
                ) : filtered.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.module}</TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{r.id}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.passenger}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.amount.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.received.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={r.amount - r.received > 0 ? "text-rose-500" : "text-emerald-600"}>
                        {(r.amount - r.received).toLocaleString()}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
