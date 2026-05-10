import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { MODULES, formatDate } from "@/lib/modules";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, Search } from "lucide-react";

export const Route = createFileRoute("/invoice")({
  head: () => ({ meta: [{ title: "Invoice — Travel Manager" }] }),
  component: InvoicePage,
});

interface Found {
  module: string; id: string; date: string; passenger: string; passport: string;
  service: string; amount: number; received: number;
}

function InvoicePage() {
  const [allEntries, setAllEntries] = useState<Found[]>([]);
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [agency, setAgency] = useState({ name: "Your Travel Agency", phone: "", address: "" });

  useEffect(() => {
    (async () => {
      const all: Found[] = [];
      const targets = MODULES.filter((m) => !["agents", "vendors", "agency-ledger", "vendor-ledger"].includes(m.key));
      await Promise.all(targets.map(async (m) => {
        const { data } = await supabase.from(m.table as never).select("*").order("created_at", { ascending: false }).limit(200);
        for (const r of ((data as unknown) as Record<string, unknown>[] | null) ?? []) {
          all.push({
            module: m.label,
            id: String(r[m.idColumn] ?? ""),
            date: String(r.entry_date ?? r.created_at ?? ""),
            passenger: String(r.passenger_name ?? "—"),
            passport: String(r.passport ?? ""),
            service: m.label,
            amount: Number(r.sold_price ?? 0),
            received: Number(r.received ?? r.received_amount ?? 0),
          });
        }
      }));
      setAllEntries(all);
    })();
  }, []);

  const filtered = useMemo(() => {
    let xs = allEntries;
    if (moduleFilter !== "all") xs = xs.filter((e) => e.module === moduleFilter);
    const q = search.trim().toLowerCase();
    if (q) xs = xs.filter((e) => `${e.id} ${e.passenger} ${e.passport}`.toLowerCase().includes(q));
    return xs.slice(0, 50);
  }, [allEntries, moduleFilter, search]);

  const selected = allEntries.find((e) => e.id === selectedId);

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Invoice</h1>
          <p className="text-sm text-muted-foreground">কোনো এন্ট্রি সিলেক্ট করে invoice প্রিন্ট করুন</p>
        </div>
        {selected && (
          <Button onClick={() => window.print()} className="gap-2">
            <Printer className="h-4 w-4" /> Print
          </Button>
        )}
      </div>

      <Card className="print:hidden">
        <CardContent className="p-3 sm:p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label>Agency Name</Label>
              <Input value={agency.name} onChange={(e) => setAgency({ ...agency, name: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={agency.phone} onChange={(e) => setAgency({ ...agency, phone: e.target.value })} className="mt-1.5" />
            </div>
            <div>
              <Label>Address</Label>
              <Input value={agency.address} onChange={(e) => setAgency({ ...agency, address: e.target.value })} className="mt-1.5" />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Select value={moduleFilter} onValueChange={setModuleFilter}>
              <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">সব Module</SelectItem>
                {MODULES.filter((m) => !["agents", "vendors", "agency-ledger", "vendor-ledger"].includes(m.key))
                  .map((m) => <SelectItem key={m.key} value={m.label}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ID / Passenger / Passport..." className="pl-8" />
            </div>
          </div>
          <ul className="max-h-64 overflow-auto rounded-md border divide-y divide-border">
            {filtered.length === 0 && <li className="p-3 text-sm text-muted-foreground">কোনো এন্ট্রি নেই</li>}
            {filtered.map((e) => (
              <li key={e.id}>
                <button onClick={() => setSelectedId(e.id)} className={`w-full text-left p-2.5 text-sm hover:bg-accent ${selectedId === e.id ? "bg-accent" : ""}`}>
                  <span className="font-mono text-xs">{e.id}</span> · <span className="font-medium">{e.passenger}</span> · <span className="text-muted-foreground">{e.module}</span>
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {selected && (
        <Card className="print:shadow-none print:border-0">
          <CardContent className="p-6 sm:p-10 bg-card">
            <div className="flex justify-between items-start border-b border-border pb-4 mb-6">
              <div>
                <h2 className="text-2xl font-bold">{agency.name}</h2>
                {agency.phone && <p className="text-sm text-muted-foreground">📞 {agency.phone}</p>}
                {agency.address && <p className="text-sm text-muted-foreground">{agency.address}</p>}
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Invoice</p>
                <p className="font-mono font-bold">{selected.id}</p>
                <p className="text-xs text-muted-foreground mt-1">{formatDate(selected.date)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <p className="text-xs uppercase text-muted-foreground">Bill To</p>
                <p className="font-semibold">{selected.passenger}</p>
                {selected.passport && <p className="text-sm">Passport: {selected.passport}</p>}
              </div>
              <div className="text-right">
                <p className="text-xs uppercase text-muted-foreground">Service</p>
                <p className="font-semibold">{selected.service}</p>
              </div>
            </div>
            <table className="w-full mb-6 border border-border">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left p-2 text-sm">Description</th>
                  <th className="text-right p-2 text-sm">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border">
                  <td className="p-2">{selected.service} — {selected.passenger}</td>
                  <td className="p-2 text-right tabular-nums">{selected.amount.toLocaleString()}</td>
                </tr>
                <tr className="border-t border-border">
                  <td className="p-2 text-right text-muted-foreground">Received</td>
                  <td className="p-2 text-right tabular-nums">{selected.received.toLocaleString()}</td>
                </tr>
                <tr className="border-t border-border font-bold">
                  <td className="p-2 text-right">Due</td>
                  <td className="p-2 text-right tabular-nums">{(selected.amount - selected.received).toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs text-center text-muted-foreground border-t border-border pt-4">
              Thank you for your business.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
