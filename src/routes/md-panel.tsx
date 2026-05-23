import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/useRole";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ShieldCheck, CheckCircle2, XCircle, ChevronDown, ChevronRight,
  Clock, History, Wallet, Hourglass, Repeat, Info, User2, Search,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/modules";

export const Route = createFileRoute("/md-panel")({
  head: () => ({ meta: [{ title: "MD Cash Control Panel" }] }),
  component: MdPanelPage,
});

type Handover = {
  id: string;
  handover_id: string;
  entry_date: string;
  closing_date: string | null;
  from_user: string | null;
  from_name: string | null;
  submitted_amount: number | null;
  confirmed_amount: number | null;
  amount: number;
  status: string;
  remarks: string | null;
  created_at: string;
};

type Receipt = {
  id: string;
  receipt_id: string;
  entry_date: string;
  passenger_name: string;
  amount: number;
  method: string;
  service_type: string;
  service_table: string | null;
  service_row_id: string | null;
  ref_id: string | null;
  approval_status: string;
  received_by: string | null;
  received_by_name: string | null;
  handover_id: string | null;
  source: string;
};

type ServiceInfo = {
  table: string;
  id: string;
  country: string | null;
  vendor: string | null;
  passport: string | null;
  sold_price: number;
};

const fmt = (n: number) => `৳ ${(Number(n) || 0).toLocaleString()}`;

const SERVICE_TABLES = [
  { table: "saudi_visas", country: () => "Saudi Arabia", vendorField: "vendor_bought", soldField: "sold_price" },
  { table: "kuwait_visas", country: () => "Kuwait", vendorField: "vendor_bought", soldField: "sold_price" },
  { table: "bmet_cards", country: "country_name", vendorField: "vendor_bought", soldField: "sold_price" },
  { table: "tickets", country: "trip_road", vendorField: "vendor_bought", soldField: "sold_price" },
  { table: "agency_ledger", country: "country_route", vendorField: "agent_name", soldField: "total_bill" },
] as const;

function MdPanelPage() {
  const { isMd, loading: roleLoading } = useRole();
  const { user, loading: userLoading } = useCurrentUser();

  const [pending, setPending] = useState<Handover[]>([]);
  const [all, setAll] = useState<Handover[]>([]);
  const [allReceipts, setAllReceipts] = useState<Receipt[]>([]);
  const [serviceMap, setServiceMap] = useState<Record<string, ServiceInfo>>({});
  const [paidByService, setPaidByService] = useState<Record<string, number>>({});
  const [receiptsByHandover, setReceiptsByHandover] = useState<Record<string, Receipt[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [openLedger, setOpenLedger] = useState<string | null>(null);
  const [confirmAmt, setConfirmAmt] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const todayStr = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate, setToDate] = useState(todayStr);
  const [staffFilter, setStaffFilter] = useState<string>("all");
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const enrichServiceInfo = useCallback(async (receipts: Receipt[]) => {
    const byTable: Record<string, Set<string>> = {};
    for (const r of receipts) {
      if (!r.service_table || !r.service_row_id) continue;
      byTable[r.service_table] ??= new Set();
      byTable[r.service_table].add(r.service_row_id);
    }
    const map: Record<string, ServiceInfo> = {};
    await Promise.all(
      SERVICE_TABLES.map(async (cfg) => {
        const ids = byTable[cfg.table];
        if (!ids || ids.size === 0) return;
        const cols = ["id", "passport"];
        if (typeof cfg.country === "string") cols.push(cfg.country);
        cols.push(cfg.vendorField, cfg.soldField);
        const { data } = await supabase
          .from(cfg.table as never)
          .select(cols.join(","))
          .in("id", Array.from(ids));
        for (const row of (data ?? []) as Array<Record<string, unknown>>) {
          map[`${cfg.table}:${row.id as string}`] = {
            table: cfg.table,
            id: row.id as string,
            country: typeof cfg.country === "function"
              ? cfg.country()
              : (row[cfg.country] as string | null) ?? null,
            vendor: (row[cfg.vendorField] as string | null) ?? null,
            passport: (row.passport as string | null) ?? null,
            sold_price: Number(row[cfg.soldField] ?? 0),
          };
        }
      })
    );
    return map;
  }, []);

  const reload = useCallback(async () => {
    const [{ data: pendingData }, { data: allData }, { data: recData }] = await Promise.all([
      supabase
        .from("cash_handovers")
        .select("id,handover_id,entry_date,closing_date,from_user,from_name,submitted_amount,confirmed_amount,amount,status,remarks,created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("cash_handovers")
        .select("id,handover_id,entry_date,closing_date,from_user,from_name,submitted_amount,confirmed_amount,amount,status,remarks,created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("payment_receipts")
        .select("id,receipt_id,entry_date,passenger_name,amount,method,service_type,service_table,service_row_id,ref_id,approval_status,received_by,received_by_name,handover_id,source")
        .not("source", "eq", "discount")
        .not("method", "ilike", "discount")
        .order("entry_date", { ascending: false })
        .limit(500),
    ]);

    const allHv = (pendingData ?? []) as Handover[];
    const histHv = (allData ?? []) as Handover[];
    const receipts = (recData ?? []) as Receipt[];

    // Fetch receipts linked to any handover (pending + recent) for grouping
    const handoverIds = [...new Set([...allHv, ...histHv].map((h) => h.id))];
    let linked: Receipt[] = [];
    if (handoverIds.length) {
      const { data: linkedData } = await supabase
        .from("payment_receipts")
        .select("id,receipt_id,entry_date,passenger_name,amount,method,service_type,service_table,service_row_id,ref_id,approval_status,received_by,received_by_name,handover_id,source")
        .in("handover_id", handoverIds);
      linked = (linkedData ?? []) as Receipt[];
    }

    // Aggregate all paid (approved + pending) per service_row_id for dues calc
    const paid: Record<string, number> = {};
    for (const r of receipts) {
      if (!r.service_row_id) continue;
      const k = `${r.service_table}:${r.service_row_id}`;
      paid[k] = (paid[k] ?? 0) + Number(r.amount || 0);
    }

    // Group linked receipts by handover
    const grouped: Record<string, Receipt[]> = {};
    for (const r of linked) {
      if (!r.handover_id) continue;
      (grouped[r.handover_id] ??= []).push(r);
    }

    // Enrich service info from linked + recent receipts
    const enrichTargets = [...linked, ...receipts];
    const svcMap = await enrichServiceInfo(enrichTargets);

    setPending(allHv);
    setAll(histHv);
    setAllReceipts(receipts);
    setReceiptsByHandover(grouped);
    setPaidByService(paid);
    setServiceMap(svcMap);
    setLoading(false);
  }, [enrichServiceInfo]);

  useEffect(() => {
    if (!user?.id) return;
    void reload();
    const ch = supabase
      .channel("md_panel_v2")
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_handovers" }, () => void reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_receipts" }, () => void reload())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user?.id, reload]);

  // Filter dropdowns: staff list, country list (derived)
  const staffOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const h of all) if (h.from_user) set.set(h.from_user, h.from_name ?? "Staff");
    return Array.from(set.entries());
  }, [all]);
  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const k in serviceMap) if (serviceMap[k].country) set.add(serviceMap[k].country!);
    return Array.from(set).sort();
  }, [serviceMap]);

  const inDateRange = (d: string) => d >= fromDate && d <= toDate;

  const filteredHistory = useMemo(() => {
    return all.filter((h) => {
      const d = h.closing_date || h.entry_date;
      if (!inDateRange(d)) return false;
      if (staffFilter !== "all" && h.from_user !== staffFilter) return false;
      if (countryFilter !== "all") {
        const rcs = receiptsByHandover[h.id] ?? [];
        const hit = rcs.some((r) => {
          const info = r.service_table && r.service_row_id
            ? serviceMap[`${r.service_table}:${r.service_row_id}`]
            : undefined;
          return info?.country === countryFilter;
        });
        if (!hit) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const inHv = (h.from_name ?? "").toLowerCase().includes(q) || h.handover_id.toLowerCase().includes(q);
        const inRcs = (receiptsByHandover[h.id] ?? []).some((r) =>
          r.passenger_name.toLowerCase().includes(q) || (r.receipt_id ?? "").toLowerCase().includes(q)
        );
        if (!inHv && !inRcs) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, fromDate, toDate, staffFilter, countryFilter, search, receiptsByHandover, serviceMap]);

  // Metrics
  const metrics = useMemo(() => {
    const approvedToday = all
      .filter((h) => h.status === "approved" && (h.closing_date || h.entry_date) >= fromDate && (h.closing_date || h.entry_date) <= toDate)
      .reduce((s, h) => s + Number(h.confirmed_amount ?? h.amount ?? 0), 0);
    const pendingCash = pending.reduce((s, h) => s + Number(h.submitted_amount ?? h.amount ?? 0), 0);
    // Due recoveries: receipts where total prior paid is > current amount (i.e. not first payment)
    let dueRecov = 0;
    for (const r of allReceipts) {
      if (!inDateRange(r.entry_date)) continue;
      if (!r.service_row_id) continue;
      const k = `${r.service_table}:${r.service_row_id}`;
      const totalPaid = paidByService[k] ?? 0;
      if (totalPaid - Number(r.amount) > 0.01) dueRecov += Number(r.amount);
    }
    return { approvedToday, pendingCash, dueRecov };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, pending, allReceipts, paidByService, fromDate, toDate]);

  if (userLoading || roleLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!isMd) {
    return (
      <div className="p-6">
        <Card><CardContent className="py-12 text-center text-muted-foreground">This panel is restricted to MD only.</CardContent></Card>
      </div>
    );
  }

  const toggleExpand = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  const approve = async (h: Handover) => {
    const raw = confirmAmt[h.id];
    const amt = raw ? Number(raw) : Number(h.submitted_amount ?? h.amount);
    if (!amt || amt < 0) return toast.error("Confirmed amount invalid");
    setBusy(h.id);
    const { error } = await supabase.rpc("approve_handover" as never, {
      _handover_id: h.id, _confirmed_amount: amt,
    } as never);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(`Approved ${fmt(amt)} from ${h.from_name ?? "staff"}`);
    void reload();
  };

  const reject = async (h: Handover) => {
    if (!confirm(`Reject handover from ${h.from_name}? Receipts will revert to pending.`)) return;
    setBusy(h.id);
    const { error } = await supabase.rpc("reject_handover" as never, {
      _handover_id: h.id, _reason: "Rejected by MD",
    } as never);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Handover rejected");
    void reload();
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-primary/15 text-primary">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold">MD Cash Control Panel</h1>
          <p className="text-xs text-muted-foreground">Insightful audit of staff handovers, dues & cash flow</p>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MetricCard icon={<CheckCircle2 className="h-4 w-4" />} label="Approved Cash (range)" value={fmt(metrics.approvedToday)} tone="emerald" />
        <MetricCard icon={<Hourglass className="h-4 w-4" />} label="Pending Cash in Staff Hands" value={fmt(metrics.pendingCash)} tone="amber" />
        <MetricCard icon={<Repeat className="h-4 w-4" />} label="Due Recoveries (range)" value={fmt(metrics.dueRecov)} tone="sky" />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="text-[10px] uppercase text-muted-foreground">From</label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 w-[140px]" />
          </div>
          <div>
            <label className="text-[10px] uppercase text-muted-foreground">To</label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-8 w-[140px]" />
          </div>
          <div>
            <label className="text-[10px] uppercase text-muted-foreground">Staff</label>
            <Select value={staffFilter} onValueChange={setStaffFilter}>
              <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All staff</SelectItem>
                {staffOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] uppercase text-muted-foreground">Country</label>
            <Select value={countryFilter} onValueChange={setCountryFilter}>
              <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All countries</SelectItem>
                {countryOptions.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="text-[10px] uppercase text-muted-foreground">Search</label>
            <div className="relative">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Passenger, receipt, handover…" className="h-8 pl-7" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending" className="gap-2"><Clock className="h-3.5 w-3.5" /> Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="history" className="gap-2"><History className="h-3.5 w-3.5" /> History</TabsTrigger>
          <TabsTrigger value="logs" className="gap-2">All Receipt Logs</TabsTrigger>
        </TabsList>

        {/* PENDING */}
        <TabsContent value="pending" className="space-y-3">
          {loading ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>
          ) : pending.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No pending handovers</CardContent></Card>
          ) : pending.map((h) => (
            <HandoverCard
              key={h.id} h={h} status="pending"
              receipts={receiptsByHandover[h.id] ?? []}
              allReceipts={allReceipts} paidByService={paidByService} serviceMap={serviceMap}
              expanded={!!expanded[h.id]} onToggle={() => toggleExpand(h.id)}
              openLedger={openLedger} setOpenLedger={setOpenLedger}
              confirmAmt={confirmAmt[h.id] ?? ""} setConfirmAmt={(v) => setConfirmAmt((p) => ({ ...p, [h.id]: v }))}
              onApprove={() => approve(h)} onReject={() => reject(h)} busy={busy === h.id}
            />
          ))}
        </TabsContent>

        {/* HISTORY */}
        <TabsContent value="history" className="space-y-3">
          {filteredHistory.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No handovers match filters</CardContent></Card>
          ) : filteredHistory.map((h) => (
            <HandoverCard
              key={h.id} h={h} status={h.status}
              receipts={receiptsByHandover[h.id] ?? []}
              allReceipts={allReceipts} paidByService={paidByService} serviceMap={serviceMap}
              expanded={!!expanded[h.id]} onToggle={() => toggleExpand(h.id)}
              openLedger={openLedger} setOpenLedger={setOpenLedger}
              readOnly busy={false}
            />
          ))}
        </TabsContent>

        {/* LOGS */}
        <TabsContent value="logs">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="px-2 py-2 font-medium">Date</th>
                    <th className="px-2 py-2 font-medium">Passenger</th>
                    <th className="px-2 py-2 font-medium">Service</th>
                    <th className="px-2 py-2 font-medium">Country / Vendor</th>
                    <th className="px-2 py-2 font-medium">Received By</th>
                    <th className="px-2 py-2 font-medium text-right">Amount</th>
                    <th className="px-2 py-2 font-medium">Context</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {allReceipts.map((r) => {
                    const info = r.service_table && r.service_row_id ? serviceMap[`${r.service_table}:${r.service_row_id}`] : undefined;
                    const ctx = paymentContext(r, paidByService, allReceipts);
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(r.entry_date)}</td>
                        <td className="px-2 py-1.5">{r.passenger_name}</td>
                        <td className="px-2 py-1.5">{r.service_type}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {info?.country ?? "—"}{info?.vendor ? ` · ${info.vendor}` : ""}
                        </td>
                        <td className="px-2 py-1.5">{r.received_by_name ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.amount)}</td>
                        <td className="px-2 py-1.5"><ContextBadge ctx={ctx} /></td>
                        <td className="px-2 py-1.5"><ApprovalBadge status={r.approval_status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function MetricCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "emerald" | "amber" | "sky" }) {
  const map = {
    emerald: "from-emerald-500/15 to-emerald-500/5 border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
    amber: "from-amber-500/15 to-amber-500/5 border-amber-500/30 text-amber-600 dark:text-amber-400",
    sky: "from-sky-500/15 to-sky-500/5 border-sky-500/30 text-sky-600 dark:text-sky-400",
  };
  return (
    <Card className={`bg-gradient-to-br ${map[tone]}`}>
      <CardContent className="py-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide opacity-80">{icon}{label}</div>
        <div className="text-2xl font-bold tabular-nums mt-1 text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}

function HandoverCard({
  h, status, receipts, allReceipts, paidByService, serviceMap,
  expanded, onToggle, openLedger, setOpenLedger,
  confirmAmt, setConfirmAmt, onApprove, onReject, busy, readOnly,
}: {
  h: Handover; status: string; receipts: Receipt[]; allReceipts: Receipt[];
  paidByService: Record<string, number>; serviceMap: Record<string, ServiceInfo>;
  expanded: boolean; onToggle: () => void;
  openLedger: string | null; setOpenLedger: (v: string | null) => void;
  confirmAmt?: string; setConfirmAmt?: (v: string) => void;
  onApprove?: () => void; onReject?: () => void; busy: boolean; readOnly?: boolean;
}) {
  const declared = Number(h.submitted_amount ?? h.amount) || 0;
  const confirmed = Number(h.confirmed_amount ?? h.amount) || 0;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <User2 className="h-4 w-4 text-muted-foreground" />
              {h.from_name ?? "Staff"} <StatusBadge status={status} />
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
              {h.handover_id} · Closing {formatDate(h.closing_date || h.entry_date)} · {receipts.length} receipt(s)
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={onToggle} className="gap-1">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Details
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="rounded-md border p-2">
            <div className="text-[11px] text-muted-foreground">Declared</div>
            <div className="text-base font-bold tabular-nums">{fmt(declared)}</div>
          </div>
          {!readOnly ? (
            <div className="rounded-md border p-2">
              <div className="text-[11px] text-muted-foreground">Confirm (৳)</div>
              <Input type="number" inputMode="numeric" placeholder={String(declared)}
                value={confirmAmt ?? ""} onChange={(e) => setConfirmAmt?.(e.target.value)} className="h-8 mt-1" />
            </div>
          ) : (
            <div className="rounded-md border p-2">
              <div className="text-[11px] text-muted-foreground">Confirmed</div>
              <div className="text-base font-bold tabular-nums">{fmt(confirmed)}</div>
            </div>
          )}
          {h.remarks && (
            <div className="rounded-md border p-2 col-span-2 sm:col-span-1">
              <div className="text-[11px] text-muted-foreground">Remarks</div>
              <div className="text-xs">{h.remarks}</div>
            </div>
          )}
        </div>

        {expanded && (
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-2 py-1.5 font-medium">Date</th>
                  <th className="px-2 py-1.5 font-medium">Passenger (ID)</th>
                  <th className="px-2 py-1.5 font-medium">Service</th>
                  <th className="px-2 py-1.5 font-medium">Country / Vendor</th>
                  <th className="px-2 py-1.5 font-medium text-right">Amount</th>
                  <th className="px-2 py-1.5 font-medium">Context</th>
                </tr>
              </thead>
              <tbody>
                {receipts.length === 0 ? (
                  <tr><td colSpan={6} className="px-2 py-3 text-center text-muted-foreground">No linked receipts</td></tr>
                ) : receipts.map((r) => {
                  const key = `${r.service_table}:${r.service_row_id}`;
                  const info = r.service_table && r.service_row_id ? serviceMap[key] : undefined;
                  const totalPaid = paidByService[key] ?? Number(r.amount);
                  const sold = info?.sold_price ?? 0;
                  const due = Math.max(0, sold - totalPaid);
                  const ctx = paymentContext(r, paidByService, allReceipts);
                  const ledgerId = `${h.id}:${r.id}`;
                  const isOpen = openLedger === ledgerId;
                  return (
                    <>
                      <tr key={r.id} className="border-t align-top">
                        <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(r.entry_date)}</td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            <span className="font-medium">{r.passenger_name}</span>
                            {sold > 0 && totalPaid < sold && (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-[10px] font-semibold border border-amber-500/30">
                                    <Info className="h-2.5 w-2.5" /> Part
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-64 text-xs space-y-1">
                                  <div className="font-semibold">{r.passenger_name}</div>
                                  <div className="flex justify-between"><span>Total Paid</span><span className="tabular-nums">{fmt(totalPaid)}</span></div>
                                  <div className="flex justify-between"><span>Sold Price</span><span className="tabular-nums">{fmt(sold)}</span></div>
                                  <div className="flex justify-between font-semibold text-amber-600"><span>Remaining Due</span><span className="tabular-nums">{fmt(due)}</span></div>
                                </PopoverContent>
                              </Popover>
                            )}
                            <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px]"
                              onClick={() => setOpenLedger(isOpen ? null : ledgerId)}>
                              {isOpen ? "Hide" : "Ledger"}
                            </Button>
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono">{r.receipt_id || r.id.slice(0, 8)}{info?.passport ? ` · ${info.passport}` : ""}</div>
                        </td>
                        <td className="px-2 py-1.5">{r.service_type}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {info?.country ?? "—"}
                          {info?.vendor ? <div className="text-[10px]">{info.vendor}</div> : null}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(r.amount)}</td>
                        <td className="px-2 py-1.5"><ContextBadge ctx={ctx} /></td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-muted/30 border-t">
                          <td colSpan={6} className="px-3 py-2">
                            <LedgerTimeline serviceKey={key} currentReceiptId={r.id} allReceipts={allReceipts} sold={sold} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!readOnly && (
          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={onReject} disabled={busy}
              className="text-rose-600 border-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30">
              <XCircle className="h-4 w-4" /> Reject
            </Button>
            <Button size="sm" onClick={onApprove} disabled={busy}>
              <CheckCircle2 className="h-4 w-4" /> Confirm &amp; Approve
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LedgerTimeline({ serviceKey, currentReceiptId, allReceipts, sold }: {
  serviceKey: string; currentReceiptId: string; allReceipts: Receipt[]; sold: number;
}) {
  const [table, id] = serviceKey.split(":");
  const history = allReceipts
    .filter((r) => r.service_table === table && r.service_row_id === id)
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  let running = 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
        <Wallet className="h-3 w-3" /> Customer Ledger Timeline {sold > 0 && <span className="ml-auto">Sold: {fmt(sold)}</span>}
      </div>
      {history.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">No prior payments found.</div>
      ) : (
        <div className="space-y-1">
          {history.map((r) => {
            running += Number(r.amount);
            const isCurrent = r.id === currentReceiptId;
            return (
              <div key={r.id}
                className={`flex items-center justify-between gap-2 text-[11px] rounded px-2 py-1 ${isCurrent ? "bg-primary/10 border border-primary/30" : "bg-background/60"}`}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground">{formatDate(r.entry_date)}</span>
                  <span className="font-mono">{r.receipt_id ?? r.id.slice(0, 6)}</span>
                  <ApprovalBadge status={r.approval_status} />
                  {isCurrent && <Badge variant="outline" className="text-primary border-primary/40">This</Badge>}
                </div>
                <div className="tabular-nums">
                  <span className="font-semibold">{fmt(r.amount)}</span>
                  <span className="text-muted-foreground ml-2">cum {fmt(running)}</span>
                </div>
              </div>
            );
          })}
          {sold > 0 && (
            <div className="text-[11px] text-right text-muted-foreground">
              Total Paid {fmt(running)} / Sold {fmt(sold)} · Remaining Due {fmt(Math.max(0, sold - running))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type Ctx = "new" | "due" | "settled" | "manual";
function paymentContext(r: Receipt, paidByService: Record<string, number>, allReceipts: Receipt[]): Ctx {
  if (!r.service_row_id) return "manual";
  const k = `${r.service_table}:${r.service_row_id}`;
  const totalPaid = paidByService[k] ?? Number(r.amount);
  const earlier = allReceipts.filter((x) => x.service_table === r.service_table && x.service_row_id === r.service_row_id && x.entry_date < r.entry_date);
  if (earlier.length === 0) return totalPaid > Number(r.amount) ? "new" : "new";
  return "due";
}

function ContextBadge({ ctx }: { ctx: Ctx }) {
  const map: Record<Ctx, { label: string; cls: string }> = {
    new: { label: "New Sale", cls: "text-sky-700 dark:text-sky-300 border-sky-500/40 bg-sky-500/10" },
    due: { label: "Due Collection", cls: "text-amber-700 dark:text-amber-300 border-amber-500/40 bg-amber-500/10" },
    settled: { label: "Settled", cls: "text-emerald-700 dark:text-emerald-300 border-emerald-500/40 bg-emerald-500/10" },
    manual: { label: "Manual", cls: "text-muted-foreground border-border bg-muted/40" },
  };
  const m = map[ctx];
  return <Badge variant="outline" className={m.cls}>{m.label}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30",
    approved: "text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30",
    rejected: "text-rose-600 border-rose-300 bg-rose-50 dark:bg-rose-950/30",
  };
  return <Badge variant="outline" className={map[status] ?? ""}>{status}</Badge>;
}

function ApprovalBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    auto_approved: { label: "Self-Approved", cls: "text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30" },
    approved: { label: "Approved", cls: "text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30" },
    pending_md: { label: "Pending MD", cls: "text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30" },
    rejected: { label: "Rejected", cls: "text-rose-600 border-rose-300 bg-rose-50 dark:bg-rose-950/30" },
  };
  const m = map[status] ?? { label: status, cls: "" };
  return <Badge variant="outline" className={m.cls}>{m.label}</Badge>;
}
