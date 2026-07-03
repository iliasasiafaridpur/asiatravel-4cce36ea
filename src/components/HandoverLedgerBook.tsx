import { useEffect, useId, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatDate, formatDateTime, isAdvancePayment } from "@/lib/modules";
import { AdvanceBadge } from "@/components/AdvanceBadge";
import { toast } from "sonner";
import { BookOpen, CheckCircle2, Clock, Search, User2, Users, XCircle } from "lucide-react";
import { isCashMethod, isMdReceivedMethod, isVendorReceivedMethod, vendorExpenseHitsUserBalance } from "@/lib/payment-methods";

const fmt = (n: number) => `৳ ${(Number(n) || 0).toLocaleString()}`;

type Handover = {
  id: string;
  handover_id: string;
  entry_date: string;
  closing_date: string | null;
  from_user: string | null;
  from_name: string | null;
  to_name: string | null;
  submitted_amount: number | null;
  confirmed_amount: number | null;
  amount: number;
  status: string;
  remarks: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
};

type Receipt = {
  id: string;
  receipt_id: string;
  entry_date: string;
  passenger_name: string;
  amount: number;
  method: string | null;
  service_type: string;
  service_table: string | null;
  service_row_id: string | null;
  ref_id: string | null;
  approval_status: string;
  handover_id: string | null;
  received_by: string | null;
  received_by_name: string | null;
  source?: string | null;
  remarks?: string | null;
  created_at: string;
};

const STATUS_EVENT_SOURCES = new Set(["status_event", "status_change", "status-delivery"]);
const isStatusEventReceipt = (r: { source?: string | null; method?: string | null }) =>
  STATUS_EVENT_SOURCES.has(String(r.source ?? "")) || String(r.method ?? "").toLowerCase() === "status";
const cleanStatusText = (text?: string | null) => String(text ?? "").replace(/^\s*status\s*:\s*/i, "").trim() || "Delivery";
const receiptServiceKey = (r: { service_table: string | null; service_row_id: string | null }) =>
  r.service_table && r.service_row_id ? `${r.service_table}:${r.service_row_id}` : "";

// agency_ledger payment rows store the real module in `service_type`
// (tickets/bmet_cards/…) — map it to a user-facing label.
const AGENCY_MODULE_LABELS: Record<string, string> = {
  tickets: "AIR TICKET",
  bmet_cards: "BMET কার্ড",
  saudi_visas: "সৌদি ভিসা",
  kuwait_visas: "কুয়েত ভিসা",
  others: "অন্যান্য সার্ভিস",
};

// Strip "Service Receipt: <agent>" / "Agent Receipt: <agent>" prefixes used by
// collective agency payments (agent name already shows in the customer column).
const cleanAgencyText = (text?: string | null) => {
  const s = (text ?? "").trim();
  if (!s) return "এজেন্সি পেমেন্ট";
  if (/^(?:Service Receipt|Agent Receipt|Customer\/Sub-Agent[^:]*)\s*:/i.test(s)) return "এজেন্সি পেমেন্ট";
  return s;
};

// Primary service label for the সার্ভিস column. For agency_ledger rows prefer
// the real module name resolved from the linked row; never the raw prefix.
const primaryServiceLabel = (
  r: { service_table: string | null; service_type: string },
  info?: { service_name: string | null } | null,
) => {
  if (r.service_table === "agency_ledger") return info?.service_name || cleanAgencyText(r.service_type);
  return r.service_type;
};

type Expense = {
  id: string;
  expense_id: string;
  entry_date: string;
  amount: number;
  category: string;
  purpose: string | null;
  spent_by_name: string | null;
  handover_id: string | null;
  created_at: string;
  linked_source_table?: string | null;
};

type ServiceInfo = {
  country: string | null;
  service_name: string | null;
  vendor: string | null;
  agent: string | null;
  airline: string | null;
  passport: string | null;
  sold_price: number;
  discount: number;
  vendor_price: number;
  /** Whether this service table actually tracks a vendor cost. Agency ledger does not. */
  tracks_cost: boolean;
  flight_date: string | null;
  delivery_date: string | null;
  has_delivery: boolean;
};

const SERVICE_TABLES = [
  { table: "saudi_visas", country: () => "Saudi Arabia", serviceNameField: null, vendorField: "vendor_bought", agentField: "agency_sold", airlineField: null, soldField: "sold_price", discountField: "discount_amount", costField: "cost_price", flightDateField: null, deliveryField: "delivery_date" },
  { table: "kuwait_visas", country: () => "Kuwait", serviceNameField: null, vendorField: "vendor_bought", agentField: "agency_sold", airlineField: null, soldField: "sold_price", discountField: "discount_amount", costField: "cost_price", flightDateField: null, deliveryField: "delivery_date" },
  { table: "bmet_cards", country: "country_name", serviceNameField: null, vendorField: "vendor_bought", agentField: "agency_sold", airlineField: null, soldField: "sold_price", discountField: "discount_amount", costField: "cost_price", flightDateField: null, deliveryField: "delivery_date" },
  { table: "tickets", country: "trip_road", serviceNameField: null, vendorField: "vendor_bought", agentField: "agency_sold", airlineField: "airline", soldField: "sold_price", discountField: "discount_amount", costField: "cost_price", flightDateField: "flight_date", deliveryField: null },
  { table: "others", country: "trip_road", serviceNameField: "service_name", vendorField: "vendor_bought", agentField: "agency_sold", airlineField: "airline", soldField: "sold_price", discountField: "discount_amount", costField: "cost_price", flightDateField: "flight_date", deliveryField: "delivery_date" },
  { table: "agency_ledger", country: "country_route", serviceNameField: "service_type", vendorField: "agent_name", agentField: "agent_name", airlineField: null, soldField: "total_bill", discountField: "discount_amount", costField: null, flightDateField: null, deliveryField: null },
] as const;

export function HandoverLedgerInline({
  mode,
  title,
  enabled = true,
  approveAction,
  onlyPending = false,
  excludePending = false,
  allowCancel = false,
  onChanged,
}: {
  mode: "mine" | "to-me";
  title?: string;
  enabled?: boolean;
  approveAction?: { busyId: string | null; onApprove: (receipt: { id: string; handover_id: string | null; approval_status: string }) => void };
  onlyPending?: boolean;
  excludePending?: boolean;
  allowCancel?: boolean;
  onChanged?: (cancelledId?: string) => void;
}) {
  const { user } = useCurrentUser();
  const instanceId = useId();
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [receiptsByH, setReceiptsByH] = useState<Record<string, Receipt[]>>({});
  const [expensesByH, setExpensesByH] = useState<Record<string, Expense[]>>({});
  const [receiptsByService, setReceiptsByService] = useState<Record<string, Receipt[]>>({});
  const [serviceMap, setServiceMap] = useState<Record<string, ServiceInfo>>({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!enabled || !user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      let q = supabase
        .from("cash_handovers")
        .select("id,handover_id,entry_date,closing_date,from_user,from_name,to_name,submitted_amount,confirmed_amount,amount,status,remarks,approved_at,approved_by,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (mode === "mine") q = q.eq("from_user", user.id);
      if (mode === "to-me") q = q.in("to_name", ["Kaium Khan (MD)", "MD Sir"]);
      const { data: hvData } = await q;
      const hvs = (hvData ?? []) as Handover[];

      const ids = hvs.map((h) => h.id);
      let recs: Receipt[] = [];
      if (ids.length > 0) {
        const { data: recData } = await supabase
          .from("payment_receipts")
          .select("id,receipt_id,entry_date,passenger_name,amount,method,service_type,service_table,service_row_id,ref_id,approval_status,handover_id,received_by,received_by_name,source,remarks,created_at")
          .in("handover_id", ids)
          .not("source", "eq", "discount")
          .order("entry_date", { ascending: true })
          .order("created_at", { ascending: true });
        recs = (recData ?? []) as Receipt[];
      }

      const byH: Record<string, Receipt[]> = {};
      for (const r of recs) {
        if (!r.handover_id) continue;
        (byH[r.handover_id] ??= []).push(r);
      }

      // Load expenses linked to these handovers
      let exps: Expense[] = [];
      if (ids.length > 0) {
        const { data: expData } = await supabase
          .from("cash_expenses")
          .select("id,expense_id,entry_date,amount,category,purpose,spent_by_name,handover_id,created_at,linked_source_table")
          .in("handover_id", ids)
          .order("created_at", { ascending: true });
        exps = (expData ?? []) as Expense[];
      }
      const expByH: Record<string, Expense[]> = {};
      for (const e of exps) {
        if (!e.handover_id) continue;
        // Skip balance-neutral vendor-ledger mirror rows (Opening Due / MD Sir
        // Deposit / Vendor Received / Adjustment) — they never left the drawer,
        // so they must not inflate a handover's expense total.
        if (e.linked_source_table === "vendor_ledger" && !vendorExpenseHitsUserBalance(e.category)) continue;
        (expByH[e.handover_id] ??= []).push(e);
      }


      const svcKeys = new Set<string>();
      const byTable: Record<string, Set<string>> = {};
      for (const r of recs) {
        if (r.service_table && r.service_row_id) {
          svcKeys.add(`${r.service_table}:${r.service_row_id}`);
          (byTable[r.service_table] ??= new Set()).add(r.service_row_id);
        }
      }

      const byService: Record<string, Receipt[]> = {};
      if (svcKeys.size > 0) {
        const tables = Array.from(new Set(Array.from(svcKeys).map((k) => k.split(":")[0])));
        for (const t of tables) {
          const rowIds = Array.from(byTable[t] ?? []);
          if (rowIds.length === 0) continue;
          const { data: more } = await supabase
            .from("payment_receipts")
            .select("id,receipt_id,entry_date,passenger_name,amount,method,service_type,service_table,service_row_id,ref_id,approval_status,handover_id,received_by,received_by_name,created_at")
            .eq("service_table", t)
            .in("service_row_id", rowIds)
            .not("source", "eq", "discount");
          for (const r of ((more ?? []) as Receipt[])) {
            if (!r.service_table || !r.service_row_id) continue;
            (byService[`${r.service_table}:${r.service_row_id}`] ??= []).push(r);
          }
        }
      }

      const svcMap: Record<string, ServiceInfo> = {};
      // agency_ledger rows have no vendor of their own — the real vendor lives
      // in the underlying source job (source_table/source_id). Collect refs so
      // we can resolve the true "V:" vendor name after the main pass.
      const agencySrcRefs: Array<{ key: string; table: string; id: string }> = [];
      await Promise.all(
        SERVICE_TABLES.map(async (cfg) => {
          const rowIds = Array.from(byTable[cfg.table] ?? []);
          if (rowIds.length === 0) return;
          const cols = ["id", "passport"];
          if (typeof cfg.country === "string") cols.push(cfg.country);
          cols.push(cfg.vendorField, cfg.agentField, cfg.soldField, cfg.discountField);
          if (cfg.airlineField) cols.push(cfg.airlineField);
          if (cfg.serviceNameField) cols.push(cfg.serviceNameField);
          if (cfg.costField) cols.push(cfg.costField);
          if (cfg.flightDateField) cols.push(cfg.flightDateField);
          if (cfg.deliveryField) cols.push(cfg.deliveryField);
          // Need status for tickets to hide vendor/cost while in BOOK.
          if (cfg.table === "tickets") cols.push("status");
          // Need the source job link to resolve the real vendor for agency rows.
          if (cfg.table === "agency_ledger") cols.push("source_table", "source_id");
          const uniqueCols = Array.from(new Set(cols));
          const { data } = await supabase
            .from(cfg.table as never)
            .select(uniqueCols.join(","))
            .in("id", rowIds);
          for (const row of (data ?? []) as Array<Record<string, unknown>>) {
            const isTicketBook =
              cfg.table === "tickets" &&
              String(row.status ?? "").toUpperCase() === "BOOK";
            svcMap[`${cfg.table}:${row.id as string}`] = {
              country: typeof cfg.country === "function"
                ? cfg.country()
                : (row[cfg.country] as string | null) ?? null,
              service_name: cfg.serviceNameField
                ? (cfg.table === "agency_ledger"
                    ? (AGENCY_MODULE_LABELS[String(row[cfg.serviceNameField] ?? "")] ?? null)
                    : ((row[cfg.serviceNameField] as string | null) ?? null))
                : null,
              // Agency ledger has NO vendor — the agency itself is the customer.
              // Never surface agent_name as a "vendor" in the মোট বিল / V: line.
              vendor: (cfg.table === "agency_ledger" || isTicketBook)
                ? null
                : ((row[cfg.vendorField] as string | null) ?? null),
              agent: (row[cfg.agentField] as string | null) ?? null,
              airline: cfg.airlineField ? ((row[cfg.airlineField] as string | null) ?? null) : null,
              passport: (row.passport as string | null) ?? null,
              sold_price: Number(row[cfg.soldField] ?? 0),
              discount: Number(row[cfg.discountField] ?? 0),
              vendor_price: isTicketBook ? 0 : (cfg.costField ? Number(row[cfg.costField] ?? 0) : 0),
              tracks_cost: !isTicketBook && Boolean(cfg.costField),
              flight_date: cfg.flightDateField ? ((row[cfg.flightDateField] as string | null) ?? null) : null,
              delivery_date: cfg.deliveryField ? ((row[cfg.deliveryField] as string | null) ?? null) : null,
              has_delivery: Boolean(cfg.deliveryField),
            };
          }
        })
      );

      if (cancelled) return;
      setHandovers(hvs);
      setReceiptsByH(byH);
      setExpensesByH(expByH);
      setReceiptsByService(byService);
      setServiceMap(svcMap);
      setLoading(false);
    })();

    const ch = supabase
      .channel(`handover-book-${mode}-${user.id}-${instanceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_handovers" }, () => {
        if (!cancelled) setReloadTick((t) => t + 1);
      })
      .subscribe();

    return () => { cancelled = true; void supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, user?.id, mode, reloadTick]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const activeHandovers = handovers.filter((h) => {
      const st = (h.status ?? "pending").toLowerCase();
      if (st === "cancelled" || st === "canceled") return false;
      if (st === "pending") {
        if (!((receiptsByH[h.id]?.length ?? 0) > 0 || (expensesByH[h.id]?.length ?? 0) > 0)) return false;
      }
      const d = String(h.entry_date ?? "").slice(0, 10);
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    });
    if (!q) return activeHandovers;
    return activeHandovers.filter((h) => {
      if (h.handover_id?.toLowerCase().includes(q)) return true;
      if ((h.from_name ?? "").toLowerCase().includes(q)) return true;
      const recs = receiptsByH[h.id] ?? [];
      const exps = expensesByH[h.id] ?? [];
      if (exps.some((e) => e.category?.toLowerCase().includes(q) || (e.purpose ?? "").toLowerCase().includes(q))) return true;
      return recs.some((r) => {
        if (r.passenger_name?.toLowerCase().includes(q)) return true;
        if ((r.ref_id ?? "").toLowerCase().includes(q)) return true;
        if ((r.receipt_id ?? "").toLowerCase().includes(q)) return true;
        const sk = r.service_table && r.service_row_id ? `${r.service_table}:${r.service_row_id}` : "";
        const info = sk ? serviceMap[sk] : undefined;
        if (info?.passport?.toLowerCase().includes(q)) return true;
        if (info?.vendor?.toLowerCase().includes(q)) return true;
        return false;
      });
    });
  }, [handovers, search, startDate, endDate, receiptsByH, expensesByH, serviceMap]);

  return (
    <div className="flex flex-col gap-3">
      {title && (
        <div className="flex items-center gap-2 text-base font-semibold">
          <BookOpen className="h-5 w-5" />
          {title}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative flex-1 min-w-[160px] max-w-md">
          <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="খুঁজুন…"
            className="h-9 pl-7"
          />
        </div>
        <div className="space-y-1 w-32">
          <Label className="text-[11px] text-muted-foreground">শুরুর তারিখ</Label>
          <DateInput value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 px-2 text-sm" />
        </div>
        <div className="space-y-1 w-32">
          <Label className="text-[11px] text-muted-foreground">শেষ তারিখ</Label>
          <DateInput value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 px-2 text-sm" />
        </div>
        {(startDate || endDate || search) && (
          <Button type="button" variant="outline" size="sm" className="h-9 gap-1"
            onClick={() => { setSearch(""); setStartDate(""); setEndDate(""); }}>
            <XCircle className="h-3.5 w-3.5" /> রিসেট
          </Button>
        )}
        {(() => {
          const visibleCount = (onlyPending
            ? filtered.filter((h) => (h.status ?? "pending") === "pending")
            : excludePending
              ? filtered.filter((h) => (h.status ?? "pending") !== "pending")
              : filtered).length;
          return (
            <div className="shrink-0 text-xs px-2.5 py-1.5 rounded-md border bg-muted/30 text-muted-foreground whitespace-nowrap">
              ফলাফল: <span className="font-semibold text-foreground tabular-nums">{visibleCount}</span>
            </div>
          );
        })()}
      </div>
      <div className="space-y-7">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">লোড হচ্ছে…</div>
        ) : (() => {
          const visible = onlyPending
            ? filtered.filter((h) => (h.status ?? "pending") === "pending")
            : excludePending
              ? filtered.filter((h) => (h.status ?? "pending") !== "pending")
              : filtered;
          if (visible.length === 0) {
            return <div className="p-8 text-center text-sm text-muted-foreground">কোনো record নেই</div>;
          }
          return visible.map((h) => (
            <HandoverCard
              key={h.id}
              handover={h}
              receipts={receiptsByH[h.id] ?? []}
              expenses={expensesByH[h.id] ?? []}
              receiptsByService={receiptsByService}
              serviceMap={serviceMap}
              mode={mode}
              approveAction={approveAction}
              allowCancel={allowCancel}
              onChanged={(cancelledId) => {
                if (cancelledId) {
                  setHandovers((prev) => prev.filter((row) => row.id !== cancelledId));
                  setReceiptsByH((prev) => {
                    const next = { ...prev };
                    delete next[cancelledId];
                    return next;
                  });
                  setExpensesByH((prev) => {
                    const next = { ...prev };
                    delete next[cancelledId];
                    return next;
                  });
                }
                setReloadTick((t) => t + 1);
                onChanged?.(cancelledId);
              }}
            />
          ));
        })()}
      </div>
    </div>
  );
}

export function HandoverLedgerBook({
  open,
  onOpenChange,
  mode,
  title,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "mine" | "to-me";
  title?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            {title ?? (mode === "mine" ? "আমার হিসাব বই (Handover Book)" : "স্টাফ থেকে রিসিভ করা ক্যাশের হিস্টোরি")}
          </DialogTitle>
          <DialogDescription>
            প্রতিটি কার্ডে দেখুন — কোন কোন যাত্রীর জন্য, কত টাকা, কখন বুঝিয়ে দেওয়া/বুঝে নেওয়া হয়েছে।
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto pr-1">
          <HandoverLedgerInline mode={mode} enabled={open} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HandoverCard({
  handover, receipts, expenses = [], receiptsByService, serviceMap, mode, approveAction, allowCancel, onChanged,
}: {
  handover: Handover;
  receipts: Receipt[];
  expenses?: Expense[];
  receiptsByService: Record<string, Receipt[]>;
  serviceMap: Record<string, ServiceInfo>;
  mode: "mine" | "to-me";
  approveAction?: { busyId: string | null; onApprove: (receipt: Receipt) => void };
  allowCancel?: boolean;
  onChanged?: (cancelledId?: string) => void;
}) {
  const status = handover.status ?? "pending";
  const submitted = Number(handover.submitted_amount ?? handover.amount ?? 0);
  const confirmed = Number(handover.confirmed_amount ?? 0);
  
  const cashReceipts = receipts.reduce((s, r) => s + (isCashMethod(r.method) ? Number(r.amount || 0) : 0), 0);
  const mdReceipts = receipts.reduce((s, r) => s + (isMdReceivedMethod(r.method) ? Number(r.amount || 0) : 0), 0);
  const vendorReceipts = receipts.reduce((s, r) => s + (isVendorReceivedMethod(r.method) ? Number(r.amount || 0) : 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const moneyServiceKeys = new Set(
    receipts.filter((r) => !isStatusEventReceipt(r) && Number(r.amount || 0) > 0).map(receiptServiceKey).filter(Boolean)
  );
  const visibleReceipts = receipts.filter((r) => !(isStatusEventReceipt(r) && moneyServiceKeys.has(receiptServiceKey(r))));
  const isPending = status === "pending";
  const [cancelling, setCancelling] = useState(false);

  const cancelHandover = async () => {
    setCancelling(true);
    const { error } = await supabase.rpc("cancel_handover" as never, { _handover_id: handover.id } as never);
    setCancelling(false);
    if (error) { toast.error(error.message); return; }
    toast.success(
      mode === "to-me"
        ? "Handover বাতিল করা হয়েছে — স্টাফের কাছে ফেরত গেছে।"
        : "Submit বাতিল করা হয়েছে।"
    );
    onChanged?.(handover.id);
  };


  // Persistent row selection / highlight (stays yellow until clicking elsewhere)
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // Card-level highlight (when navigated from "MD-কে পাঠানো" list)
  const [cardHighlight, setCardHighlight] = useState(false);
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (receipts.some((r) => r.id === id)) {
        setHighlightId(id);
        setTimeout(() => {
          const el = document.getElementById(`receipt-row-${id}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
      }
    };
    const cardHandler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id !== handover.id) return;
      setCardHighlight(true);
      setTimeout(() => {
        const el = document.getElementById(`handover-card-${handover.id}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
      setTimeout(() => setCardHighlight(false), 4000);
    };
    window.addEventListener("ledger-highlight-receipt", handler);
    window.addEventListener("ledger-highlight-handover", cardHandler);
    return () => {
      window.removeEventListener("ledger-highlight-receipt", handler);
      window.removeEventListener("ledger-highlight-handover", cardHandler);
    };
  }, [receipts, handover.id]);

  // Clear the yellow selection whenever the user clicks outside any receipt row.
  useEffect(() => {
    if (!highlightId) return;
    const onDocClick = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && target.closest("[data-receipt-row]")) return;
      setHighlightId(null);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [highlightId]);

  const scrollToReceipt = (id: string) => {
    window.dispatchEvent(new CustomEvent("ledger-highlight-receipt", { detail: id }));
  };

  const statusBadge =
    status === "approved" ? (
      <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 border gap-1">
        <CheckCircle2 className="h-3 w-3" /> এমডি বুঝে নিয়েছেন
      </Badge>
    ) : status === "pending" ? (
      <Badge className="bg-amber-500 text-amber-950 border-amber-600 border gap-1 font-bold shadow-md animate-pulse">
        <Clock className="h-3 w-3" /> অপেক্ষমান — এমডিকে পাঠানো হয়েছে
      </Badge>
    ) : (
      <Badge className="bg-rose-500/15 text-rose-600 border-rose-500/30 border">{status}</Badge>
    );

  const cutoff = new Date(handover.created_at).getTime();
  const firstPendingReceipt = receipts.find((r) => r.approval_status !== "approved") ?? receipts[0];

  // Each handover gets a distinct, status-colored accent so one card is clearly
  // separated from the next at a glance. Pending cards get a much stronger,
  // eye-catching amber treatment so they never look like settled history.
  const accent =
    status === "approved"
      ? "border-emerald-500/60 border-l-emerald-500 ring-emerald-500/10 bg-card"
      : status === "pending"
        ? "border-amber-500 border-l-amber-500 ring-2 ring-amber-500/40 bg-amber-500/[0.07] shadow-[0_0_22px_-4px_rgba(245,158,11,0.55)]"
        : "border-rose-500/60 border-l-rose-500 ring-rose-500/10 bg-card";

  return (
    <div
      id={`handover-card-${handover.id}`}
      className={`rounded-xl border-2 border-l-[6px] ${cardHighlight ? "border-red-500 border-l-red-500 ring-2 ring-red-500 bg-red-500/15 shadow-[0_0_26px_-4px_rgba(239,68,68,0.6)]" : accent} shadow-lg ring-1 overflow-hidden transition-colors`}>
      {/* Header */}
      <div className={`${isPending ? "bg-amber-500/20 border-amber-500/40" : "bg-muted/40"} px-4 py-2.5 border-b-2 flex flex-wrap items-center gap-2`}>

        <div className="flex items-center gap-2 min-w-0 flex-1">
          {statusBadge}
          <span className="font-mono text-xs text-muted-foreground">{handover.handover_id}</span>
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
          {status === "approved" && handover.approved_at ? (
            <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
              ✅ তারিখ: {formatDate(handover.approved_at)} | সময়: {new Date(handover.approved_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </span>
          ) : (
            <span>📅 {formatDateTime(handover.created_at)}</span>
          )}
          <span className="flex items-center gap-1"><User2 className="h-3 w-3" /> প্রেরক: <b className="text-foreground">{handover.from_name ?? "—"}</b></span>
          <span className="flex items-center gap-1"><Users className="h-3 w-3" /> গ্রহীতা: <b className="text-foreground">{handover.to_name ?? "MD Sir"}</b></span>
        </div>
        <div className="text-base font-bold tabular-nums text-primary">{fmt(submitted)}</div>
        {allowCancel && isPending && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={cancelling}
                className="h-8 gap-1.5 border-rose-500/40 text-rose-600 hover:bg-rose-500/10 hover:text-rose-600"
              >
                <XCircle className="h-3.5 w-3.5" />
                {mode === "to-me" ? "রিকোয়েস্ট বাতিল" : "Submit বাতিল"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Handover বাতিল করবেন?</AlertDialogTitle>
                <AlertDialogDescription>
                  {mode === "to-me"
                    ? "এই ক্যাশ রিকোয়েস্ট বাতিল হয়ে স্টাফের কাছে ফেরত যাবে। সব আয় ও খরচ আবার স্টাফের pending লিস্টে চলে যাবে।"
                    : "এই Submit বাতিল হবে এবং সব আয় ও খরচ আবার আপনার pending লিস্টে ফেরত আসবে। আপনি পুনরায় Submit করতে পারবেন।"}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>না, থাক</AlertDialogCancel>
                <AlertDialogAction
                  onClick={cancelHandover}
                  className="bg-rose-600 hover:bg-rose-700 text-white"
                >
                  হ্যাঁ, বাতিল করুন
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>




      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[12%]" />
            <col className="w-[27%]" />
            <col className="w-[15%]" />
            <col className="w-[13%]" />
            <col className="w-[11%]" />
            <col className="w-[12%]" />
            <col className="w-[5%]" />
            {approveAction && <col className="w-[5%]" />}
          </colgroup>
          <thead className="bg-muted/30">
            <tr className="text-left">
              <th className="px-1.5 py-1.5 font-semibold">তারিখ</th>
              <th className="px-1.5 py-1.5 font-semibold">কাস্টমার</th>
              <th className="px-1.5 py-1.5 font-semibold">সার্ভিস</th>
              <th className="px-1.5 py-1.5 font-semibold text-right">মোট বিল</th>
              <th className="px-1.5 py-1.5 font-semibold text-right">পূর্বের জমা</th>
              <th className="px-1.5 py-1.5 font-semibold text-right">এই বারের জমা</th>
              <th className="px-1.5 py-1.5 font-bold text-right text-sm">বাকি</th>
              {approveAction && <th className="px-1 py-1.5 pr-2 font-semibold text-center">✓</th>}
            </tr>
          </thead>
          <tbody>
            {visibleReceipts.length === 0 ? (
              <tr><td colSpan={approveAction ? 8 : 7} className="px-3 py-4 text-center text-muted-foreground">কোনো passenger receipt নেই</td></tr>
            ) : visibleReceipts.map((r, idx) => {
              const sk = r.service_table && r.service_row_id ? `${r.service_table}:${r.service_row_id}` : "";
              const info = sk ? serviceMap[sk] : undefined;
              const allForSvc = sk ? (receiptsByService[sk] ?? []) : [];
              const past = allForSvc.filter((x) => x.id !== r.id && new Date(x.created_at).getTime() < cutoff);
              const future = allForSvc.filter((x) => x.id !== r.id && new Date(x.created_at).getTime() > cutoff);
              const previousPaid = past.reduce((s, x) => s + Number(x.amount || 0), 0);
              const futurePaid = future.reduce((s, x) => s + Number(x.amount || 0), 0);
              const lastPast = past.length
                ? past.reduce((a, b) => (new Date(a.created_at).getTime() > new Date(b.created_at).getTime() ? a : b))
                : null;
              const lastFuture = future.length
                ? future.reduce((a, b) => (new Date(a.created_at).getTime() < new Date(b.created_at).getTime() ? a : b))
                : null;
              const totalPaidIncl = allForSvc.reduce((s, x) => s + Number(x.amount || 0), 0);
              const bill = info?.sold_price ?? 0;
              const discount = info?.discount ?? 0;
              const due = bill > 0 ? Math.max(0, bill - totalPaidIncl - discount) : 0;
              const dueAfterThis = bill > 0 ? Math.max(0, bill - (previousPaid + Number(r.amount || 0)) - discount) : 0;
              const isHighlighted = highlightId === r.id;
              const isAdvance = !!info?.has_delivery && isAdvancePayment(r.entry_date, info?.delivery_date);
              const statusEvt = isStatusEventReceipt(r);
              const mdRecv = isMdReceivedMethod(r.method) && !statusEvt;
              const vendorRecv = isVendorReceivedMethod(r.method) && !statusEvt;

              return (
                <tr
                  key={r.id}
                  id={`receipt-row-${r.id}`}
                  data-receipt-row
                  onClick={() => setHighlightId(r.id)}
                  className={`border-t align-top transition-colors cursor-pointer ${isHighlighted ? "bg-yellow-300 dark:bg-yellow-500/40 ring-2 ring-yellow-500" : `row-tint-${idx % 4} hover:bg-yellow-200/80 dark:hover:bg-yellow-500/25`}`}
                >

                  {/* তারিখ */}
                  <td className="px-1.5 py-1 align-top">
                    <div className="text-sm font-medium leading-tight">{formatDate(r.entry_date)}</div>
                    {r.ref_id && (
                      <div className="text-sm text-muted-foreground font-mono leading-tight">{r.ref_id}</div>
                    )}
                    {r.received_by_name && (
                      <div className="text-sm text-muted-foreground leading-tight">Rec:By {r.received_by_name.split(" ")[0]}</div>
                    )}
                  </td>
                  {/* কাস্টমার */}
                  <td className="px-1.5 py-1 align-top">
                    <div className="text-sm font-semibold leading-tight">{r.passenger_name || "—"}</div>
                    <div className="text-sm text-muted-foreground leading-tight">
                      A: {info?.agent || "Self"}{info?.passport ? ` · ${info.passport}` : ""}
                    </div>
                  </td>
                  {/* সার্ভিস */}
                  <td className="px-1.5 py-1 align-top">
                    <div className="text-sm font-medium leading-tight">{primaryServiceLabel(r, info)}</div>
                    {info?.service_name && r.service_table !== "agency_ledger" && (
                      <div className="text-sm text-muted-foreground leading-tight">{info.service_name}</div>
                    )}
                    {info?.country && (
                      <div className="text-sm text-muted-foreground leading-tight">{info.country}</div>
                    )}
                    {info?.airline && (
                      <div className="text-sm text-muted-foreground leading-tight">
                        {info.airline}{info.flight_date ? ` - ${formatDate(info.flight_date)}` : ""}
                      </div>
                    )}
                  </td>
                  {/* মোট বিল */}
                  <td className="px-1.5 py-1 text-right align-top">
                    {bill > 0 ? (
                      <>
                        <div className="text-sm font-bold tabular-nums leading-tight">{fmt(bill)}</div>
                        {discount > 0 && (
                          <div className="text-sm tabular-nums text-emerald-600 leading-tight">{fmt(discount)} (ডিসকাউন্ট)</div>
                        )}
                        {due > 0.005 && (
                          <div className="text-sm tabular-nums text-rose-600 leading-tight">বাকি: {fmt(due)}</div>
                        )}
                        {due <= 0.005 && (
                          <div className="text-sm text-emerald-600 leading-tight">✓ পরিশোধিত</div>
                        )}
                        {info?.vendor && (
                          <div className="text-sm text-muted-foreground leading-tight">
                            V: {info.vendor}
                            {info.vendor_price > 0 ? (
                              `-${Math.round(info.vendor_price).toLocaleString()}/`
                            ) : info.tracks_cost ? (
                              <span title="Vendor cost এন্ট্রি হয়নি" className="ml-1 text-amber-500">⚠️</span>
                            ) : null}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="text-muted-foreground">—</span>
                        {info?.vendor && (
                          <div className="text-sm text-muted-foreground leading-tight">
                            V: {info.vendor}
                            {info.vendor_price > 0 ? (
                              `-${Math.round(info.vendor_price).toLocaleString()}/`
                            ) : info.tracks_cost ? (
                              <span title="Vendor cost এন্ট্রি হয়নি" className="ml-1 text-amber-500">⚠️</span>
                            ) : null}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  {/* পূর্বের জমা */}
                  <td className="px-1.5 py-1 text-right align-top">
                    {previousPaid > 0 ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); if (lastPast) scrollToReceipt(lastPast.id); }}
                        className="text-right hover:underline focus:outline-none focus:ring-1 focus:ring-sky-500 rounded px-1"
                        title="পূর্বের জমা দেখাও"
                      >
                        <div className="text-sm font-semibold tabular-nums text-sky-600 dark:text-sky-400 leading-tight">{fmt(previousPaid)}</div>
                        {lastPast && (
                          <div className="text-sm text-sky-600 leading-tight">{formatDate(lastPast.entry_date)}{past.length > 1 ? ` +${past.length - 1}` : ""}</div>
                        )}
                      </button>
                    ) : <span className="text-sm text-muted-foreground">— নতুন —</span>}
                  </td>
                  {/* এই বারের জমা */}
                  <td className="px-1.5 py-1 text-right tabular-nums align-top">
                    {statusEvt ? (
                      <div className="text-sm font-semibold text-violet-600 dark:text-violet-400 leading-tight">📦 {cleanStatusText(r.remarks)}</div>
                    ) : (
                      <>
                        {isAdvance && <AdvanceBadge advance className="mr-1" />}
                        <b className={`text-sm ${vendorRecv ? "text-orange-600 dark:text-orange-400" : mdRecv ? "text-sky-600 dark:text-sky-400" : "text-emerald-700 dark:text-emerald-400"}`}>{fmt(r.amount)}</b>
                        {mdRecv && (
                          <div className="text-sm text-sky-600 dark:text-sky-400 font-semibold leading-tight">MD · {r.method}</div>
                        )}
                        {vendorRecv && (
                          <div className="text-sm text-orange-600 dark:text-orange-400 font-semibold leading-tight">Vendor Rece</div>
                        )}
                      </>
                    )}
                  </td>
                  {/* বাকি (after this handover) — bolder + larger */}
                  <td className="px-1.5 py-1 text-right tabular-nums text-sm font-bold align-top">
                    {bill > 0 ? (
                      dueAfterThis <= 0.005 ? (
                        <span className="text-emerald-600 text-base">✓</span>
                      ) : (
                        <>
                          <div className="text-rose-600 text-sm font-extrabold leading-tight">{fmt(dueAfterThis)}</div>
                          {futurePaid > 0 && lastFuture && (
                            <div className="text-sm text-emerald-600 font-semibold leading-tight">
                              জমা: {fmt(futurePaid)} {formatDate(lastFuture.entry_date)}
                            </div>
                          )}
                        </>
                      )
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  {approveAction && (
                  <td className="px-0.5 py-1 pr-2 text-center align-top">
                      {r.approval_status === "approved" ? (
                        <CheckCircle2 className="h-5 w-5 mx-auto text-emerald-600" aria-label="Approved" />
                      ) : (
                        <Clock className="h-5 w-5 mx-auto text-amber-500" aria-label="অপেক্ষমাণ" />
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            <tr className="border-t bg-muted/30 font-semibold">
              <td className="px-1.5 py-1.5 text-right" colSpan={5}>মোট ({visibleReceipts.length} আইটেম)</td>
              <td className="px-1.5 py-1.5 text-right tabular-nums">
                <div className="text-emerald-700 dark:text-emerald-400">নগদ: {fmt(cashReceipts)}</div>
                {mdReceipts > 0 && (
                  <div className="text-xs text-sky-600 dark:text-sky-400 font-medium">MD: {fmt(mdReceipts)}</div>
                )}
                {vendorReceipts > 0 && (
                  <div className="text-xs text-orange-600 dark:text-orange-400 font-medium">Vendor: {fmt(vendorReceipts)}</div>
                )}
              </td>
              <td className="px-1.5 py-1.5" colSpan={approveAction ? 2 : 1} />
            </tr>
          </tbody>
        </table>
      </div>

      {/* খরচের বিবরণ (Expenses in this handover) */}
      {expenses.length > 0 && (
        <div className="border-t">
          <div className="px-4 py-2 bg-rose-500/10 text-xs font-semibold text-rose-700 dark:text-rose-300 flex items-center justify-between">
            <span>💸 খরচের বিবরণ — {expenses.length} টি</span>
            <span className="tabular-nums">মোট খরচ: {fmt(totalExpenses)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr className="text-left">
                  <th className="px-3 py-1.5 font-semibold">তারিখ</th>
                  <th className="px-3 py-1.5 font-semibold">খাত</th>
                  <th className="px-3 py-1.5 font-semibold">বিবরণ</th>
                  <th className="px-3 py-1.5 font-semibold">খরচকারী</th>
                  <th className="px-3 py-1.5 font-semibold text-right">টাকা</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e, idx) => (
                  <tr key={e.id} className={`border-t align-top row-tint-${idx % 4}`}>
                    <td className="px-3 py-2 align-top">
                      <div className="text-sm font-medium">{formatDate(e.entry_date)}</div>
                      {e.expense_id && (
                        <div className="text-xs text-muted-foreground font-mono mt-0.5">{e.expense_id}</div>
                      )}
                      {e.created_at && (
                        <div className="text-xs text-muted-foreground mt-0.5">{formatDateTime(e.created_at)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-sm font-medium">{e.category || "—"}</td>
                    <td className="px-3 py-2 align-top text-sm text-muted-foreground">{e.purpose || "—"}</td>
                    <td className="px-3 py-2 align-top text-xs text-muted-foreground">{e.spent_by_name || "—"}</td>
                    <td className="px-3 py-2 text-right align-top tabular-nums font-bold text-rose-600 dark:text-rose-400">
                      −{fmt(e.amount)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t bg-muted/30 font-semibold">
                  <td className="px-3 py-1.5 text-right" colSpan={4}>মোট খরচ ({expenses.length} টি)</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-rose-600 dark:text-rose-400">−{fmt(totalExpenses)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}


      {(handover.remarks || (status === "approved" && confirmed > 0 && confirmed !== submitted)) && (
        <div className="px-4 py-2 border-t bg-muted/20 text-xs text-muted-foreground space-y-0.5">
          {confirmed > 0 && confirmed !== submitted && (
            <div>Confirmed: <b className="text-foreground">{fmt(confirmed)}</b> · Variance: <b className={confirmed - submitted > 0 ? "text-emerald-600" : "text-rose-600"}>{confirmed - submitted > 0 ? "+" : ""}{fmt(confirmed - submitted)}</b></div>
          )}
          {handover.remarks && <div>📝 {handover.remarks}</div>}
        </div>
      )}

      {/* Footer summary bar — mirrors the top header */}
      <div className="bg-muted/40 px-4 py-3 border-t flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0 flex-1 text-sm sm:text-base font-semibold">
          <span className="whitespace-nowrap">মোট {visibleReceipts.length} আইটেম থেকে আয়</span>
          <span className="tabular-nums text-emerald-700 dark:text-emerald-400 whitespace-nowrap">নগদ {fmt(cashReceipts)}</span>
          {mdReceipts > 0 && (
            <span className="tabular-nums text-sky-600 dark:text-sky-400 whitespace-nowrap">— MD {fmt(mdReceipts)}</span>
          )}
          {vendorReceipts > 0 && (
            <span className="tabular-nums text-orange-600 dark:text-orange-400 whitespace-nowrap">— Vendor {fmt(vendorReceipts)}</span>
          )}
          {totalExpenses > 0 && (
            <span className="tabular-nums text-rose-600 dark:text-rose-400 whitespace-nowrap">— মোট খরচ {fmt(totalExpenses)}</span>
          )}
          <span className="flex items-center gap-1 whitespace-nowrap">
            <User2 className="h-4 w-4" /> প্রেরক: <b className="text-foreground">{handover.from_name ?? "—"}</b>
            <Users className="h-4 w-4 ml-1" /> গ্রহীতা: <b className="text-foreground">{handover.to_name ?? "MD Sir"}</b>
            <b className="text-primary tabular-nums ml-1">{fmt(submitted)}</b>
          </span>
        </div>
        {approveAction && isPending && firstPendingReceipt && (
          <Button
            size="sm"
            onClick={() => approveAction.onApprove(firstPendingReceipt)}
            disabled={approveAction.busyId === firstPendingReceipt.id || !firstPendingReceipt.handover_id}
            className="h-auto min-h-9 py-2 px-3 whitespace-normal break-words bg-emerald-600 hover:bg-emerald-700 text-white gap-2 font-bold shadow-md text-xs sm:text-sm leading-tight"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span className="break-words">🟢 টাকা পেলাম ({fmt(submitted)})</span>
          </Button>
        )}
      </div>
    </div>
  );
}

export function HandoverLedgerButton({
  mode, label,
}: { mode: "mine" | "to-me"; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <BookOpen className="h-3.5 w-3.5" />
        {label ?? (mode === "mine" ? "আমার হিসাব বই" : "ক্যাশ রিসিভ হিস্টোরি")}
      </Button>
      <HandoverLedgerBook open={open} onOpenChange={setOpen} mode={mode} />
    </>
  );
}
