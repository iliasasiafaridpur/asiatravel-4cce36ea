import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { MODULES, formatDate } from "@/lib/modules";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, RotateCcw } from "lucide-react";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { toast } from "sonner";

export const Route = createFileRoute("/day-book")({
  head: () => ({ meta: [{ title: "Day Book — সব এন্ট্রি" }] }),
  component: DayBookPage,
});

interface Entry {
  module: string; moduleKey: string; id: string; rowId: string; table: string; date: string;
  passenger: string; agent: string; vendor: string;
  status: string; receivedBy: string;
  amount: number; received: number;
}

function DayBookPage() {
  const [rows, setRows] = useState<Entry[]>([]);
  const [profilesMap, setProfilesMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Filters
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [receivedByFilter, setReceivedByFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: profs } = await supabase.from("profiles").select("user_id,full_name");
      const pm: Record<string, string> = {};
      for (const p of (profs as { user_id: string; full_name: string }[] | null) ?? []) pm[p.user_id] = p.full_name;
      setProfilesMap(pm);

      const all: Entry[] = [];
      const targets = MODULES.filter((m) => !["agents", "vendors"].includes(m.key));
      await Promise.all(targets.map(async (m) => {
        const { data } = await supabase.from(m.table as never).select("*")
          .order("created_at", { ascending: false }).limit(500);
        for (const r of ((data as unknown) as Record<string, unknown>[] | null) ?? []) {
          const sold = Number(r.sold_price ?? r.total_bill ?? r.total_payable ?? 0);
          const recv = Number(r.received ?? r.received_amount ?? r.paid_amount ?? 0);
          const rb = String(r.received_by ?? "");
          all.push({
            module: m.label, moduleKey: m.key,
            id: String(r[m.idColumn] ?? ""),
            rowId: String(r.id ?? ""),
            table: m.table,
            date: String(r.entry_date ?? r.created_at ?? ""),
            passenger: String(r.passenger_name ?? r.agent_name ?? r.vendor_name ?? "—"),
            agent: String(r.agency_sold ?? r.agent_name ?? ""),
            vendor: String(r.vendor_bought ?? r.vendor_name ?? ""),
            status: String(r.status ?? ""),
            receivedBy: rb ? (pm[rb] ?? "User") : "",
            amount: sold, received: recv,
          });
        }
      }));
      all.sort((a, b) => (a.date < b.date ? 1 : -1));
      setRows(all);
      setLoading(false);
    })();
  }, []);

  const opts = useMemo(() => {
    const set = (vals: string[]) => Array.from(new Set(vals.filter((v) => v && v.trim()))).sort();
    return {
      modules: set(rows.map((r) => r.moduleKey)),
      agents: set(rows.map((r) => r.agent)),
      vendors: set(rows.map((r) => r.vendor)),
      statuses: set(rows.map((r) => r.status)),
      receivers: set(rows.map((r) => r.receivedBy)),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    let xs = rows;
    if (startDate) xs = xs.filter((r) => r.date.slice(0, 10) >= startDate);
    if (endDate) xs = xs.filter((r) => r.date.slice(0, 10) <= endDate);
    if (moduleFilter !== "all") xs = xs.filter((r) => r.moduleKey === moduleFilter);
    if (agentFilter !== "all") xs = xs.filter((r) => r.agent === agentFilter);
    if (vendorFilter !== "all") xs = xs.filter((r) => r.vendor === vendorFilter);
    if (statusFilter !== "all") xs = xs.filter((r) => r.status === statusFilter);
    if (receivedByFilter !== "all") xs = xs.filter((r) => r.receivedBy === receivedByFilter);
    const q = search.trim().toLowerCase();
    if (q) xs = xs.filter((r) => `${r.id} ${r.passenger} ${r.module}`.toLowerCase().includes(q));
    return xs;
  }, [rows, startDate, endDate, moduleFilter, agentFilter, vendorFilter, statusFilter, receivedByFilter, search]);

  const totals = useMemo(() => {
    const t = { sold: 0, recv: 0 };
    for (const r of filtered) { t.sold += r.amount; t.recv += r.received; }
    return t;
  }, [filtered]);

  const reset = () => {
    setStartDate(""); setEndDate(""); setModuleFilter("all");
    setAgentFilter("all"); setVendorFilter("all");
    setStatusFilter("all"); setReceivedByFilter("all"); setSearch("");
  };

  const moduleLabel = (k: string) => MODULES.find((m) => m.key === k)?.label ?? k;

  const handleDelete = async (entry: Entry) => {
    if (!entry.rowId) return;
    const { error } = await supabase.from(entry.table as never).delete().eq("id", entry.rowId);
    if (error) { toast.error(error.message); return; }
    setRows((prev) => prev.filter((r) => !(r.table === entry.table && r.rowId === entry.rowId)));
    toast.success("✓ ডিলেট সম্পন্ন — সংশ্লিষ্ট হিসাবও সরে গেছে");
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Day Book</h1>
        <p className="text-sm text-muted-foreground">সব মডিউলের এন্ট্রি একসাথে — Advanced Filter</p>
      </div>

      <Card>
        <CardContent className="p-3 sm:p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div><Label className="text-xs">Start Date</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
            <div><Label className="text-xs">End Date</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
            <div>
              <Label className="text-xs">Service</Label>
              <Select value={moduleFilter} onValueChange={setModuleFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">সব Service</SelectItem>
                  {opts.modules.map((m) => <SelectItem key={m} value={m}>{moduleLabel(m)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Agent</Label>
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">সব Agent</SelectItem>
                  {opts.agents.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Vendor</Label>
              <Select value={vendorFilter} onValueChange={setVendorFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">সব Vendor</SelectItem>
                  {opts.vendors.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">সব Status</SelectItem>
                  {opts.statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Received By</Label>
              <Select value={receivedByFilter} onValueChange={setReceivedByFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">সবাই</SelectItem>
                  {opts.receivers.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button variant="outline" className="w-full gap-1" onClick={reset}>
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="ID / Passenger / Module..." className="pl-8" />
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border border-border p-2"><p className="text-[10px] text-muted-foreground">Total Entries</p><p className="text-lg font-bold">{filtered.length}</p></div>
            <div className="rounded-md border border-border p-2"><p className="text-[10px] text-muted-foreground">Total Sold</p><p className="text-lg font-bold text-emerald-600">{totals.sold.toLocaleString()}</p></div>
            <div className="rounded-md border border-border p-2"><p className="text-[10px] text-muted-foreground">Total Received</p><p className="text-lg font-bold text-blue-600">{totals.recv.toLocaleString()}</p></div>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead><TableHead>Service</TableHead>
                  <TableHead>ID</TableHead><TableHead>Passenger / Party</TableHead>
                  <TableHead>Agent</TableHead><TableHead>Status</TableHead>
                  <TableHead>Received By</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">লোড হচ্ছে...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">কোনো এন্ট্রি নেই</TableCell></TableRow>
                ) : filtered.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.module}</TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{r.id}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.passenger}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.agent || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.status || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{r.receivedBy || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.amount.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.received.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={r.amount - r.received > 0 ? "text-rose-500" : "text-emerald-600"}>
                        {(r.amount - r.received).toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <ConfirmDeleteButton
                        onConfirm={() => handleDelete(r)}
                        description={`${r.module} — ${r.id} (${r.passenger}) ডিলেট করলে এই ক্লায়েন্টের সকল হিসাব (Day Book, My Accounts, Ledger) থেকেও মুছে যাবে। নিশ্চিত?`}
                      />
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
