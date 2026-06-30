import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/useRole";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ShieldCheck, CheckCircle2, Search, Hourglass, Wallet, Repeat, X,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate, formatDateTime, isAdvancePayment } from "@/lib/modules";
import { AdvanceBadge } from "@/components/AdvanceBadge";
import { HandoverLedgerInline } from "@/components/HandoverLedgerBook";

export const Route = createFileRoute("/md-panel")({
  head: () => ({ meta: [{ title: "MD Cash Control Panel" }] }),
  component: MdPanelPage,
});

type Handover = {
  id: string; handover_id: string; entry_date: string; closing_date: string | null;
  from_user: string | null; from_name: string | null;
  submitted_amount: number | null; confirmed_amount: number | null;
  amount: number; status: string; remarks: string | null;
  approved_at?: string | null; approved_by?: string | null;
  created_at: string;
};

type Receipt = {
  id: string; receipt_id: string; entry_date: string; passenger_name: string;
  amount: number; method: string; service_type: string;
  service_table: string | null; service_row_id: string | null; ref_id: string | null;
  approval_status: string; received_by: string | null; received_by_name: string | null;
  handover_id: string | null; source: string; remarks?: string | null; created_at?: string | null;
};

type ServiceInfo = {
  table: string; id: string; country: string | null; vendor: string | null;
  passport: string | null; sold_price: number; discount: number;
  service_name: string | null; airline: string | null; flight_date: string | null;
  delivery_date: string | null; has_delivery: boolean;
};

const fmt = (n: number) => `৳ ${(Number(n) || 0).toLocaleString()}`;
const cleanStatusText = (text?: string | null) => String(text ?? "").replace(/^\s*status\s*:\s*/i, "").trim() || "Delivery";
// Agency-ledger collective payments store service_type like "Service Receipt: <agent>";
// the agent name is already in the name column, so just show "এজেন্সি পেমেন্ট".
const cleanSvcType = (text?: string | null) => {
  const s = (text ?? "").trim();
  if (!s) return "";
  if (/^(?:Service Receipt|Agent Receipt|Customer\/Sub-Agent[^:]*)\s*:/i.test(s)) return "এজেন্সি পেমেন্ট";
  return s;
};

const SERVICE_TABLES = [
  { table: "saudi_visas", country: () => "Saudi Arabia", serviceNameField: null, airlineField: null, flightDateField: null, vendorField: "vendor_bought", soldField: "sold_price", discountField: "discount_amount", deliveryField: "delivery_date" },
  { table: "kuwait_visas", country: () => "Kuwait", serviceNameField: null, airlineField: null, flightDateField: null, vendorField: "vendor_bought", soldField: "sold_price", discountField: "discount_amount", deliveryField: "delivery_date" },
  { table: "bmet_cards", country: "country_name", serviceNameField: null, airlineField: null, flightDateField: null, vendorField: "vendor_bought", soldField: "sold_price", discountField: "discount_amount", deliveryField: "delivery_date" },
  { table: "tickets", country: "trip_road", serviceNameField: null, airlineField: "airline", flightDateField: "flight_date", vendorField: "vendor_bought", soldField: "sold_price", discountField: "discount_amount", deliveryField: null },
  { table: "others", country: "trip_road", serviceNameField: "service_name", airlineField: "airline", flightDateField: "flight_date", vendorField: "vendor_bought", soldField: "sold_price", discountField: "discount_amount", deliveryField: "delivery_date" },
  { table: "agency_ledger", country: "country_route", serviceNameField: null, airlineField: null, flightDateField: null, vendorField: "agent_name", soldField: "total_bill", discountField: "discount_amount", deliveryField: null },
] as const;

function MdPanelPage() {
  const { isMd, loading: roleLoading } = useRole();
  const { user, loading: userLoading } = useCurrentUser();

  const [pendingReceipts, setPendingReceipts] = useState<Receipt[]>([]);
  const [allReceipts, setAllReceipts] = useState<Receipt[]>([]);
  const [handoverMap, setHandoverMap] = useState<Record<string, Handover>>({});
  const [serviceMap, setServiceMap] = useState<Record<string, ServiceInfo>>({});
  const [paidByService, setPaidByService] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [staffFilter, setStaffFilter] = useState<string>("all");

  // Drawer state for past-transaction audit
  const [drawer, setDrawer] = useState<{
    receipt: Receipt; pastReceipt: Receipt;
  } | null>(null);

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
        cols.push(cfg.vendorField, cfg.soldField, cfg.discountField);
        if (cfg.serviceNameField) cols.push(cfg.serviceNameField);
        if (cfg.airlineField) cols.push(cfg.airlineField);
        if (cfg.flightDateField) cols.push(cfg.flightDateField);
        if (cfg.deliveryField) cols.push(cfg.deliveryField);
        const uniqueCols = Array.from(new Set(cols));
        const { data } = await supabase
          .from(cfg.table as never)
          .select(uniqueCols.join(","))
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
            discount: Number(row[cfg.discountField] ?? 0),
            service_name: cfg.serviceNameField ? ((row[cfg.serviceNameField] as string | null) ?? null) : null,
            airline: cfg.airlineField ? ((row[cfg.airlineField] as string | null) ?? null) : null,
            flight_date: cfg.flightDateField ? ((row[cfg.flightDateField] as string | null) ?? null) : null,
            delivery_date: cfg.deliveryField ? ((row[cfg.deliveryField] as string | null) ?? null) : null,
            has_delivery: Boolean(cfg.deliveryField),
          };
        }
      })
    );
    return map;
  }, []);

  const reload = useCallback(async () => {
    const [{ data: recData }, { data: hvData }] = await Promise.all([
      supabase
        .from("payment_receipts")
        .select("id,receipt_id,entry_date,passenger_name,amount,method,service_type,service_table,service_row_id,ref_id,approval_status,received_by,received_by_name,handover_id,source,remarks,created_at")
        .not("source", "eq", "discount")
        .not("method", "ilike", "discount")
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase
        .from("cash_handovers")
        .select("id,handover_id,entry_date,closing_date,from_user,from_name,submitted_amount,confirmed_amount,amount,status,remarks,approved_at,approved_by,created_at")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    const receipts = (recData ?? []) as Receipt[];
    const handovers = (hvData ?? []) as Handover[];

    const pendingLinkedHandoverIds = new Set(
      receipts
        .filter((r) => r.approval_status === "pending_md" && r.handover_id)
        .map((r) => r.handover_id as string)
    );
    const hvMap: Record<string, Handover> = {};
    for (const h of handovers) {
      const st = (h.status ?? "pending").toLowerCase();
      if (st === "cancelled" || st === "canceled") continue;
      if (st === "pending" && !pendingLinkedHandoverIds.has(h.id)) continue;
      hvMap[h.id] = h;
    }

    // Pending = approval_status pending_md (this is what MD must approve)
    const pending = receipts.filter((r) => r.approval_status === "pending_md" && r.handover_id && hvMap[r.handover_id]);

    // Aggregate paid (all approved + pending) per service row for due calc
    const paid: Record<string, number> = {};
    for (const r of receipts) {
      if (!r.service_row_id) continue;
      const k = `${r.service_table}:${r.service_row_id}`;
      paid[k] = (paid[k] ?? 0) + Number(r.amount || 0);
    }

    const svcMap = await enrichServiceInfo(receipts);

    setPendingReceipts(pending);
    setAllReceipts(receipts);
    setHandoverMap(hvMap);
    setServiceMap(svcMap);
    setPaidByService(paid);
    setLoading(false);
  }, [enrichServiceInfo]);

  useEffect(() => {
    if (!user?.id) return;
    void reload();
    const ch = supabase
      .channel("md_panel_flat")
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_handovers" }, () => void reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_receipts" }, () => void reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, reload]);

  const staffOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of allReceipts) {
      if (r.received_by) map.set(r.received_by, r.received_by_name ?? "Staff");
    }
    return Array.from(map.entries());
  }, [allReceipts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allReceipts.filter((r) => {
      if (staffFilter !== "all" && r.received_by !== staffFilter) return false;
      if (!q) return true;
      return (
        r.passenger_name.toLowerCase().includes(q) ||
        (r.receipt_id ?? "").toLowerCase().includes(q) ||
        (r.received_by_name ?? "").toLowerCase().includes(q) ||
        (r.service_type ?? "").toLowerCase().includes(q)
      );
    });
  }, [allReceipts, search, staffFilter]);

  // Metrics
  const metrics = useMemo(() => {
    // Pending Approval = sum of submitted_amount across pending cash_handovers
    const pendingHandovers = Object.values(handoverMap).filter((h) => (h.status ?? "pending") === "pending");
    const pendingCash = pendingHandovers.reduce((s, h) => s + Number(h.submitted_amount ?? h.amount ?? 0), 0);
    const pendingRows = filtered.filter((r) => r.approval_status === "pending_md");
    const pendingHandoverIds = new Set(pendingHandovers.map((h) => h.id));
    const pendingCount = pendingRows.filter((r) => r.handover_id && pendingHandoverIds.has(r.handover_id)).length;
    let dueRecov = 0;
    for (const r of pendingRows) {
      if (!r.service_row_id) continue;
      const earlier = allReceipts.some(
        (x) => x.service_table === r.service_table && x.service_row_id === r.service_row_id && x.id !== r.id && (x.created_at ?? x.entry_date) < (r.created_at ?? r.entry_date)
      );
      if (earlier) dueRecov += Number(r.amount || 0);
    }
    const approvedToday = allReceipts
      .filter((r) => r.approval_status === "approved" && r.entry_date === new Date().toISOString().slice(0, 10))
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    return { pendingCash, pendingCount, dueRecov, approvedToday };
  }, [filtered, allReceipts, handoverMap]);

  if (userLoading || roleLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!isMd) {
    return (
      <div className="p-6">
        <Card><CardContent className="py-12 text-center text-muted-foreground">This panel is restricted to MD only.</CardContent></Card>
      </div>
    );
  }

  const approveReceipt = async (r: Receipt) => {
    if (!r.handover_id) return toast.error("This receipt is not linked to a handover yet.");
    const h = handoverMap[r.handover_id];
    if (!h) return toast.error("Handover not found");
    const confirmedAmt = Number(h.submitted_amount ?? h.amount);
    setBusy(r.id);
    const { error } = await supabase.rpc("approve_handover" as never, {
      _handover_id: h.id, _confirmed_amount: confirmedAmt,
    } as never);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(`✅ Approved ${fmt(confirmedAmt)} from ${h.from_name ?? "staff"}`);
    void reload();
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-primary/15 text-primary">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold">MD Cash Control Panel</h1>
          <p className="text-xs text-muted-foreground">প্রতিটি Passenger Payment আলাদা সারিতে — সবুজ বাটনে চাপ দিয়ে অনুমোদন দিন</p>
        </div>
        
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Metric icon={<Hourglass className="h-4 w-4" />} label="Pending Approval" value={fmt(metrics.pendingCash)} tone="amber" />
        <Metric icon={<Repeat className="h-4 w-4" />} label="Due Recoveries (pending)" value={fmt(metrics.dueRecov)} tone="sky" />
        <Metric icon={<CheckCircle2 className="h-4 w-4" />} label="Approved Today" value={fmt(metrics.approvedToday)} tone="emerald" />
      </div>

      <Card>
        <CardContent className="py-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="text-[10px] uppercase text-muted-foreground">Staff</label>
            <Select value={staffFilter} onValueChange={setStaffFilter}>
              <SelectTrigger className="h-8 w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All staff</SelectItem>
                {staffOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="text-[10px] uppercase text-muted-foreground">Search</label>
            <div className="relative">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Passenger, receipt, staff…" className="h-8 pl-7" />
            </div>
          </div>
          <div className="text-xs text-muted-foreground ml-auto">{filtered.length} payment row(s)</div>
        </CardContent>
      </Card>

      <div>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <Hourglass className="h-4 w-4 text-amber-600" />
          <h2 className="text-sm font-semibold">
            অপেক্ষমাণ অনুমোদন (Pending Handovers)
            {metrics.pendingCount > 0 ? (
              <span className="ml-2 text-amber-600 font-bold">
                — {metrics.pendingCount} টি লেনদেন · {fmt(metrics.pendingCash)}
              </span>
            ) : (
              <span className="ml-2 text-muted-foreground font-normal">(কোন পেন্ডিং নেই)</span>
            )}
          </h2>
        </div>
        <HandoverLedgerInline
          mode="to-me"
          onlyPending
          allowCancel
          onChanged={() => { void reload(); }}
          approveAction={{ busyId: busy, onApprove: (r) => { void approveReceipt(r as Receipt); } }}
        />
      </div>

      {/* Right side drawer: historical EOD audit */}
      <Sheet open={!!drawer} onOpenChange={(o) => !o && setDrawer(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Wallet className="h-4 w-4" /> পূর্বের EOD Handover Report
            </SheetTitle>
          </SheetHeader>
          {drawer && (
            <PastEodPanel
              currentReceipt={drawer.receipt}
              pastReceipt={drawer.pastReceipt}
              allReceipts={allReceipts}
              handoverMap={handoverMap}
              serviceMap={serviceMap}
              onClose={() => setDrawer(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      <div className="pt-4 border-t mt-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-emerald-500/15 text-emerald-600">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold">📒 ক্যাশ রিসিভ হিস্টোরি (Permanent Ledger)</h2>
            <p className="text-xs text-muted-foreground">স্টাফ থেকে বুঝে নেওয়া সকল ক্যাশের স্থায়ী হিসাব — যাত্রী/মোট বিল/পূর্বের জমা/বাকি সহ</p>
          </div>
        </div>
        <HandoverLedgerInline mode="to-me" excludePending />
      </div>
    </div>
  );
}

function Metric({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: string; tone: "emerald" | "amber" | "sky";
}) {
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

function PastEodPanel({
  currentReceipt, pastReceipt, allReceipts, handoverMap, serviceMap, onClose,
}: {
  currentReceipt: Receipt;
  pastReceipt: Receipt;
  allReceipts: Receipt[];
  handoverMap: Record<string, Handover>;
  serviceMap: Record<string, ServiceInfo>;
  onClose: () => void;
}) {
  // The EOD context = the cash_handover the past receipt belonged to.
  const hv = pastReceipt.handover_id ? handoverMap[pastReceipt.handover_id] : null;
  const eodReceipts = hv
    ? allReceipts.filter((r) => r.handover_id === hv.id)
    : [pastReceipt];

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-md border bg-muted/40 p-3 text-xs">
        <div className="font-semibold text-sm">{currentReceipt.passenger_name}</div>
        <div className="text-muted-foreground mt-0.5">
          আজকের জমা: <span className="font-semibold text-emerald-600">{fmt(currentReceipt.amount)}</span>
          {" · "}পূর্বের লেনদেনের সম্পূর্ণ EOD সারাংশ নিচে দেখানো হলো
        </div>
      </div>

      {hv ? (
        <div className="rounded-md border p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-sm">EOD Report — {formatDate(hv.closing_date || hv.entry_date)}</div>
            <Button variant="ghost" size="sm" onClick={onClose}><X className="h-3.5 w-3.5" /></Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><span className="text-muted-foreground">Staff:</span> <b>{hv.from_name ?? "—"}</b></div>
            <div><span className="text-muted-foreground">Handover ID:</span> <span className="font-mono">{hv.handover_id}</span></div>
            <div><span className="text-muted-foreground">Submitted:</span> <b className="tabular-nums">{fmt(Number(hv.submitted_amount ?? hv.amount))}</b></div>
            <div><span className="text-muted-foreground">Status:</span> <b className={hv.status === "approved" ? "text-emerald-600" : "text-amber-600"}>{hv.status}</b></div>
            {hv.approved_at && (
              <div className="col-span-2 text-muted-foreground">
                MD Approved: <b>{formatDateTime(hv.approved_at)}</b>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-md border p-3 text-xs text-muted-foreground">
          এই পূর্বের রসিদটি কোনো EOD handover ব্যাচে যুক্ত নয় (পুরাতন ডেটা)।
        </div>
      )}

      <div className="rounded-md border overflow-hidden">
        <div className="bg-muted/60 px-3 py-2 text-xs font-semibold">EOD Receipts ({eodReceipts.length})</div>
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left">
              <th className="px-2 py-1.5">যাত্রী</th>
              <th className="px-2 py-1.5">সার্ভিস</th>
              <th className="px-2 py-1.5 text-right">পরিমাণ</th>
              <th className="px-2 py-1.5">তারিখ ও সময়</th>
            </tr>
          </thead>
          <tbody>
            {eodReceipts.map((r, idx) => {
              const highlight = r.id === pastReceipt.id;
              const key = r.service_table && r.service_row_id ? `${r.service_table}:${r.service_row_id}` : "";
              const info = key ? serviceMap[key] : undefined;
              const statusEvt = ["status_event", "status_change", "status-delivery"].includes(String(r.source ?? "")) || String(r.method ?? "").toLowerCase() === "status";
              return (
                <tr
                  key={r.id}
                  className={`border-t ${highlight ? "bg-yellow-200 dark:bg-yellow-500/30 ring-2 ring-yellow-500 animate-pulse" : `row-tint-${idx % 4}`}`}
                >
                  <td className="px-2 py-1.5">
                    <div className={`text-sm ${highlight ? "font-bold" : "font-medium"}`}>{r.passenger_name}</div>
                    {highlight && <div className="text-[11px] text-yellow-800 dark:text-yellow-200 font-semibold">⬅ এই লেনদেনটি</div>}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="text-sm">{r.service_type}</div>
                    {info?.service_name && <div className="text-xs text-muted-foreground">{info.service_name}</div>}
                    {info?.country && <div className="text-xs text-muted-foreground">{info.country}</div>}
                    {info?.airline && <div className="text-xs text-muted-foreground">{info.airline}{info.flight_date ? ` · ✈ ${formatDate(info.flight_date)}` : ""}</div>}
                    {statusEvt && <div className="text-xs text-violet-600 dark:text-violet-400">{cleanStatusText(r.remarks)} — অবগতি</div>}
                    {info && info.discount > 0 && (
                      <div className="text-xs tabular-nums text-amber-600 dark:text-amber-400">
                        ডিসকাউন্ট: {fmt(info.discount)}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right text-sm font-semibold tabular-nums">
                    {statusEvt ? <span className="text-violet-600 dark:text-violet-400">📦 Delivery</span> : <>{info?.has_delivery && isAdvancePayment(r.entry_date, info?.delivery_date) ? <><AdvanceBadge advance /> </> : null}{fmt(r.amount)}</>}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">{formatDateTime(r.created_at || r.entry_date)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
