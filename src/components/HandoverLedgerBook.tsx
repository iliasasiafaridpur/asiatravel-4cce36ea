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
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatDate, formatDateTime, isAdvancePayment } from "@/lib/modules";
import { AdvanceBadge } from "@/components/AdvanceBadge";
import { toast } from "sonner";
import { BookOpen, CheckCircle2, Clock, Printer, Search, User2, Users, XCircle } from "lucide-react";
import { isCashMethod, isMdReceivedMethod, isVendorReceivedMethod, vendorExpenseHitsUserBalance, methodLabel, DISCOUNT_LABEL } from "@/lib/payment-methods";
import { buildFileTitle, printDocHtml } from "@/lib/print-export";

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
  selectable = false,
  onChanged,
}: {
  mode: "mine" | "to-me";
  title?: string;
  enabled?: boolean;
  approveAction?: { busyId: string | null; onApprove: (receipt: { id: string; handover_id: string | null; approval_status: string }) => void };
  onlyPending?: boolean;
  excludePending?: boolean;
  allowCancel?: boolean;
  selectable?: boolean;
  onChanged?: (cancelledId?: string) => void;
}) {
  const { user } = useCurrentUser();
  const instanceId = useId();
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [receiptsByH, setReceiptsByH] = useState<Record<string, Receipt[]>>({});
  const [expensesByH, setExpensesByH] = useState<Record<string, Expense[]>>({});
  const [receiptsByService, setReceiptsByService] = useState<Record<string, Receipt[]>>({});
  const [serviceMap, setServiceMap] = useState<Record<string, ServiceInfo>>({});
  const [totalAgents, setTotalAgents] = useState<Set<string>>(() => new Set());
  // Authoritative live agency balances (same RPC the Agency list/ledger use) —
  // keyed by trimmed agent name → current outstanding due / advance.
  const [agentDue, setAgentDue] = useState<Map<string, { due: number; advance: number }>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [printOpen, setPrintOpen] = useState(false);
  const [blankIds, setBlankIds] = useState<Set<string>>(() => new Set());
  const [showSig, setShowSig] = useState(false);

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

      const { data: totalAgentRows } = await supabase
        .from("agents")
        .select("name")
        .eq("settle_mode", "total");
      const nextTotalAgents = new Set(
        ((totalAgentRows ?? []) as Array<{ name?: string | null }>)
          .map((a) => String(a.name ?? "").trim())
          .filter(Boolean)
      );

      // Live agency balances → current outstanding due per agency (from ledger).
      const { data: agentBalRows } = await supabase.rpc("get_agent_balances" as never);
      const nextAgentDue = new Map<string, { due: number; advance: number }>();
      for (const b of ((agentBalRows ?? []) as Array<Record<string, unknown>>)) {
        const nm = String(b.agent_name ?? "").trim();
        if (!nm) continue;
        nextAgentDue.set(nm, {
          due: Number(b.balance_due ?? 0),
          advance: Number(b.advance_balance ?? 0),
        });
      }



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
            .not("source", "eq", "discount")
            .not("approval_status", "eq", "cancelled");
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
            // Queue the source-job vendor lookup for agency_ledger rows.
            if (cfg.table === "agency_ledger") {
              const st = row.source_table as string | null;
              const sid = row.source_id as string | null;
              if (st && sid) {
                agencySrcRefs.push({ key: `${cfg.table}:${row.id as string}`, table: st, id: sid });
              }
            }
          }
        })
      );

      // Resolve the true vendor name (and cost) for agency_ledger rows from
      // their source job, so the "V:" line shows the actual vendor of the work.
      if (agencySrcRefs.length > 0) {
        const bySrcTable: Record<string, Array<{ key: string; id: string }>> = {};
        for (const ref of agencySrcRefs) (bySrcTable[ref.table] ??= []).push({ key: ref.key, id: ref.id });
        await Promise.all(
          Object.entries(bySrcTable).map(async ([tbl, refs]) => {
            const vField = tbl === "extra_services" ? "vendor_name" : "vendor_bought";
            const cField = tbl === "extra_services" ? "vendor_cost" : "cost_price";
            const ids = Array.from(new Set(refs.map((r) => r.id)));
            const { data } = await supabase
              .from(tbl as never)
              .select(`id,${vField},${cField}`)
              .in("id", ids);
            const map: Record<string, { vendor: string | null; cost: number }> = {};
            for (const row of (data ?? []) as Array<Record<string, unknown>>) {
              map[row.id as string] = {
                vendor: (row[vField] as string | null) ?? null,
                cost: Number(row[cField] ?? 0),
              };
            }
            for (const ref of refs) {
              const src = map[ref.id];
              const info = svcMap[ref.key];
              if (src && info && src.vendor) {
                info.vendor = src.vendor;
                info.vendor_price = src.cost;
                info.tracks_cost = true;
              }
            }
          }),
        );
      }


      if (cancelled) return;
      setHandovers(hvs);
      setReceiptsByH(byH);
      setExpensesByH(expByH);
      setReceiptsByService(byService);
      setServiceMap(svcMap);
      setTotalAgents(nextTotalAgents);
      setAgentDue(nextAgentDue);

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
      // Cancelled AND rejected handovers are no longer active — their receipts/
      // expenses were unlinked back to the staff pool (cancel_handover /
      // reject_handover), so they must not show as live cards here (matches
      // handoverReducesBalance semantics used for the cash balance).
      if (st === "cancelled" || st === "canceled" || st === "rejected") return false;
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

  const visible = useMemo(() => (onlyPending
    ? filtered.filter((h) => (h.status ?? "pending") === "pending")
    : excludePending
      ? filtered.filter((h) => (h.status ?? "pending") !== "pending")
      : filtered), [filtered, onlyPending, excludePending]);

  // Keep the selection in sync with what is actually visible (search/date filters).
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visIds = new Set(visible.map((h) => h.id));
      const next = new Set<string>();
      for (const id of prev) if (visIds.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [visible]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allSelected = visible.length > 0 && selectedIds.size === visible.length;
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(visible.map((h) => h.id)));
  };

  // Open the batch-print dialog (choose which selected slips to leave blank).
  const openPrintDialog = () => {
    if (selectedIds.size === 0) return;
    setBlankIds(new Set());
    setShowSig(false);
    setPrintOpen(true);
  };
  const toggleBlank = (id: string) => {
    setBlankIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Print all selected handovers as ONE document (each on its own page).
  // Batch prints omit the প্রেরক/গ্রহীতা signature area, and any handover
  // marked "blank" prints an empty page (its slot on the paper stays white).
  const printSelected = () => {
    // Serial / chronological order: oldest handover prints first (top), newest last.
    const chosen = visible
      .filter((h) => selectedIds.has(h.id))
      .slice()
      .sort((a, b) => {
        const ka = a.created_at || a.closing_date || a.entry_date || "";
        const kb = b.created_at || b.closing_date || b.entry_date || "";
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
    if (chosen.length === 0) return;
    const sections = chosen.map((h) => {
      const { body } = buildHandoverSlipBody({
        handover: h,
        receipts: receiptsByH[h.id] ?? [],
        expenses: expensesByH[h.id] ?? [],
        receiptsByService,
        serviceMap,
        totalAgents,
        agentDue,
        hideSig: true,
      });
      // If this slip was already physically printed on the paper, render its
      // real layout but keep it invisible so the exact same vertical space
      // stays blank/white — the next slip then lands in the right position.
      if (blankIds.has(h.id)) {
        return body.replace('class="slip"', 'class="slip blankfill"');
      }
      return body;
    }).join("");
    // "Sign" toggle: show ONE signature line fixed at the bottom of every
    // printed page (repeats per page), not one per handover slip.
    const sigCss = showSig ? `
      @page { size: A4; margin: 8mm 8mm 26mm 8mm; }
      .pagesig { position: fixed; bottom: 0; left: 0; right: 0; display:flex; justify-content:space-between; gap:40px; padding:6px 4mm 9mm; font-size:10px; }
      .pagesig div { border-top:1px solid #111; padding-top:3px; width:38%; text-align:center; }
    ` : "";
    const escName = (v: unknown) =>
      String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
    const uniqFrom = Array.from(new Set(chosen.map((h) => h.from_name).filter(Boolean)));
    const uniqTo = Array.from(new Set(chosen.map((h) => h.to_name).filter(Boolean)));
    const fromName = uniqFrom.length === 1 ? escName(uniqFrom[0]) : "";
    const toName = uniqTo.length === 1 ? escName(uniqTo[0]) : "MD Sir";
    const sigFooter = showSig
      ? `<div class="pagesig"><div>প্রেরক<br/>${fromName}</div><div>গ্রহীতা<br/>${toName}</div></div>`
      : "";
    const docTitle = buildFileTitle("Cash_Handovers", `${chosen.length}_slips`, formatDate(new Date().toISOString().slice(0, 10)));
    const html = `<!doctype html><html><head><title>${docTitle}</title>
      <style>${SLIP_CSS}${sigCss}</style></head><body>${sections}${sigFooter}</body></html>`;
    printDocHtml(html, docTitle);
    setPrintOpen(false);
  };

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
        <div className="shrink-0 text-xs px-2.5 py-1.5 rounded-md border bg-muted/30 text-muted-foreground whitespace-nowrap">
          ফলাফল: <span className="font-semibold text-foreground tabular-nums">{visible.length}</span>
        </div>
      </div>
      {selectable && visible.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-3 py-2">
          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
            <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
            সব নির্বাচন
          </label>
          <span className="text-xs text-muted-foreground">
            নির্বাচিত: <span className="font-semibold text-foreground tabular-nums">{selectedIds.size}</span>
          </span>
          {selectedIds.size > 0 && (
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 text-muted-foreground"
              onClick={() => setSelectedIds(new Set())}>
              <XCircle className="h-3.5 w-3.5" /> বাতিল
            </Button>
          )}
          <Button type="button" size="sm" className="h-8 gap-1.5 ml-auto"
            disabled={selectedIds.size === 0} onClick={openPrintDialog}>
            <Printer className="h-3.5 w-3.5" /> নির্বাচিত প্রিন্ট ({selectedIds.size})
          </Button>
        </div>
      )}
      {selectable && (
        <Dialog open={printOpen} onOpenChange={setPrintOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>নির্বাচিত প্রিন্ট ({selectedIds.size} টি)</DialogTitle>
              <DialogDescription>
                যেটা আগে প্রিন্ট করা হয়ে গেছে সেটিতে টিক দিলে ঐ কাগজের জায়গা সাদা খালি প্রিন্ট হবে।
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[50vh] overflow-y-auto space-y-1.5 pr-1">
              {visible
                .filter((h) => selectedIds.has(h.id))
                .slice()
                .sort((a, b) => {
                  // Same chronological order as the actual print output
                  // (oldest first) so a ticked row's blank space lands in the
                  // matching position on paper — no more reversed feeling.
                  const ka = a.created_at || a.closing_date || a.entry_date || "";
                  const kb = b.created_at || b.closing_date || b.entry_date || "";
                  return ka < kb ? -1 : ka > kb ? 1 : 0;
                })
                .map((h) => (
                <label
                  key={h.id}
                  className="flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm cursor-pointer select-none hover:bg-muted/40"
                >
                  <Checkbox checked={blankIds.has(h.id)} onCheckedChange={() => toggleBlank(h.id)} />
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold text-foreground truncate">{h.handover_id ?? "—"}</span>
                    <span className="block text-xs">
                      <span className="font-medium">{formatDate(h.entry_date ?? h.created_at?.slice(0, 10))}</span>
                      <span className="text-muted-foreground"> · {h.from_name ?? "—"} → {h.to_name ?? "MD Sir"}</span>
                    </span>
                  </span>
                  {blankIds.has(h.id) && (
                    <span className="shrink-0 text-[11px] font-medium text-muted-foreground">সাদা খালি</span>
                  )}
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-xs text-muted-foreground">
                সাদা খালি: <span className="font-semibold text-foreground tabular-nums">{blankIds.size}</span> টি
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={showSig ? "default" : "outline"}
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setShowSig((v) => !v)}
                  title="প্রিন্টে প্রেরক ও গ্রহীতার সাক্ষরের জায়গা"
                >
                  Sign
                </Button>
                <Button type="button" size="sm" className="gap-1.5" onClick={printSelected}>
                  <Printer className="h-3.5 w-3.5" /> প্রিন্ট করুন
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
      <div className="space-y-7">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">লোড হচ্ছে…</div>
        ) : (() => {
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
              totalAgents={totalAgents}
              agentDue={agentDue}
              mode={mode}
              approveAction={approveAction}
              allowCancel={allowCancel}
              selectable={selectable}
              selected={selectedIds.has(h.id)}
              onToggleSelect={() => toggleSelect(h.id)}
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

// Shared print CSS for a single cash-handover slip (used by single + multi print).
const SLIP_CSS = `
  * { box-sizing:border-box; }
  @page { size: A4; margin: 8mm; }
  html, body { width:100%; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; color:#111; margin:0; padding:0; font-size:11px; }
  .slip { page-break-inside:avoid; break-inside:avoid; width:100%; max-width:100%; overflow:hidden; }
  .slip + .slip { margin-top:14px; padding-top:14px; border-top:1px dashed #999; }
  .slip.blank { min-height:120px; }
  /* Already-printed slip: keep exact footprint, print nothing (white). */
  .slip.blankfill { visibility:hidden; }
  .slip.blankfill * { visibility:hidden !important; }
  .h { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:flex-end; gap:6px; border-bottom:2px solid #111; padding-bottom:4px; margin-bottom:6px; }
  .h h1 { margin:0; font-size:15px; }
  .h .hid { font-family:ui-monospace,Menlo,monospace; font-size:13px; font-weight:800; letter-spacing:.5px; border:1.5px solid #111; border-radius:5px; padding:2px 8px; white-space:nowrap; }
  .h .meta { text-align:right; font-size:10px; line-height:1.5; }
  .h .meta b { font-weight:600; }
  h2 { font-size:11px; margin:8px 0 3px; font-weight:700; }
  table { width:100%; max-width:100%; border-collapse:collapse; font-size:9.5px; table-layout:auto; }
  th, td { border:1px solid #bbb; padding:2px 4px; text-align:left; vertical-align:top; line-height:1.3; overflow-wrap:anywhere; word-break:break-word; }
   th { background:#eee; font-weight:600; text-align:center; }
   td.r { text-align:right; }
  td.nw, th.nw { white-space:nowrap; overflow-wrap:normal; word-break:normal; }
  .b { font-weight:700; }
  .sub { display:block; color:#555; font-size:8.5px; line-height:1.25; font-weight:400; }
  .mono { font-family: ui-monospace, monospace; }
  .sky { color:#0369a1; }
  .rose { color:#be123c; }
  .emer { color:#047857; }
  .orange { color:#c2410c; }
  .violet { color:#6d28d9; }
  .tint1 { background:#f7f7f7; }
  .sumrow td { background:#ececec; font-weight:700; }
  .adv { background:#fde68a; color:#92400e; font-size:8px; font-weight:700; padding:0 3px; border-radius:3px; }
  .tot { margin-top:5px; font-size:11px; font-weight:700; }
  .bar { margin-top:6px; border:1px solid #111; border-radius:4px; padding:5px 8px; font-size:11px; font-weight:700; display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
  .sig { margin-top:34px; display:flex; justify-content:space-between; font-size:10px; }
  .sig div { border-top:1px solid #111; padding-top:3px; width:38%; text-align:center; }
`;

// Build a full self-contained slip body (header + receipts + expenses + totals)
// for ONE handover. Returns the inner <body> HTML + a suggested file title, so
// both single-card print and multi-select print reuse identical math + layout.
function buildHandoverSlipBody(args: {
  handover: Handover;
  receipts: Receipt[];
  expenses?: Expense[];
  receiptsByService: Record<string, Receipt[]>;
  serviceMap: Record<string, ServiceInfo>;
  totalAgents: Set<string>;
  agentDue: Map<string, { due: number; advance: number }>;
  hideSig?: boolean;
}): { body: string; title: string } {
  const { handover, receipts, expenses = [], receiptsByService, serviceMap, totalAgents, agentDue, hideSig = false } = args;
  const esc = (v: unknown) =>
    String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const submitted = Number(handover.submitted_amount ?? handover.amount ?? 0);
  const confirmed = Number(handover.confirmed_amount ?? 0);
  const cashReceipts = receipts.reduce((s, r) => s + (isCashMethod(r.method) ? Number(r.amount || 0) : 0), 0);
  const mdReceipts = receipts.reduce((s, r) => s + (isMdReceivedMethod(r.method) ? Number(r.amount || 0) : 0), 0);
  const vendorReceipts = receipts.reduce((s, r) => s + (isVendorReceivedMethod(r.method) ? Number(r.amount || 0) : 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);

  const moneyServiceKeys = new Set(
    receipts.filter((r) => !isStatusEventReceipt(r) && Number(r.amount || 0) > 0).map(receiptServiceKey).filter(Boolean)
  );
  const visibleReceipts = receipts.filter((r) => {
    if (!isStatusEventReceipt(r)) return true;
    const key = receiptServiceKey(r);
    if (moneyServiceKeys.has(key)) return false;
    const agent = String(serviceMap[key]?.agent ?? "").trim();
    return !(agent && totalAgents.has(agent));
  });

  const rank = (entry?: string | null, created?: string | null) =>
    `${String(entry ?? "").slice(0, 10)}T${String(created ?? "")}`;
  const cutoffRank = rank(handover.entry_date, handover.created_at);

  const metricsFor = (r: Receipt) => {
    const sk = receiptServiceKey(r);
    const info = sk ? serviceMap[sk] : undefined;
    const allForSvc = sk ? (receiptsByService[sk] ?? []) : [];
    const past = allForSvc.filter((x) => x.id !== r.id && rank(x.entry_date, x.created_at) < cutoffRank);
    const future = allForSvc.filter((x) => x.id !== r.id && rank(x.entry_date, x.created_at) > cutoffRank);
    const previousPaid = past.reduce((s, x) => s + Number(x.amount || 0), 0);
    const futurePaid = future.reduce((s, x) => s + Number(x.amount || 0), 0);
    const lastPast = past.length
      ? past.reduce((a, b) => (rank(a.entry_date, a.created_at) > rank(b.entry_date, b.created_at) ? a : b))
      : null;
    const lastFuture = future.length
      ? future.reduce((a, b) => (rank(a.entry_date, a.created_at) < rank(b.entry_date, b.created_at) ? a : b))
      : null;
    const totalPaidIncl = allForSvc.reduce((s, x) => s + Number(x.amount || 0), 0);
    const bill = info?.sold_price ?? 0;
    const discount = info?.discount ?? 0;
    const due = bill > 0 ? Math.max(0, bill - totalPaidIncl - discount) : 0;
    const dueAfterThis = bill > 0 ? Math.max(0, bill - (previousPaid + Number(r.amount || 0)) - discount) : 0;
    const isAdvance = !!info?.has_delivery && isAdvancePayment(r.entry_date, info?.delivery_date);
    const statusEvt = isStatusEventReceipt(r);
    return {
      sk, info, previousPaid, futurePaid, lastPast, lastFuture, bill, discount, due, dueAfterThis,
      isAdvance, statusEvt,
      mdRecv: isMdReceivedMethod(r.method) && !statusEvt,
      vendorRecv: isVendorReceivedMethod(r.method) && !statusEvt,
      past, future,
    };
  };

  type SingleRow = { kind: "single"; r: Receipt; m: ReturnType<typeof metricsFor> };
  type AgencyRow = {
    kind: "agency"; agent: string; items: number; svcCount: number;
    totalBill: number; totalDiscount: number; totalPrevious: number;
    totalThis: number; totalDueAfter: number; totalFuture: number;
    ledgerDue: number; ledgerAdvance: number;
    cash: number; md: number; vendor: number; date: string;
  };
  type DisplayRow = SingleRow | AgencyRow;

  const displayRows: DisplayRow[] = [];
  {
    const buckets = new Map<string, Receipt[]>();
    for (const r of visibleReceipts) {
      const agent = String(serviceMap[receiptServiceKey(r)]?.agent ?? "").trim();
      if (agent && totalAgents.has(agent)) {
        const arr = buckets.get(agent) ?? [];
        arr.push(r);
        buckets.set(agent, arr);
      } else {
        displayRows.push({ kind: "single", r, m: metricsFor(r) });
      }
    }
    for (const [agent, recs] of buckets) {
      const recIds = new Set(recs.map((x) => x.id));
      // মোটের উপর (total-settle): the agency is ONE pool. মোট বিল / পূর্বের জমা /
      // মোট বাকি must reflect the WHOLE agency, not only the passenger-services
      // that happen to appear in this handover. Aggregate across every loaded
      // service that belongs to this agency.
      const svcKeys = Object.keys(serviceMap).filter(
        (k) => String(serviceMap[k]?.agent ?? "").trim() === agent
      );
      let totalBill = 0, totalDiscount = 0, totalPrevious = 0, totalDueAfter = 0, totalFuture = 0;
      for (const sk of svcKeys) {
        const info = serviceMap[sk];
        const allForSvc = receiptsByService[sk] ?? [];
        const bill = info?.sold_price ?? 0;
        const discount = info?.discount ?? 0;
        const previousPaid = allForSvc
          .filter((x) => !recIds.has(x.id) && rank(x.entry_date, x.created_at) < cutoffRank)
          .reduce((s, x) => s + Number(x.amount || 0), 0);
        const futurePaid = allForSvc
          .filter((x) => !recIds.has(x.id) && rank(x.entry_date, x.created_at) > cutoffRank)
          .reduce((s, x) => s + Number(x.amount || 0), 0);
        const currentPaid = recs
          .filter((x) => receiptServiceKey(x) === sk)
          .reduce((s, x) => s + Number(x.amount || 0), 0);
        totalBill += bill;
        totalDiscount += discount;
        totalPrevious += previousPaid;
        totalFuture += futurePaid;
        if (bill > 0) totalDueAfter += Math.max(0, bill - discount - previousPaid - currentPaid);
      }
      displayRows.push({
        kind: "agency", agent, items: recs.length, svcCount: svcKeys.length,

        totalBill, totalDiscount, totalPrevious,
        totalThis: recs.reduce((s, x) => s + Number(x.amount || 0), 0),
        totalDueAfter, totalFuture,
        ledgerDue: agentDue.get(agent)?.due ?? totalDueAfter,
        ledgerAdvance: agentDue.get(agent)?.advance ?? 0,
        cash: recs.filter((x) => isCashMethod(x.method)).reduce((s, x) => s + Number(x.amount || 0), 0),
        md: recs.filter((x) => isMdReceivedMethod(x.method)).reduce((s, x) => s + Number(x.amount || 0), 0),
        vendor: recs.filter((x) => isVendorReceivedMethod(x.method)).reduce((s, x) => s + Number(x.amount || 0), 0),
        date: recs[0]?.entry_date ?? handover.entry_date,
      });
    }
  }

  const bodyRows = displayRows.map((row, idx) => {
    if (row.kind === "agency") {
      const billCell = row.totalBill > 0
        ? `<span class="b">${esc(fmt(row.totalBill))}</span>`
          + (row.totalDiscount > 0 ? `<span class="sub emer">${esc(fmt(row.totalDiscount))} ${DISCOUNT_LABEL}</span>` : "")
        : "—";
      const prevCell = row.totalPrevious > 0
        ? `<span class="b sky">${esc(fmt(row.totalPrevious))}</span>`
        : `<span class="sub">— নতুন —</span>`;
      const mdCell = (row.md > 0 || row.vendor > 0)
        ? (row.md > 0 ? `<span class="b sky">${esc(fmt(row.md))}</span>` : "")
          + (row.vendor > 0 ? `<span class="sub orange">Vendor: ${esc(fmt(row.vendor))}</span>` : "")
        : "—";
      const staffCell = row.cash > 0 ? `<span class="b emer">${esc(fmt(row.cash))}</span>` : "—";
      const dueCell = row.ledgerDue > 0.005
        ? `<span class="b rose">${esc(fmt(row.ledgerDue))}</span><span class="sub">মোট বাকি</span>`
        : row.ledgerAdvance > 0.005
          ? `<span class="b sky">+${esc(fmt(row.ledgerAdvance))}</span><span class="sub">অগ্রিম</span>`
          : `<span class="emer b">✓</span>`;
      return `<tr class="rt tint${idx % 2}">
        <td class="nw">${esc(formatDate(row.date))}<span class="sub">মোটের উপর</span></td>
        <td><span class="b">${esc(row.agent)}</span><span class="sub">এজেন্সি · ${row.items} টি passenger</span></td>
        <td><span>${row.svcCount} টি সার্ভিস (মোট হিসাব)</span><span class="sub">passenger তথ্য → এজেন্সি লেজার</span></td>
        <td class="r nw">${billCell}</td>
        <td class="r nw">${prevCell}</td>
        <td class="r nw">${mdCell}</td>
        <td class="r nw">${staffCell}</td>
        <td class="r nw">${dueCell}</td>
      </tr>`;
    }

    const { r, m } = row;
    const { info, previousPaid, futurePaid, lastPast, lastFuture, bill, discount, dueAfterThis,
      isAdvance, statusEvt, mdRecv, vendorRecv, past } = m;

    const dateCell = `${esc(formatDate(r.entry_date))}`
      + (r.ref_id ? `<span class="sub mono">${esc(r.ref_id)}</span>` : "");
    const custCell = `<span class="b">${esc(r.passenger_name || "—")}</span>`
      + `<span class="sub">A: ${esc(info?.agent || "Self")}</span>`;
    const svcCell = `<span>${esc(primaryServiceLabel(r, info))}</span>`
      + (info?.service_name && r.service_table !== "agency_ledger" ? `<span class="sub">${esc(info.service_name)}</span>` : "")
      + (info?.country ? `<span class="sub">${esc(info.country)}</span>` : "")
      + (info?.airline ? `<span class="sub">${esc(info.airline)}${info.flight_date ? ` - ${esc(formatDate(info.flight_date))}` : ""}</span>` : "");
    const vendorBit = info?.vendor
      ? `<span class="sub">V: ${esc(info.vendor)}${info.vendor_price > 0 ? ` -${Math.round(info.vendor_price).toLocaleString()}/` : (info.tracks_cost ? " ⚠️" : "")}</span>`
      : "";
    const billCell = bill > 0
      ? `<span class="b">${esc(fmt(bill))}</span>`
        + (discount > 0 ? `<span class="sub emer">${esc(fmt(discount))} ${DISCOUNT_LABEL}</span>` : "")
        + vendorBit
      : `—${vendorBit}`;
    const prevCell = previousPaid > 0
      ? `<span class="b sky">${esc(fmt(previousPaid))}</span>${lastPast ? `<span class="sub sky">${esc(formatDate(lastPast.entry_date))}${past.length > 1 ? ` +${past.length - 1}` : ""}</span>` : ""}`
      : `<span class="sub">— নতুন —</span>`;
    const mdCell = mdRecv
      ? `<span class="b sky">${esc(fmt(r.amount))}</span><span class="sub sky">MD · ${esc(methodLabel(r.method))}</span>`
      : vendorRecv
        ? `<span class="b orange">${esc(fmt(r.amount))}</span><span class="sub orange">Vendor Rece</span>`
        : "—";
    const staffCell = (!mdRecv && !vendorRecv)
      ? `${isAdvance ? `<span class="adv">অগ্রিম</span> ` : ""}<span class="b emer">${esc(fmt(r.amount))}</span>`
      : "—";
    const payCells = statusEvt
      ? `<td class="r nw" colspan="2"><span class="b violet">📦 ${esc(cleanStatusText(r.remarks))}</span></td>`
      : `<td class="r nw">${mdCell}</td><td class="r nw">${staffCell}</td>`;
    const dueCell = bill > 0
      ? (dueAfterThis <= 0.005
          ? `<span class="emer b">✓</span>`
          : `<span class="b rose">${esc(fmt(dueAfterThis))}</span>${futurePaid > 0 && lastFuture ? `<span class="sub emer">জমা: ${esc(fmt(futurePaid))} ${esc(formatDate(lastFuture.entry_date))}</span>` : ""}`)
      : "—";

    return `<tr class="rt tint${idx % 2}">
      <td class="nw">${dateCell}</td>
      <td>${custCell}</td>
      <td>${svcCell}</td>
      <td class="r nw">${billCell}</td>
      <td class="r nw">${prevCell}</td>
      ${payCells}
      <td class="r nw">${dueCell}</td>
    </tr>`;
  }).join("");

  const totalRow = `<tr class="sumrow">
    <td colspan="5" class="r">মোট (${visibleReceipts.length} আইটেম)</td>
    <td class="r nw">${mdReceipts > 0 ? `<span class="b sky">MD: ${esc(fmt(mdReceipts))}</span>` : ""}${vendorReceipts > 0 ? `<span class="sub orange">Vendor: ${esc(fmt(vendorReceipts))}</span>` : ""}${mdReceipts <= 0 && vendorReceipts <= 0 ? "—" : ""}</td>
    <td class="r nw"><span class="b emer">নগদ: ${esc(fmt(cashReceipts))}</span></td>
    <td></td>
  </tr>`;

  const expenseRows = expenses.map((e, idx) => `<tr class="rt tint${idx % 2}">
      <td class="nw">${esc(formatDate(e.entry_date))}</td>
      <td class="nw">${esc(e.category || "—")}</td>
      <td>${esc(e.purpose || "—")}</td>
      <td class="nw">${esc(e.spent_by_name || "—")}</td>
      <td class="r nw rose b">−${esc(fmt(e.amount))}</td>
    </tr>`).join("");

  const title = buildFileTitle(
    "Cash_Handover",
    handover.handover_id ?? handover.id.slice(0, 8),
    handover.from_name ?? "",
    formatDate(handover.closing_date || handover.entry_date),
  );

  const body = `<div class="slip">
    <div class="h">
      <h1>Asia Travels &amp; Tours</h1>
      <div class="hid">${esc(handover.handover_id ?? handover.id.slice(0, 8))}</div>
      <div class="meta">
        তারিখ: ${esc(formatDate(handover.closing_date || handover.entry_date))}<br/>
        প্রেরক: ${esc(handover.from_name ?? "—")} → গ্রহীতা: ${esc(handover.to_name ?? "MD Sir")}
      </div>
    </div>
    <h2>জমার বিবরণ</h2>
    <table>
      <thead>
        <tr>
          <th class="nw" rowspan="2">তারিখ</th><th rowspan="2">কাস্টমার</th><th rowspan="2">সার্ভিস</th>
          <th class="r nw" rowspan="2">মোট বিল</th><th class="r nw" rowspan="2">পূর্বের জমা</th>
          <th class="r" colspan="2">এই বারের জমা</th>
          <th class="r nw" rowspan="2">বাকি</th>
        </tr>
        <tr><th class="r nw">MD</th><th class="r nw">নগদ</th></tr>
      </thead>
      <tbody>${bodyRows ? bodyRows + totalRow : `<tr><td colspan="8" style="text-align:center">কোনো passenger receipt নেই</td></tr>`}</tbody>
    </table>
    ${expenses.length > 0 ? `
      <h2>💸 খরচের বিবরণ — ${expenses.length} টি</h2>
      <table>
        <thead><tr><th class="nw">তারিখ</th><th class="nw">খাত</th><th>বিবরণ</th><th class="nw">খরচকারী</th><th class="r nw">টাকা</th></tr></thead>
        <tbody>${expenseRows}<tr class="sumrow"><td colspan="4" class="r">মোট খরচ (${expenses.length} টি)</td><td class="r nw rose">−${esc(fmt(totalExpenses))}</td></tr></tbody>
      </table>
    ` : ""}
    ${confirmed > 0 && confirmed !== submitted ? `<div class="tot">Confirmed: ${esc(fmt(confirmed))} · Variance: ${confirmed - submitted > 0 ? "+" : ""}${esc(fmt(confirmed - submitted))}</div>` : ""}
    ${handover.remarks ? `<div class="tot" style="font-weight:400">📝 ${esc(handover.remarks)}</div>` : ""}
    <div class="bar">
       <span>মোট ${visibleReceipts.length} আইটেম থেকে মোট আয় <span class="b">${esc(fmt(mdReceipts + cashReceipts))}</span></span>
       ${mdReceipts > 0 ? `<span class="sky">MD ${esc(fmt(mdReceipts))}</span>` : ""}
       <span>(নগদ ${esc(fmt(cashReceipts))} − <span class="rose">খরচ ${esc(fmt(totalExpenses))}</span> = <span class="b emer" style="font-size:1.25em">জমা ${esc(fmt(submitted))}</span>)</span>
    </div>
    ${hideSig ? "" : `<div class="sig">
      <div>প্রেরক<br/>${esc(handover.from_name ?? "")}</div>
      <div>গ্রহীতা<br/>${esc(handover.to_name ?? "MD Sir")}</div>
    </div>`}
  </div>`;

  return { body, title };
}



function HandoverCard({
  handover, receipts, expenses = [], receiptsByService, serviceMap, totalAgents, agentDue, mode, approveAction, allowCancel, selectable, selected, onToggleSelect, onChanged,
}: {
  handover: Handover;
  receipts: Receipt[];
  expenses?: Expense[];
  receiptsByService: Record<string, Receipt[]>;
  serviceMap: Record<string, ServiceInfo>;
  totalAgents: Set<string>;
  agentDue: Map<string, { due: number; advance: number }>;
  mode: "mine" | "to-me";
  approveAction?: { busyId: string | null; onApprove: (receipt: Receipt) => void };
  allowCancel?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
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
  const visibleReceipts = receipts.filter((r) => {
    if (!isStatusEventReceipt(r)) return true;
    const key = receiptServiceKey(r);
    if (moneyServiceKeys.has(key)) return false;
    const agent = String(serviceMap[key]?.agent ?? "").trim();
    return !(agent && totalAgents.has(agent));
  });
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

  // Order receipts by business date (entry_date) first, created_at only as tie-break.
  // Using created_at alone mis-sorts back-dated receipts (earlier date, entered later),
  // which wrongly shifted them out of "পূর্বের জমা".
  const rank = (entry?: string | null, created?: string | null) =>
    `${String(entry ?? "").slice(0, 10)}T${String(created ?? "")}`;
  const cutoffRank = rank(handover.entry_date, handover.created_at);
  const firstPendingReceipt = receipts.find((r) => r.approval_status !== "approved") ?? receipts[0];

  // Per-receipt FIFO metrics (পূর্বের জমা / বাকি) — shared by the on-screen
  // table and the printed slip so both show identical numbers.
  const metricsFor = (r: Receipt) => {
    const sk = receiptServiceKey(r);
    const info = sk ? serviceMap[sk] : undefined;
    const allForSvc = sk ? (receiptsByService[sk] ?? []) : [];
    const past = allForSvc.filter((x) => x.id !== r.id && rank(x.entry_date, x.created_at) < cutoffRank);
    const future = allForSvc.filter((x) => x.id !== r.id && rank(x.entry_date, x.created_at) > cutoffRank);
    const previousPaid = past.reduce((s, x) => s + Number(x.amount || 0), 0);
    const futurePaid = future.reduce((s, x) => s + Number(x.amount || 0), 0);
    const lastPast = past.length
      ? past.reduce((a, b) => (rank(a.entry_date, a.created_at) > rank(b.entry_date, b.created_at) ? a : b))
      : null;
    const lastFuture = future.length
      ? future.reduce((a, b) => (rank(a.entry_date, a.created_at) < rank(b.entry_date, b.created_at) ? a : b))
      : null;
    const totalPaidIncl = allForSvc.reduce((s, x) => s + Number(x.amount || 0), 0);
    const bill = info?.sold_price ?? 0;
    const discount = info?.discount ?? 0;
    const due = bill > 0 ? Math.max(0, bill - totalPaidIncl - discount) : 0;
    const dueAfterThis = bill > 0 ? Math.max(0, bill - (previousPaid + Number(r.amount || 0)) - discount) : 0;
    const isAdvance = !!info?.has_delivery && isAdvancePayment(r.entry_date, info?.delivery_date);
    const statusEvt = isStatusEventReceipt(r);
    return {
      sk, info, previousPaid, futurePaid, lastPast, lastFuture, bill, discount, due, dueAfterThis,
      isAdvance, statusEvt,
      mdRecv: isMdReceivedMethod(r.method) && !statusEvt,
      vendorRecv: isVendorReceivedMethod(r.method) && !statusEvt,
      past, future,
    };
  };

  type SingleRow = { kind: "single"; r: Receipt; m: ReturnType<typeof metricsFor> };
  type AgencyRow = {
    kind: "agency"; agent: string; items: number; svcCount: number;
    totalBill: number; totalDiscount: number; totalPrevious: number;
    totalThis: number; totalDueAfter: number; totalFuture: number;
    ledgerDue: number; ledgerAdvance: number;
    cash: number; md: number; vendor: number; date: string;
  };
  type DisplayRow = SingleRow | AgencyRow;

  // মোটের উপর (total-settle) agencies: passenger-level detail belongs ONLY in the
  // agency ledger. In the handover we collapse all of an agency's receipts into a
  // single line showing that agency's মোট বিল / পূর্বের জমা / এই বারের জমা / মোট বাকি.
  // Other parties keep their per-passenger rows.
  const displayRows: DisplayRow[] = [];
  {
    const buckets = new Map<string, Receipt[]>();
    for (const r of visibleReceipts) {
      const agent = String(serviceMap[receiptServiceKey(r)]?.agent ?? "").trim();
      if (agent && totalAgents.has(agent)) {
        const arr = buckets.get(agent) ?? [];
        arr.push(r);
        buckets.set(agent, arr);
      } else {
        displayRows.push({ kind: "single", r, m: metricsFor(r) });
      }
    }
    for (const [agent, recs] of buckets) {
      const recIds = new Set(recs.map((x) => x.id));
      // মোটের উপর (total-settle): aggregate the WHOLE agency pool (মোট বিল /
      // পূর্বের জমা / মোট বাকি), not just the passenger-services in this handover.
      const svcKeys = Object.keys(serviceMap).filter(
        (k) => String(serviceMap[k]?.agent ?? "").trim() === agent
      );
      let totalBill = 0, totalDiscount = 0, totalPrevious = 0, totalDueAfter = 0, totalFuture = 0;
      for (const sk of svcKeys) {
        const info = serviceMap[sk];
        const allForSvc = receiptsByService[sk] ?? [];
        const bill = info?.sold_price ?? 0;
        const discount = info?.discount ?? 0;
        const previousPaid = allForSvc
          .filter((x) => !recIds.has(x.id) && rank(x.entry_date, x.created_at) < cutoffRank)
          .reduce((s, x) => s + Number(x.amount || 0), 0);
        const futurePaid = allForSvc
          .filter((x) => !recIds.has(x.id) && rank(x.entry_date, x.created_at) > cutoffRank)
          .reduce((s, x) => s + Number(x.amount || 0), 0);
        const currentPaid = recs
          .filter((x) => receiptServiceKey(x) === sk)
          .reduce((s, x) => s + Number(x.amount || 0), 0);
        totalBill += bill;
        totalDiscount += discount;
        totalPrevious += previousPaid;
        totalFuture += futurePaid;
        if (bill > 0) totalDueAfter += Math.max(0, bill - discount - previousPaid - currentPaid);
      }
      displayRows.push({
        kind: "agency", agent, items: recs.length, svcCount: svcKeys.length,
        totalBill, totalDiscount, totalPrevious,

        totalThis: recs.reduce((s, x) => s + Number(x.amount || 0), 0),
        totalDueAfter, totalFuture,
        ledgerDue: agentDue.get(agent)?.due ?? totalDueAfter,
        ledgerAdvance: agentDue.get(agent)?.advance ?? 0,
        cash: recs.filter((x) => isCashMethod(x.method)).reduce((s, x) => s + Number(x.amount || 0), 0),
        md: recs.filter((x) => isMdReceivedMethod(x.method)).reduce((s, x) => s + Number(x.amount || 0), 0),
        vendor: recs.filter((x) => isVendorReceivedMethod(x.method)).reduce((s, x) => s + Number(x.amount || 0), 0),
        date: recs[0]?.entry_date ?? handover.entry_date,
      });
    }
  }


  // Each handover gets a distinct, status-colored accent so one card is clearly
  // separated from the next at a glance. Pending cards get a much stronger,
  // eye-catching amber treatment so they never look like settled history.
  const accent =
    status === "approved"
      ? "border-emerald-500/60 border-l-emerald-500 ring-emerald-500/10 bg-card"
      : status === "pending"
        ? "border-amber-500 border-l-amber-500 ring-2 ring-amber-500/40 bg-amber-500/[0.07] shadow-[0_0_22px_-4px_rgba(245,158,11,0.55)]"
        : "border-rose-500/60 border-l-rose-500 ring-rose-500/10 bg-card";

  // Print a full, self-contained slip for THIS handover (header + all receipts
  // + expenses + totals), reusing the same per-row math shown on screen.
  const printThis = () => {
    const { body, title } = buildHandoverSlipBody({
      handover, receipts, expenses, receiptsByService, serviceMap, totalAgents, agentDue,
    });
    const safeTitle = title.replace(/</g, "").replace(/>/g, "");
    const html = `<!doctype html><html><head><title>${safeTitle}</title>
      <style>${SLIP_CSS}</style></head><body>${body}</body></html>`;
    printDocHtml(html, title);
  };


  return (
    <div
      id={`handover-card-${handover.id}`}
      className={`rounded-xl border-2 border-l-[6px] ${cardHighlight ? "border-red-500 border-l-red-500 ring-2 ring-red-500 bg-red-500/15 shadow-[0_0_26px_-4px_rgba(239,68,68,0.6)]" : accent} shadow-lg ring-1 overflow-hidden transition-colors`}>
      {/* Header */}
      <div className={`${isPending ? "bg-amber-500/20 border-amber-500/40" : "bg-muted/40"} px-4 py-2.5 border-b-2 flex flex-wrap items-center gap-2`}>

        <div className="flex items-center gap-2 min-w-0 flex-1">
          {selectable && (
            <Checkbox
              checked={!!selected}
              onCheckedChange={() => onToggleSelect?.()}
              aria-label="প্রিন্টের জন্য নির্বাচন"
              className="shrink-0"
            />
          )}
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
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={printThis}
          title="এই handover প্রিন্ট / PDF করুন"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          <Printer className="h-4 w-4" />
        </Button>
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
        <table className="w-full table-fixed text-sm min-w-[720px]">
          <colgroup>
            <col className="w-[11%]" />
            <col className="w-[22%]" />
            <col className="w-[14%]" />
            <col className="w-[13%]" />
            <col className="w-[10%]" />
            <col className="w-[8%]" />
            <col className="w-[9%]" />
            <col className="w-[5%]" />
            {approveAction && <col className="w-[5%]" />}
          </colgroup>
          <thead className="bg-muted/30">
            <tr className="text-left">
              <th rowSpan={2} className="px-1.5 py-1.5 font-semibold align-bottom">তারিখ</th>
              <th rowSpan={2} className="px-1.5 py-1.5 font-semibold align-bottom">কাস্টমার</th>
              <th rowSpan={2} className="px-1.5 py-1.5 font-semibold align-bottom">সার্ভিস</th>
              <th rowSpan={2} className="px-1.5 py-1.5 font-semibold text-right align-bottom">মোট বিল</th>
              <th rowSpan={2} className="px-1.5 py-1.5 font-semibold text-right align-bottom">পূর্বের জমা</th>
              <th colSpan={2} className="px-1.5 py-1 font-semibold text-center border-b border-border">এই বারের জমা</th>
              <th rowSpan={2} className="px-1.5 py-1.5 font-bold text-right text-sm align-bottom">বাকি</th>
              {approveAction && <th rowSpan={2} className="px-1 py-1.5 pr-2 font-semibold text-center align-bottom">✓</th>}
            </tr>
            <tr className="text-left">
              <th className="px-1.5 py-1 font-semibold text-right text-xs text-sky-600 dark:text-sky-400">MD</th>
              <th className="px-1.5 py-1 font-semibold text-right text-xs text-emerald-700 dark:text-emerald-400">নগদ</th>
            </tr>
          </thead>

          <tbody>
            {displayRows.length === 0 ? (
              <tr><td colSpan={approveAction ? 9 : 8} className="px-3 py-4 text-center text-muted-foreground">কোনো passenger receipt নেই</td></tr>
            ) : displayRows.map((row, idx) => {
              if (row.kind === "agency") {
                return (
                  <tr key={`agency-${row.agent}`} className={`border-t align-top row-tint-${idx % 4}`}>
                    <td className="px-1.5 py-1 align-top">
                      <div className="text-sm font-medium leading-tight">{formatDate(row.date)}</div>
                      <div className="text-xs text-muted-foreground leading-tight">মোটের উপর</div>
                    </td>
                    <td className="px-1.5 py-1 align-top">
                      <div className="text-sm font-semibold leading-tight">{row.agent}</div>
                      <div className="text-xs text-muted-foreground leading-tight">এজেন্সি · {row.items} টি passenger</div>
                    </td>
                    <td className="px-1.5 py-1 align-top">
                      <div className="text-sm font-medium leading-tight">{row.svcCount} টি সার্ভিস (মোট হিসাব)</div>
                      <div className="text-xs text-muted-foreground leading-tight">passenger তথ্য → এজেন্সি লেজার</div>
                    </td>
                    <td className="px-1.5 py-1 text-right align-top">
                      {(() => {
                        const prevDue = row.ledgerDue + row.totalThis - row.ledgerAdvance;
                        return (
                          <>
                            {prevDue > 0.005 ? (
                              <div className="text-sm tabular-nums text-muted-foreground leading-tight">আগের বাকি: {fmt(prevDue)}</div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {row.ledgerDue > 0.005 ? (
                              <div className="text-sm tabular-nums text-rose-600 leading-tight font-semibold">মোট বাকি: {fmt(row.ledgerDue)}</div>
                            ) : row.ledgerAdvance > 0.005 ? (
                              <div className="text-sm tabular-nums text-sky-600 leading-tight">অগ্রিম জমা: {fmt(row.ledgerAdvance)}</div>
                            ) : (
                              <div className="text-sm text-emerald-600 leading-tight">✓ পরিশোধিত</div>
                            )}
                          </>
                        );
                      })()}
                    </td>
                    <td className="px-1.5 py-1 text-right align-top">
                      {row.totalPrevious > 0 ? (
                        <div className="text-sm font-semibold tabular-nums text-sky-600 dark:text-sky-400 leading-tight">{fmt(row.totalPrevious)}</div>
                      ) : <span className="text-sm text-muted-foreground">— নতুন —</span>}
                    </td>
                    {/* MD রিসিভ */}
                    <td className="px-1.5 py-1 text-right tabular-nums align-top">
                      {row.md > 0 || row.vendor > 0 ? (
                        <>
                          {row.md > 0 && <b className="text-sm text-sky-600 dark:text-sky-400">{fmt(row.md)}</b>}
                          {row.vendor > 0 && <div className="text-sm text-orange-600 dark:text-orange-400 font-semibold leading-tight">Vendor: {fmt(row.vendor)}</div>}
                        </>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    {/* স্টাফ রিসিভ */}
                    <td className="px-1.5 py-1 text-right tabular-nums align-top">
                      {row.cash > 0 ? (
                        <b className="text-sm text-emerald-700 dark:text-emerald-400">{fmt(row.cash)}</b>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>

                    <td className="px-1.5 py-1 text-right tabular-nums text-sm font-bold align-top">
                      {row.ledgerDue > 0.005 ? (
                        <>
                          <div className="text-rose-600 text-sm font-extrabold leading-tight">{fmt(row.ledgerDue)}</div>
                          <div className="text-xs text-muted-foreground font-normal leading-tight">মোট বাকি</div>
                        </>
                      ) : row.ledgerAdvance > 0.005 ? (
                        <>
                          <div className="text-sky-600 text-sm font-extrabold leading-tight">+{fmt(row.ledgerAdvance)}</div>
                          <div className="text-xs text-muted-foreground font-normal leading-tight">অগ্রিম</div>
                        </>
                      ) : (
                        <span className="text-emerald-600 text-base">✓</span>
                      )}
                    </td>
                    {approveAction && <td className="px-0.5 py-1 pr-2 text-center align-top" />}
                  </tr>
                );
              }

              const { r, m } = row;
              const { info, previousPaid, futurePaid, lastPast, lastFuture, bill, discount, due, dueAfterThis,
                isAdvance, statusEvt, mdRecv, vendorRecv, past } = m;
              const isHighlighted = highlightId === r.id;


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
                          <div className="text-sm tabular-nums text-emerald-600 leading-tight">{fmt(discount)} {DISCOUNT_LABEL}</div>
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
                  {/* এই বারের জমা → MD রিসিভ / স্টাফ রিসিভ */}
                  {statusEvt ? (
                    <td colSpan={2} className="px-1.5 py-1 text-right tabular-nums align-top">
                      <div className="text-sm font-semibold text-violet-600 dark:text-violet-400 leading-tight">📦 {cleanStatusText(r.remarks)}</div>
                    </td>
                  ) : (
                    <>
                      {/* MD রিসিভ */}
                      <td className="px-1.5 py-1 text-right tabular-nums align-top">
                        {mdRecv ? (
                          <>
                            <b className="text-sm text-sky-600 dark:text-sky-400">{fmt(r.amount)}</b>
                            <div className="text-sm text-sky-600 dark:text-sky-400 font-semibold leading-tight">MD · {methodLabel(r.method)}</div>
                          </>
                        ) : vendorRecv ? (
                          <>
                            <b className="text-sm text-orange-600 dark:text-orange-400">{fmt(r.amount)}</b>
                            <div className="text-sm text-orange-600 dark:text-orange-400 font-semibold leading-tight">Vendor Rece</div>
                          </>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      {/* স্টাফ রিসিভ */}
                      <td className="px-1.5 py-1 text-right tabular-nums align-top">
                        {!mdRecv && !vendorRecv ? (
                          <>
                            {isAdvance && <AdvanceBadge advance className="mr-1" />}
                            <b className="text-sm text-emerald-700 dark:text-emerald-400">{fmt(r.amount)}</b>
                          </>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                    </>
                  )}

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
                {mdReceipts > 0 && (
                  <div className="text-sky-600 dark:text-sky-400">MD: {fmt(mdReceipts)}</div>
                )}
                {vendorReceipts > 0 && (
                  <div className="text-xs text-orange-600 dark:text-orange-400 font-medium">Vendor: {fmt(vendorReceipts)}</div>
                )}
                {mdReceipts <= 0 && vendorReceipts <= 0 && <span className="text-muted-foreground">—</span>}
              </td>
              <td className="px-1.5 py-1.5 text-right tabular-nums">
                <div className="text-emerald-700 dark:text-emerald-400">নগদ: {fmt(cashReceipts)}</div>
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
            <table className="w-full text-sm min-w-[520px]">
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
          <span className="whitespace-nowrap">মোট {visibleReceipts.length} আইটেম থেকে মোট আয় <b className="tabular-nums text-primary">{fmt(cashReceipts + mdReceipts + vendorReceipts)}</b></span>
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
          <span className="flex items-center gap-1 flex-wrap">
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
