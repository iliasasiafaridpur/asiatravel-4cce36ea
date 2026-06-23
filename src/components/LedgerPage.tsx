import { DateInput } from "@/components/ui/date-input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { resilientInsert } from "@/lib/offline-queue";
import { generateNextId } from "@/lib/idgen";
import { formatDate, statusBadgeClass, isAdvancePayment, type ModuleSchema, type Field } from "@/lib/modules";
import { AdvanceBadge } from "@/components/AdvanceBadge";
import { PageWatermark } from "@/components/PageWatermark";

import { useMobileColors, mobileColorTextClass } from "@/hooks/useMobileColors";
import { LookupSelect } from "@/components/LookupSelect";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PasswordConfirmDialog } from "@/components/PasswordConfirmDialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Wallet,
  RotateCcw,
  Eye,
  CreditCard,
  FileSpreadsheet,
  Printer,
  
} from "lucide-react";
import { toast } from "sonner";
import { notify } from "@/lib/notify";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { FormSections } from "@/components/ModulePage";
import { PartyProfileDrawer } from "@/components/PartyProfileDrawer";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { DUE_RECEIVE_METHODS, isMdReceivedMethod, isVendorReceivedMethod } from "@/lib/payment-methods";

type Row = Record<string, unknown> & { id: string };

interface Props {
  module: ModuleSchema;
  /** When set, auto-open the payment dialog for this group (vendor/agent) on mount. */
  autoPay?: string;
  /** Called once the autoPay dialog has been opened, so the caller can clear the intent. */
  onAutoPayHandled?: () => void;
  /**
   * "full" (default) renders the whole ledger page. "payment-only" renders just
   * the payment entry dialog, and "create-only" renders just the manual new-entry
   * dialog, letting another page (e.g. the Ledger pages) embed the flow without
   * leaving the page.
   */
  renderMode?: "full" | "payment-only" | "create-only";
  /** In payment-only mode, called when the payment dialog is closed. */
  onPaymentClose?: () => void;
  /** In create-only mode, auto-open the manual new-entry dialog on mount. */
  autoCreate?: boolean;
  /** In create-only mode, called when the new-entry dialog is closed. */
  onCreateClose?: () => void;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

function emptyForm(mod: ModuleSchema): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  for (const field of mod.fields) {
    if (field.type === "number") f[field.name] = 0;
    else if (field.type === "boolean") f[field.name] = false;
    else if (field.type === "date" && field.name === "entry_date") f[field.name] = todayIso();
    else if (field.lookup === "sub_agency") f[field.name] = "Self";
    else f[field.name] = "";
  }
  return f;
}

function selectColumns(mod: ModuleSchema): string {
  const cols = new Set(["id", mod.idColumn, "created_at", "created_by"]);
  if (mod.key === "agency-ledger" || mod.key === "vendor-ledger") {
    cols.add("source_id");
    cols.add("source_table");
    cols.add("advance_applied");
  }
  if (mod.key === "vendor-ledger") {
    cols.add("alloc_detail");
  }
  mod.fields.forEach((field) => cols.add(field.name));
  return Array.from(cols).join(",");
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    return String(o.message ?? o.details ?? o.hint ?? JSON.stringify(o));
  }
  return String(e);
}

function cleanAdvanceAdjustmentRemarks(value: string): string {
  const text = value.trim();
  const generatedPrefixes = [
    "অতিরিক্ত সার্ভিস বিল (Advance থেকে)",
    "Vendor Refund (Advance-এ যুক্ত)",
  ];
  for (const prefix of generatedPrefixes) {
    if (text === prefix) return "";
    if (text.startsWith(`${prefix} · `)) return text.slice(prefix.length + 3).trim();
  }
  return text;
}

export function LedgerPage({ module: mod, autoPay, onAutoPayHandled, renderMode = "full", onPaymentClose, autoCreate, onCreateClose }: Props) {
  const { user, profile } = useCurrentUser();
  const { colorFor } = useMobileColors();
  const [rows, setRows] = useState<Row[]>([]);
  const [ticketFlightMap, setTicketFlightMap] = useState<Map<string, string>>(new Map());
  const [ticketRouteMap, setTicketRouteMap] = useState<Map<string, string>>(new Map());
  const [bmetCountryMap, setBmetCountryMap] = useState<Map<string, string>>(new Map());
  const [visaCountryMap, setVisaCountryMap] = useState<Map<string, string>>(new Map());
  const [sourceInfoMap, setSourceInfoMap] = useState<
    Map<
      string,
      {
        passport?: string;
        mobile?: string;
        vendor?: string;
        agency_sold?: string;
        sold?: number;
        cost?: number;
        discount?: number;
        status?: string;
        airline?: string;
        pnr?: string;
        received_from_vendor?: boolean;
        delivery_date?: string | null;
        has_delivery?: boolean;
        cancelled?: boolean;
      }
    >
  >(new Map());

  const [profilesMap, setProfilesMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [dueOnly, setDueOnly] = useState(false);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [latestInput, setLatestInput] = useState("");
  // Pagination for the main entries list.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>(() => emptyForm(mod));
  const [saving, setSaving] = useState(false);
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);
  const [viewRow, setViewRow] = useState<Row | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<string>("");
  const [payDue, setPayDue] = useState<number>(0);
  const [payDate, setPayDate] = useState<string>(todayIso());
  const [payAmount, setPayAmount] = useState<string>("");
  const [payRemarks, setPayRemarks] = useState<string>("");
  const [payMethod, setPayMethod] = useState<string>("Cash");
  const [paySaving, setPaySaving] = useState(false);
  // When set, payment is for THIS specific ledger row (passenger-specific).
  // When null, payment is at the agent/vendor level (legacy bulk flow).
  const [payRow, setPayRow] = useState<Row | null>(null);
  // Bulk allocation mode: "fifo" = oldest-first auto; "specific" = bill-by-bill checklist
  const [payMode, setPayMode] = useState<"fifo" | "specific">("fifo");
  // For specific mode: rowId -> amount string
  const [selectedLines, setSelectedLines] = useState<Record<string, string>>({});
  // Advance payment toggle: when true, skip booking allocation and just record an ADVANCE entry
  const [payAsAdvance, setPayAsAdvance] = useState<boolean>(false);
  // MD Sir external deposit: credits vendor advance without touching cash/bank accounts
  const [payAsMdDeposit, setPayAsMdDeposit] = useState<boolean>(false);
  // Manual advance adjustment (vendor only): refund = add to advance balance, expense = deduct from it.
  // No cash/bank impact — pure wallet adjustment.
  const [payAsAdjust, setPayAsAdjust] = useState<boolean>(false);
  const [adjustKind, setAdjustKind] = useState<"refund" | "expense">("refund");
  const [profileParty, setProfileParty] = useState<string | null>(null);
  const navigate = useNavigate();



  const PAYMENT_METHODS = [
    "Cash",
    "bKash",
    "Nagad",
    "Rocket",
    "Bank Transfer",
    "Cheque",
    "Card",
    "Md cash",
  ];
  const loadingRef = useRef(false);
  const columns = useMemo(() => selectColumns(mod), [mod]);

  // Preserve list scroll position when the add/edit dialog opens & closes.
  const saveScroll = useScrollRestore(openForm);

  const groupField = mod.groupBy?.field ?? "agent_name";
  const groupLabel = mod.groupBy?.label ?? "Agent";
  const isAgency = mod.key === "agency-ledger";
  const billCol = isAgency ? "total_bill" : "total_payable";
  const paidCol = isAgency ? "received_amount" : "paid_amount";
  const discountOf = (r: Row) => isAgency ? Number(r.discount_amount ?? 0) : 0;
  const billLabel = isAgency ? "Total Bill" : "Total Payable";
  const paidLabel = isAgency ? "Total Received" : "Total Paid";
  const payTitle = isAgency ? "পেমেন্ট গ্রহণ এন্ট্রি" : "পেমেন্ট পরিশোধ এন্ট্রি";
  const payAmountLabel = isAgency ? "Received Amount" : "Paid Amount";
  const groupFieldLabel = isAgency ? "Agent Name" : "Vendor Name";
  const visiblePaymentMethods = isAgency ? [...DUE_RECEIVE_METHODS] : PAYMENT_METHODS;

  // Form schema with country_route lookup switching based on selected service_type.
  const formMod = useMemo<ModuleSchema>(() => {
    const svc = String(form.service_type ?? "").toUpperCase();
    const isBmet = svc.includes("BMET");
    const lookupKind = isBmet ? "country" : "route";
    const newLabel = isBmet ? "Country" : svc.includes("VISA") ? "Country" : "Route";
    const fields: Field[] = mod.fields.map((f) =>
      f.name === "country_route" ? { ...f, label: newLabel, lookup: lookupKind } : f,
    );
    return { ...mod, fields };
  }, [mod, form.service_type]);
  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const { data, error } = await supabase
        .from(mod.table as never)
        .select(columns)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      const list = (data as unknown as Row[]) ?? [];
      setRows(list);
    } catch (e) {
      toast.error("লোড সমস্যা: " + errMsg(e));
    }
    loadingRef.current = false;
    setLoading(false);
  }, [mod.table, columns]);

  useEffect(() => {
    void load();
  }, [load]);

  // Load source-table enrichment maps: tickets (route + flight_date), bmet (country), saudi/kuwait visas (sponsor/country)
  useEffect(() => {
    (async () => {
      const [tk, bm, kv, sv, ot] = await Promise.all([
        supabase
          .from("tickets")
          .select(
            "id,flight_date,trip_road,passport,mobile,vendor_bought,agency_sold,sold_price,cost_price,discount_amount,status,airline,pnr",
          )
          .limit(2000),
        supabase
          .from("bmet_cards")
          .select("id,country_name,passport,mobile,vendor_bought,agency_sold,sold_price,cost_price,discount_amount,status,received_date,delivery_date,cancelled")
          .limit(2000),
        supabase
          .from("kuwait_visas")
          .select("id,passport,mobile,vendor_bought,agency_sold,sold_price,cost_price,discount_amount,status,received_date,delivery_date,cancelled")
          .limit(2000),
        supabase
          .from("saudi_visas")
          .select("id,passport,mobile,vendor_bought,agency_sold,sold_price,cost_price,discount_amount,status,received_date,delivery_date,cancelled")
          .limit(2000),
        supabase
          .from("others")
          .select("id,passport,mobile,vendor_bought,agency_sold,sold_price,cost_price,discount_amount,status,service_name,delivery_date")
          .limit(2000),
      ]);
      const fm = new Map<string, string>();
      const rm = new Map<string, string>();
      const info = new Map<
        string,
        {
          passport?: string;
          mobile?: string;
          vendor?: string;
          agency_sold?: string;
          sold?: number;
          cost?: number;
          discount?: number;
          status?: string;
          airline?: string;
          pnr?: string;
          received_from_vendor?: boolean;
          delivery_date?: string | null;
          has_delivery?: boolean;
          cancelled?: boolean;
        }
      >();

      type T = {
        id: string;
        flight_date: string | null;
        trip_road: string | null;
        passport: string | null;
        mobile: string | null;
        vendor_bought: string | null;
        agency_sold: string | null;
        sold_price: number | null;
        cost_price: number | null;
        status: string | null;
        airline: string | null;
        pnr: string | null;
        discount_amount: number | null;
      };
      for (const t of (tk.data as unknown as T[]) ?? []) {
        if (t.flight_date) fm.set(t.id, t.flight_date);
        if (t.trip_road) rm.set(t.id, t.trip_road);
        // Tickets in BOOK status: hide vendor + cost everywhere (only surface once ISSUE'd).
        const isBook = (t.status ?? "").toUpperCase() === "BOOK";
        info.set(t.id, {
          passport: t.passport ?? undefined,
          mobile: t.mobile ?? undefined,
          vendor: isBook ? undefined : (t.vendor_bought ?? undefined),
          agency_sold: t.agency_sold ?? undefined,
          sold: t.sold_price ?? undefined,
          cost: isBook ? undefined : (t.cost_price ?? undefined),
          discount: t.discount_amount ?? undefined,
          status: t.status ?? undefined,
          airline: t.airline ?? undefined,
          pnr: t.pnr ?? undefined,
          has_delivery: false,
        });
      }
      const cm = new Map<string, string>();
      type B = {
        id: string;
        country_name: string | null;
        passport: string | null;
        mobile: string | null;
        vendor_bought: string | null;
        agency_sold: string | null;
        sold_price: number | null;
        cost_price: number | null;
        status: string | null;
        received_date: string | null;
        delivery_date: string | null;
        discount_amount: number | null;
        cancelled: boolean | null;
      };
      for (const b of (bm.data as unknown as B[]) ?? []) {
        if (b.country_name) cm.set(b.id, b.country_name);
        info.set(b.id, {
          passport: b.passport ?? undefined,
          mobile: b.mobile ?? undefined,
          vendor: b.vendor_bought ?? undefined,
          agency_sold: b.agency_sold ?? undefined,
          sold: b.sold_price ?? undefined,
          cost: b.cost_price ?? undefined,
          discount: b.discount_amount ?? undefined,
          status: b.status ?? undefined,
          // Received from vendor = "Received Date From Vendor" is set. Stays a
          // vendor payable through Pending Delivery → Delivery But Due → Delivered.
          received_from_vendor: !!b.received_date,
          delivery_date: b.delivery_date ?? undefined,
          has_delivery: true,
          cancelled: !!b.cancelled,
        });
      }
      const vm = new Map<string, string>();
      type V = {
        id: string;
        passport: string | null;
        mobile: string | null;
        vendor_bought: string | null;
        agency_sold: string | null;
        sold_price: number | null;
        cost_price: number | null;
        discount_amount: number | null;
        status: string | null;
        received_date: string | null;
        delivery_date: string | null;
        cancelled: boolean | null;
      };
      for (const v of (kv.data as unknown as V[]) ?? []) {
        vm.set(v.id, "Kuwait");
        info.set(v.id, {
          passport: v.passport ?? undefined,
          mobile: v.mobile ?? undefined,
          vendor: v.vendor_bought ?? undefined,
          agency_sold: v.agency_sold ?? undefined,
          sold: v.sold_price ?? undefined,
          cost: v.cost_price ?? undefined,
          discount: v.discount_amount ?? undefined,
          status: v.status ?? undefined,
          received_from_vendor: !!v.received_date,
          delivery_date: v.delivery_date ?? undefined,
          has_delivery: true,
          cancelled: !!v.cancelled,
        });
      }
      for (const v of (sv.data as unknown as V[]) ?? []) {
        vm.set(v.id, "Saudi Arabia");
        info.set(v.id, {
          passport: v.passport ?? undefined,
          mobile: v.mobile ?? undefined,
          vendor: v.vendor_bought ?? undefined,
          agency_sold: v.agency_sold ?? undefined,
          sold: v.sold_price ?? undefined,
          cost: v.cost_price ?? undefined,
          discount: v.discount_amount ?? undefined,
          status: v.status ?? undefined,
          received_from_vendor: !!v.received_date,
          delivery_date: v.delivery_date ?? undefined,
          has_delivery: true,
          cancelled: !!v.cancelled,
        });
      }
      type O = {
        id: string;
        passport: string | null;
        mobile: string | null;
        vendor_bought: string | null;
        agency_sold: string | null;
        sold_price: number | null;
        cost_price: number | null;
        discount_amount: number | null;
        status: string | null;
        service_name: string | null;
        delivery_date: string | null;
      };
      for (const o of (ot.data as unknown as O[]) ?? []) {
        info.set(o.id, {
          passport: o.passport ?? undefined,
          mobile: o.mobile ?? undefined,
          vendor: o.vendor_bought ?? undefined,
          agency_sold: o.agency_sold ?? undefined,
          sold: o.sold_price ?? undefined,
          cost: o.cost_price ?? undefined,
          discount: o.discount_amount ?? undefined,
          status: o.status ?? undefined,
          delivery_date: o.delivery_date ?? undefined,
          has_delivery: true,
        });
      }

      setTicketFlightMap(fm);
      setTicketRouteMap(rm);
      setBmetCountryMap(cm);
      setVisaCountryMap(vm);
      setSourceInfoMap(info);
      const { data: profs } = await supabase.from("profiles").select("user_id,full_name");
      const pm: Record<string, string> = {};
      for (const p of (profs as { user_id: string; full_name: string }[] | null) ?? [])
        pm[p.user_id] = p.full_name;
      setProfilesMap(pm);
    })();
  }, []);

  useEffect(() => {
    const ch = supabase
      .channel(`rt_${mod.table}`)
      .on("postgres_changes", { event: "*", schema: "public", table: mod.table }, () => void load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [mod.table, load]);

  const balanceOf = (r: Row) => Number(r[billCol] ?? 0) - Number(r[paidCol] ?? 0) - discountOf(r);

  // ADVANCE rows are a standalone wallet — never net them against bill rows.
  const isAdvanceRow = (r: Row) =>
    String(r.service_type ?? "").toUpperCase() === "ADVANCE";

  // PAYMENT log rows are a visible, deletable record of a vendor payment. The
  // actual money was already applied into the individual bill rows, so PAYMENT
  // log rows must NEVER count toward bill/paid/due/advance totals — they exist
  // purely for display + reversible (admin) delete.
  const isPaymentRow = (r: Row) =>
    String(r.service_type ?? "").toUpperCase() === "PAYMENT";

  // For vendor-ledger: a bill row sourced from BMET/Saudi/Kuwait modules only
  // becomes a payable to the Vendor once the source customer's status is
  // "Pending Delivery" AND (for BMET) Received Date From Vendor is entered.
  // Until then it must NOT count toward vendor due anywhere (card, rows, dialog).
  const countsForVendorDue = useCallback(
    (r: Row) => {
      if (isAgency) return true;
      const src = String(r.source_table ?? "");
      if (src !== "bmet_cards" && src !== "saudi_visas" && src !== "kuwait_visas") return true;
      const info = sourceInfoMap.get(String(r.source_id ?? ""));
      return !!info?.received_from_vendor;
    },
    [isAgency, sourceInfoMap],
  );

  // একটি ledger row যদি বাতিল করা (soft-cancel) BMET/Saudi/Kuwait কাজ থেকে আসে কিনা
  const isCancelledRow = useCallback(
    (r: Row) => {
      const src = String(r.source_table ?? "");
      if (src !== "bmet_cards" && src !== "saudi_visas" && src !== "kuwait_visas") return false;
      return !!sourceInfoMap.get(String(r.source_id ?? ""))?.cancelled;
    },
    [sourceInfoMap],
  );

  const advanceAdjustedRows = useMemo(() => {
    const adjusted = new Map<string, { applied: number; displayPaid: number; displayDue: number }>();
    for (const r of rows) {
      if (isAdvanceRow(r) || isPaymentRow(r)) continue;
      const applied = Number(r.advance_applied ?? 0);
      const cashPaid = Number(r[paidCol] ?? 0);
      const discount = discountOf(r);
      // Not-yet-payable vendor bills carry NO due (and so never appear in FIFO/payment).
      const eligible = countsForVendorDue(r);
      adjusted.set(r.id, {
        applied,
        displayPaid: cashPaid + applied,
        displayDue: eligible ? Math.max(Number(r[billCol] ?? 0) - cashPaid - discount - applied, 0) : 0,
      });
    }
    return adjusted;
  }, [rows, billCol, paidCol, countsForVendorDue]);

  // Net due per group — SINGLE SOURCE OF TRUTH.
  // Built from advanceAdjustedRows.displayDue, the exact same per-row value the
  // FIFO dialog, the FIFO preview, the per-vendor "Vendor-Due" column and the
  // "Total Due" card all use. This guarantees those four surfaces can never diverge.
  const dueByGroup = useMemo(() => {
    const due = new Map<string, number>();
    for (const r of rows) {
      if (isAdvanceRow(r) || isPaymentRow(r)) continue;
      const k = String(r[groupField] ?? "");
      due.set(k, (due.get(k) ?? 0) + (advanceAdjustedRows.get(r.id)?.displayDue ?? 0));
    }
    return due;
  }, [rows, groupField, advanceAdjustedRows]);



  const serviceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const s = String(r.service_type ?? "").trim();
      if (s) set.add(s);
    }
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let xs = rows;
    // বাতিল করা (soft-cancel) কাজ থেকে আসা row চলমান তালিকায়ও ধূসর রঙে ও
    // বিশেষ চিহ্নসহ দেখানো হয় — সার্চ করা হোক বা না হোক।
    if (groupFilter !== "all") xs = xs.filter((r) => String(r[groupField] ?? "") === groupFilter);
    if (serviceFilter !== "all") xs = xs.filter((r) => String(r.service_type ?? "") === serviceFilter);
    // "শুধু Due" — show only the individual files that are received from the
    // vendor AND still carry a per-file vendor due (paid-off / not-yet-payable
    // files disappear, not just whole vendors).
    if (dueOnly) xs = xs.filter((r) => (advanceAdjustedRows.get(r.id)?.displayDue ?? 0) > 0);
    if (startDate) xs = xs.filter((r) => String(r.entry_date ?? "").slice(0, 10) >= startDate);
    if (endDate) xs = xs.filter((r) => String(r.entry_date ?? "").slice(0, 10) <= endDate);
    const q = search.trim().toLowerCase();
    if (q)
      xs = xs.filter((r) =>
        Object.values(r).some((v) =>
          String(v ?? "")
            .toLowerCase()
            .includes(q),
        ),
      );
    // Latest-N limiter: only when date range NOT active
    if (!startDate && !endDate) {
      const parsed = /^\d+$/.test(latestInput.trim()) ? parseInt(latestInput.trim(), 10) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) xs = xs.slice(0, parsed);
    }
    return xs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, groupFilter, serviceFilter, dueOnly, startDate, endDate, search, latestInput, dueByGroup, advanceAdjustedRows, isCancelledRow]);

  // Pagination derived values for the entries list.
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize],
  );
  // Reset to first page whenever filters or page-size change.
  useEffect(() => {
    setPage(1);
  }, [groupFilter, serviceFilter, dueOnly, startDate, endDate, search, latestInput, pageSize]);



  const totals = useMemo(() => {
    let bill = 0,
      paid = 0,
      cashPaid = 0,
      discount = 0,
      applied = 0,
      advance = 0,
      due = 0;
    for (const r of filtered) {
      if (isPaymentRow(r)) continue;
      if (isAdvanceRow(r)) {
        advance += Number(r[paidCol] ?? 0);
      } else if (countsForVendorDue(r)) {
        // Skip not-yet-payable vendor bills so the card matches the per-vendor summary.
        bill += Number(r[billCol] ?? 0);
        cashPaid += Number(r[paidCol] ?? 0);
        discount += discountOf(r);
        applied += Number(r.advance_applied ?? 0);
        // Single source of truth: per-row clamped due (same as FIFO + per-vendor summary).
        due += advanceAdjustedRows.get(r.id)?.displayDue ?? Math.max(balanceOf(r), 0);
      }
    }
    paid = cashPaid + applied;
    return {
      bill,
      paid,
      discount,
      advance: Math.max(advance - applied, 0),
      due,
    };
  }, [filtered, billCol, paidCol, countsForVendorDue, advanceAdjustedRows]);




  const groupSummary = useMemo(() => {
    const map = new Map<string, { bill: number; cashPaid: number; discount: number; applied: number; advance: number; due: number }>();
    for (const r of filtered) {
      if (isPaymentRow(r)) continue;
      const k = String(r[groupField] ?? "—") || "—";
      const cur = map.get(k) ?? { bill: 0, cashPaid: 0, discount: 0, applied: 0, advance: 0, due: 0 };
      if (isAdvanceRow(r)) {
        cur.advance += Number(r[paidCol] ?? 0);
      } else if (countsForVendorDue(r)) {
        cur.bill += Number(r[billCol] ?? 0);
        cur.cashPaid += Number(r[paidCol] ?? 0);
        cur.discount += discountOf(r);
        cur.applied += Number(r.advance_applied ?? 0);
        // Single source of truth: per-row clamped due (same as FIFO + Total Due card).
        cur.due += advanceAdjustedRows.get(r.id)?.displayDue ?? Math.max(balanceOf(r), 0);
      }
      map.set(k, cur);
    }
    return Array.from(map.entries())
      .map(([key, v]) => {
        return {
          key,
          bill: v.bill,
          paid: v.cashPaid + v.applied,
          due: v.due,
          advance: Math.max(v.advance - v.applied, 0),
        };
      })
      .sort((a, b) => b.due - a.due);
  }, [filtered, groupField, billCol, paidCol, countsForVendorDue, advanceAdjustedRows]);

  // Live balance preview while editing: shows the party's (vendor/agent) overall
  // due/advance recomputed with the CURRENT form value for the edited paid amount,
  // so changing "Paid" instantly reflects how the total balance adjusts.
  const editBalancePreview = useMemo(() => {
    if (!editing) return null;
    const key = String(editing[groupField] ?? "").trim();
    if (!key) return null;
    let due = 0;
    let advanceIn = 0;
    let applied = 0;
    let bill = 0;
    let paid = 0;
    for (const r of rows) {
      if (String(r[groupField] ?? "").trim() !== key) continue;
      if (isPaymentRow(r)) continue;
      const isThis = r.id === editing.id;
      if (isAdvanceRow(r)) {
        advanceIn += isThis ? Number(form[paidCol] ?? 0) : Number(r[paidCol] ?? 0);
        continue;
      }
      if (!countsForVendorDue(r)) continue;
      // For the edited row the "Paid" box already contains cash + applied advance
      // (set in startEdit); for other rows reconstruct the same total.
      const rowBill = isThis ? Number(form[billCol] ?? 0) : Number(r[billCol] ?? 0);
      const rowPaid = isThis
        ? Number(form[paidCol] ?? 0)
        : Number(r[paidCol] ?? 0) + Number(r.advance_applied ?? 0);
      const rowDisc = isAgency
        ? isThis
          ? Number(form.discount_amount ?? 0)
          : Number(r.discount_amount ?? 0)
        : 0;
      const rowApplied = isThis
        ? Number(editing.advance_applied ?? 0)
        : Number(r.advance_applied ?? 0);
      bill += rowBill;
      paid += rowPaid;
      due += Math.max(rowBill - rowPaid - rowDisc, 0);
      applied += rowApplied;
    }
    const advance = Math.max(advanceIn - applied, 0);
    return { key, bill, paid, due, advance, net: due - advance };
  }, [editing, form, rows, groupField, billCol, paidCol, isAgency, countsForVendorDue]);

  const groupOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      const v = String(r[groupField] ?? "");
      if (v) set.add(v);
    });
    return Array.from(set).sort();
  }, [rows, groupField]);

  // ---- form actions ----
  const startCreate = () => {
    saveScroll();
    setEditing(null);
    const f = emptyForm(mod);
    if (mod.fields.some((fld) => fld.name === "entry_by")) f.entry_by = displayName(profile, user);
    setForm(f);
    setOpenForm(true);
  };

  const startEdit = (r: Row) => {
    saveScroll();
    setEditing(r);
    const f: Record<string, unknown> = {};
    for (const field of mod.fields)
      f[field.name] = r[field.name] ?? (field.type === "number" ? 0 : "");
    // Vendor/Agent payments made by applying advance are stored in `advance_applied`,
    // not in the raw paid column. Show the FULL paid (cash + applied advance) in the
    // "Paid" box so it doesn't wrongly read 0. On save we subtract the applied part
    // back out (see submit) to avoid double-counting.
    const applied = Number(r.advance_applied ?? 0);
    if (applied > 0) f[paidCol] = Number(r[paidCol] ?? 0) + applied;
    setForm(f);
    setOpenForm(true);
  };

  // Compute outstanding for any group key from ALL rows after advance auto-adjustment.
  const dueForGroup = useCallback(
    (key: string) => {
      if (!key) return 0;
      return dueByGroup.get(key) ?? 0;
    },
    [dueByGroup],
  );

  // Open bookings for a group: only rows with positive balance, excluding payment-only entries,
  // sorted oldest-first (entry_date asc, then created_at asc).
  const openBookingsFor = useCallback(
    (key: string): Row[] => {
      if (!key) return [];
      const list = rows.filter(
        (r) =>
          String(r[groupField] ?? "") === key &&
          String(r.service_type ?? "").toUpperCase() !== "PAYMENT" &&
          !isAdvanceRow(r) &&
          (advanceAdjustedRows.get(r.id)?.displayDue ?? Math.max(balanceOf(r), 0)) > 0.0001,
      );
      list.sort((a, b) => {
        const ad = String(a.entry_date ?? "");
        const bd = String(b.entry_date ?? "");
        if (ad !== bd) return ad < bd ? -1 : 1;
        const ac = String(a.created_at ?? "");
        const bc = String(b.created_at ?? "");
        return ac < bc ? -1 : 1;
      });
      return list;
    },
    [rows, groupField, billCol, paidCol, advanceAdjustedRows],
  );

  // Current advance (wallet) balance for a group, after applying it to bills.
  const advanceForGroup = useCallback(
    (key: string) => {
      if (!key) return 0;
      let advance = 0, applied = 0;
      for (const r of rows) {
        if (String(r[groupField] ?? "") !== key) continue;
        if (isAdvanceRow(r)) advance += Number(r[paidCol] ?? 0);
        else applied += Number(r.advance_applied ?? 0);
      }
      return Math.max(advance - applied, 0);
    },
    [rows, groupField, paidCol],
  );

  const openPayment = (groupKey: string, dueAmount: number) => {
    const due = groupKey ? dueForGroup(groupKey) : dueAmount;
    setPayRow(null);
    setPayMode("fifo");
    setSelectedLines({});
    setPayAsAdvance(false);
    setPayAsMdDeposit(false);
    setPayAsAdjust(false);
    setAdjustKind("refund");
    setPayTarget(groupKey);
    setPayDue(due);
    setPayAmount(String(due > 0 ? due : ""));
    setPayDate(todayIso());
    setPayRemarks("");
    setPayMethod("Cash");
    setPayOpen(true);
  };

  // Passenger/row-specific payment: due is THIS row's bill - paid only.
  const openPaymentForRow = (row: Row, lineDue: number) => {
    setPayRow(row);
    setPayMode("fifo");
    setSelectedLines({});
    setPayAsAdvance(false);
    setPayAsMdDeposit(false);
    setPayAsAdjust(false);
    setAdjustKind("refund");
    setPayTarget(String(row[groupField] ?? ""));
    setPayDue(lineDue);
    setPayAmount(String(lineDue > 0 ? lineDue : ""));
    setPayDate(todayIso());
    setPayRemarks("");
    setPayMethod("Cash");
    setPayOpen(true);
  };

  // Auto-open the payment dialog when a caller (e.g. the Vendors page) navigates
  // here with a target vendor/agent. Wait until rows are loaded so dues compute.
  const autoPayHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoPay || loading) return;
    if (autoPayHandledRef.current === autoPay) return;
    autoPayHandledRef.current = autoPay;
    openPayment(autoPay === "__open__" ? "" : autoPay, 0);
    onAutoPayHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPay, loading]);

  // In payment-only embed mode, notify the host when the dialog is closed so it
  // can unmount this instance.
  const payWasOpenRef = useRef(false);
  useEffect(() => {
    if (renderMode !== "payment-only") return;
    if (payOpen) {
      payWasOpenRef.current = true;
    } else if (payWasOpenRef.current) {
      payWasOpenRef.current = false;
      onPaymentClose?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payOpen, renderMode]);

  // Map source table -> column to bump for THIS ledger's payment side.
  // Agency receives: customer-received column on each service row.
  // Vendor pays: only saudi_visas tracks vendor-paid (received_vendor).
  const sourceRecvCol = (srcTable: string): string | null => {
    if (isAgency) {
      const m: Record<string, string> = {
        tickets: "received",
        bmet_cards: "received_amount",
        saudi_visas: "received_amount",
        kuwait_visas: "received",
      };
      return m[srcTable] ?? null;
    }
    // vendor side
    if (srcTable === "saudi_visas") return "received_vendor";
    return null;
  };

  // A single bill-allocation record, stored on the PAYMENT log row so an admin
  // delete can reverse exactly what was applied.
  type AllocItem = {
    id: string;            // ledger row UUID the payment touched
    ledger_id: string;     // human ledger id (for display)
    amt: number;
    src_table: string | null;
    src_id: string | null;
    recv_col: string | null; // when set, the amount was applied to the source row column
  };

  // Apply `amt` to a single ledger row: update source row if linked (trigger refreshes ledger),
  // otherwise bump the ledger row's paidCol directly. Returns allocation metadata.
  const applyAllocationToRow = async (row: Row, amt: number): Promise<AllocItem> => {
    const srcTable = String(row.source_table ?? "");
    const srcId = String(row.source_id ?? "");
    const recvCol = srcTable ? sourceRecvCol(srcTable) : null;
    const effectiveMethod = payAsMdDeposit ? "MD Sir Deposit" : payMethod;
    // Vendor side: paying a vendor for a Saudi/Kuwait visa auto-marks it as
    // "Received from Vendor" (sets vendor_sent_date + received_date when empty)
    // so the bill + payment immediately count in the vendor balance/profile —
    // just like tickets and other modules.
    if (!isAgency && srcId && (srcTable === "saudi_visas" || srcTable === "kuwait_visas")) {
      const { data: vRow } = await supabase
        .from(srcTable as never)
        .select("id, vendor_sent_date, received_date")
        .eq("id", srcId)
        .maybeSingle();
      const v = vRow as { vendor_sent_date: string | null; received_date: string | null } | null;
      if (v && !v.received_date) {
        const recvUpd: Record<string, unknown> = { received_date: payDate };
        if (!v.vendor_sent_date) recvUpd.vendor_sent_date = payDate;
        await supabase
          .from(srcTable as never)
          .update(recvUpd as never)
          .eq("id", srcId);
      }
    }
    if (srcTable && srcId && recvCol) {
      const { data: srcRow, error: rErr } = await supabase
        .from(srcTable as never)
        .select(`id, ${recvCol}`)
        .eq("id", srcId)
        .maybeSingle();
      if (rErr) throw rErr;
      const cur = Number((srcRow as Record<string, unknown> | null)?.[recvCol] ?? 0);
      const upd: Record<string, unknown> = { [recvCol]: cur + amt };
      if (isAgency && user?.id) upd.received_by = user.id;
      if (isAgency) {
        upd.payment_date = payDate;
      }
      const { error: uErr } = await supabase
        .from(srcTable as never)
        .update(upd as never)
        .eq("id", srcId);
      if (uErr) throw uErr;
    } else {
      const cur = Number(row[paidCol] ?? 0);
      const { error: uErr } = await supabase
        .from(mod.table as never)
        .update({ [paidCol]: cur + amt, payment_method: effectiveMethod, payment_date: payDate } as never)
        .eq("id", row.id);
      if (uErr) throw uErr;
    }
    // Propagate the EFFECTIVE payment method to the ledger row so the
    // cash-sync trigger records the right Cash/Bank category.
    // CRITICAL: when paying as "MD Sir Deposit" (external money), the bill row
    // must carry "MD Sir Deposit" — otherwise a bill row with no source_table
    // (e.g. Opening Due / direct vendor bills) would mirror a cash_expense with
    // the underlying method (often "Cash") and wrongly reduce the staff's
    // cash balance, even though the UI promises the user balance stays intact.
    await supabase
      .from(mod.table as never)
        .update({ payment_method: effectiveMethod, payment_date: payDate } as never)
      .eq("id", row.id);
    return {
      id: row.id,
      ledger_id: String(row[mod.idColumn] ?? ""),
      amt,
      src_table: srcTable && srcId && recvCol ? srcTable : null,
      src_id: srcTable && srcId && recvCol ? srcId : null,
      recv_col: srcTable && srcId && recvCol ? recvCol : null,
    };
  };

  // Insert a visible, deletable PAYMENT log row recording a vendor payment.
  // The money has already been applied into the bills (alloc items) so this row
  // is financially neutral (excluded from all totals; source_table='payment_log'
  // makes the cash-sync trigger skip it). Vendor side only.
  const recordPaymentLog = async (
    items: AllocItem[],
    totalAmt: number,
    advanceRowId: string | null,
  ) => {
    if (isAgency) return;
    if (totalAmt <= 0 || items.length === 0) return;
    const method = payAsMdDeposit ? "MD Sir Deposit" : payMethod;
    const logId = await generateNextId({
      key: mod.key, label: "", short: "", table: mod.table,
      idColumn: mod.idColumn, idPrefix: "VDL", monthlyId: true, fields: [],
    });
    const payload: Record<string, unknown> = {
      [mod.idColumn]: logId,
      entry_date: payDate,
      [groupField]: payTarget,
      service_type: "PAYMENT",
      [billCol]: 0,
      [paidCol]: totalAmt,
      payment_method: method,
      payment_date: payDate,
      source_table: "payment_log",
      remarks: `Vendor Payment · ${method}${payRemarks ? " · " + payRemarks : ""}`,
      alloc_detail: {
        kind: "vendor_payment",
        method,
        as_md_deposit: payAsMdDeposit,
        as_user_balance: payAsAdvance,
        items,
        advance_row_id: advanceRowId,
      },
      created_by: user?.id ?? null,
    };
    await resilientInsert(mod.table, payload as Record<string, unknown>);
  };

  // Reverse a PAYMENT log row's allocations, then return so the caller can
  // delete the log row itself. Admin-only (guarded at the call site).
  const reversePaymentLog = async (logRow: Row) => {
    const detail = logRow.alloc_detail as
      | { items?: AllocItem[]; advance_row_id?: string | null }
      | null;
    const items = detail?.items ?? [];
    for (const it of items) {
      if (!it || !it.amt) continue;
      if (it.src_table && it.src_id && it.recv_col) {
        const { data: srcRow } = await supabase
          .from(it.src_table as never)
          .select(`id, ${it.recv_col}`)
          .eq("id", it.src_id)
          .maybeSingle();
        const cur = Number((srcRow as Record<string, unknown> | null)?.[it.recv_col] ?? 0);
        await supabase
          .from(it.src_table as never)
          .update({ [it.recv_col]: Math.max(cur - it.amt, 0) } as never)
          .eq("id", it.src_id);
      } else {
        const { data: ledRow } = await supabase
          .from(mod.table as never)
          .select(`id, ${paidCol}`)
          .eq("id", it.id)
          .maybeSingle();
        const cur = Number((ledRow as Record<string, unknown> | null)?.[paidCol] ?? 0);
        await supabase
          .from(mod.table as never)
          .update({ [paidCol]: Math.max(cur - it.amt, 0) } as never)
          .eq("id", it.id);
      }
    }
    // Remove any leftover-advance row created together with this payment
    // (advance_row_id holds the human ledger id).
    if (detail?.advance_row_id) {
      await supabase
        .from(mod.table as never)
        .delete()
        .eq(mod.idColumn as never, detail.advance_row_id as never);
    }
  };

  // Live FIFO allocation preview for the current payAmount.
  const fifoPreview = useMemo(() => {
    if (payRow) return [] as Array<{ row: Row; alloc: number; due: number }>;
    const amt = Number(payAmount) || 0;
    let remaining = amt;
    const list = openBookingsFor(payTarget);
    const out: Array<{ row: Row; alloc: number; due: number }> = [];
    for (const r of list) {
      const due = advanceAdjustedRows.get(r.id)?.displayDue ?? Math.max(balanceOf(r), 0);
      if (remaining <= 0.0001) {
        out.push({ row: r, alloc: 0, due });
        continue;
      }
      const take = Math.min(remaining, due);
      out.push({ row: r, alloc: take, due });
      remaining -= take;
    }
    return out;
  }, [payAmount, payTarget, payRow, openBookingsFor, billCol, paidCol, advanceAdjustedRows]);

  const specificTotal = useMemo(() => {
    let t = 0;
    for (const v of Object.values(selectedLines)) t += Number(v) || 0;
    return t;
  }, [selectedLines]);

  // Write a single cash-drawer mirror entry for a bulk allocation.
  // NOTE: Cash mirror is now handled automatically by database triggers
  // (sync_vendor_payment_to_cash / sync_agent_receipt_to_cash) so manual
  // insert into payment_receipts / cash_expenses is no longer needed.
  // Kept as a no-op for backward compatibility with existing call sites.
  const writeCashMirror = async (_totalAmt: number, _refId: string, _allocSummary: string) => {
    return;
  };

  // Record an unallocated advance entry. Used for the leftover when "Payment from
  // User Balance" / "MD Sir Deposit" exceeds total due.
  // - User Balance: real payment_method, no source_table -> reduces user balance
  //   via the cash-sync trigger.
  // - MD Sir Deposit (asMdDeposit): source_table='md_deposit' -> cash/bank
  //   balances stay untouched (external money kept as vendor advance).
  const recordAdvanceEntry = async (advAmt: number, asMdDeposit = false): Promise<string> => {
    const advId = await generateNextId({
      key: mod.key, label: "", short: "", table: mod.table,
      idColumn: mod.idColumn, idPrefix: isAgency ? "AGL" : "VDL",
      monthlyId: true, fields: [],
    });
    const advPayload: Record<string, unknown> = {
      [mod.idColumn]: advId,
      entry_date: payDate,
      [groupField]: payTarget,
      service_type: "ADVANCE",
      [billCol]: 0,
      [paidCol]: advAmt,
      payment_method: asMdDeposit ? "MD Sir Deposit" : payMethod,
      remarks: asMdDeposit
        ? `MD Sir External Deposit (leftover advance)${payRemarks ? " · " + payRemarks : ""}`
        : `Advance ${isAgency ? "Received" : "Paid"} (leftover) · ${payMethod}${payRemarks ? " · " + payRemarks : ""}`,
      created_by: user?.id ?? null,
    };
    if (asMdDeposit) advPayload.source_table = "md_deposit";
    if (isAgency) advPayload.received_by = user?.id ?? null;
    await resilientInsert(mod.table, advPayload as Record<string, unknown>);
    return advId;
  };

  const submitPayment = async () => {
    if (!payTarget) return toast.error(`${groupFieldLabel} নির্বাচন করুন`);
    setPaySaving(true);
    try {
      // ---------- Manual Advance Adjustment (vendor only, no cash/bank impact) ----------
      if (payAsAdjust && !payRow && !isAgency) {
        const amt = Number(payAmount);
        if (!amt || amt <= 0) return toast.error("সঠিক টাকার পরিমাণ দিন");
        const isExpense = adjustKind === "expense";
        if (isExpense) {
          const bal = advanceForGroup(payTarget);
          if (amt > bal + 0.001)
            return toast.error(`Advance balance-এর চেয়ে বেশি কাটা যাবে না (Balance: ৳${bal.toLocaleString()})`);
        }
        const ledgerId = await generateNextId({
          key: mod.key, label: "", short: "", table: mod.table,
          idColumn: mod.idColumn, idPrefix: "VDL",
          monthlyId: true, fields: [],
        });
        const signedAmt = isExpense ? -amt : amt;
        const kindLabel = isExpense ? "ব্যয়" : "আয়";
        const label = `Manual Advance Adjustment · ${kindLabel}`;
        const payload: Record<string, unknown> = {
          [mod.idColumn]: ledgerId,
          entry_date: payDate,
          [groupField]: payTarget,
          service_type: "ADVANCE",
          // Keep the vendor ledger display exactly like the old ADVANCE row.
          country_route: null,
          [billCol]: 0,
          [paidCol]: signedAmt,
          // Virtual adjustment — no real cash/bank movement, so no payment method.
          payment_method: "Adjustment",
          // Non-null source_table => sync_vendor_payment_to_cash skips the cash mirror,
          // so this is a pure advance-balance adjustment with no Cash/Bank impact.
          source_table: "manual_adjust",
          // Store only what the user typed — shown verbatim in the remarks line.
          remarks: payRemarks ? payRemarks.trim() : null,
          created_by: user?.id ?? null,
        };
        const { offline } = await resilientInsert(mod.table, payload as Record<string, unknown>);
        if (!offline) notify.success(
          isExpense
            ? `✓ অতিরিক্ত বিল সংরক্ষিত (Advance −৳${amt.toLocaleString()})`
            : `✓ Refund সংরক্ষিত (Advance +৳${amt.toLocaleString()})`,
          { meta: { vendor: String(payTarget), service: label, refId: ledgerId, amount: amt } },
        );
        setPayOpen(false);
        void load();
        return;
      }

      // ---------- MD Sir Deposit / Payment from User Balance ----------
      // Both now fall through to the normal FIFO / Bill-by-Bill allocation below.
      // - Bills are paid via applyAllocationToRow (vendor bill rows carry a
      //   source_table, so sync_vendor_payment_to_cash never mirrors them to
      //   cash — Cash/Bank balances stay untouched for the bill portion).
      // - Any leftover beyond total due is recorded as an advance via
      //   recordAdvanceEntry(). For MD Sir Deposit the leftover advance also keeps
      //   Cash untouched (source_table='md_deposit'); for User Balance it reduces
      //   the user balance via the cash-sync trigger.



      // ---------- Passenger-specific (single row) ----------
      if (payRow) {
        const amt = Number(payAmount);
        if (!amt || amt <= 0) return toast.error("সঠিক টাকার পরিমাণ দিন");
        if (amt > payDue + 0.001)
          return toast.error(`এই যাত্রীর Due-এর চেয়ে বেশি দেওয়া যাবে না (Due: ${payDue})`);
        const allocItem = await applyAllocationToRow(payRow, amt);
        await recordPaymentLog([allocItem], amt, null);
        await writeCashMirror(amt, String(payRow[mod.idColumn] ?? ""),
          `${String(payRow[mod.idColumn] ?? "")}=${amt}`);
        notify.success(`✓ পেমেন্ট সংরক্ষিত: ${amt.toLocaleString()}`, {
          meta: {
            vendor: String(payTarget),
            service: String(payRow.service_type ?? (isAgency ? "Agent Receipt" : "Vendor Payment")),
            passenger: String(payRow.passenger_name ?? ""),
            refId: String(payRow[mod.idColumn] ?? ""),
            amount: amt,
          },
        });
        setPayOpen(false);
        setPayRow(null);
        void load();
        return;
      }

      // ---------- Bulk: Bill-by-Bill (specific) ----------
      if (payMode === "specific") {
        const entries = Object.entries(selectedLines)
          .map(([id, v]) => ({ id, amt: Number(v) || 0 }))
          .filter((e) => e.amt > 0);
        if (entries.length === 0) return toast.error("কমপক্ষে একটি বিল নির্বাচন করুন");
        const rowById = new Map(rows.map((r) => [r.id, r]));
        // validate
        for (const e of entries) {
          const r = rowById.get(e.id);
          if (!r) return toast.error("বিল খুঁজে পাওয়া যায়নি");
          const due = advanceAdjustedRows.get(r.id)?.displayDue ?? Math.max(balanceOf(r), 0);
          if (e.amt > due + 0.001)
            return toast.error(
              `${String(r[mod.idColumn] ?? "")} — Due-এর চেয়ে বেশি দেওয়া যাবে না (Due: ${due})`,
            );
        }
        let total = 0;
        const parts: string[] = [];
        const allocItems: AllocItem[] = [];
        for (const e of entries) {
          const r = rowById.get(e.id)!;
          allocItems.push(await applyAllocationToRow(r, e.amt));
          total += e.amt;
          parts.push(`${String(r[mod.idColumn] ?? "")}=${e.amt}`);
        }
        await recordPaymentLog(allocItems, total, null);
        await writeCashMirror(total, parts[0]?.split("=")[0] ?? payTarget, parts.join(", "));
        notify.success(`✓ ${entries.length}টি বিলে ${payAsMdDeposit ? "MD Sir Deposit" : "পেমেন্ট"} সংরক্ষিত: ${total.toLocaleString()}`, {
          meta: {
            vendor: String(payTarget),
            service: `${payAsMdDeposit ? "MD Sir Deposit" : isAgency ? "Agent Receipt" : "Vendor Payment"} (${entries.length} bills)`,
            refId: parts.map((p) => p.split("=")[0]).join(", "),
            amount: total,
          },
        });
        setPayOpen(false);
        void load();
        return;
      }

      // ---------- Bulk: Auto FIFO ----------
      const amt = Number(payAmount);
      if (!amt || amt <= 0) return toast.error("সঠিক টাকার পরিমাণ দিন");
      const list = openBookingsFor(payTarget);
      const totalDue = list.reduce(
        (s, r) => s + (advanceAdjustedRows.get(r.id)?.displayDue ?? Math.max(balanceOf(r), 0)),
        0,
      );
      // Normal flow caps at total due. "Payment from User Balance" (payAsAdvance)
      // and "MD Sir Deposit" (payAsMdDeposit) allow overpay — the leftover beyond
      // due is kept as an advance.
      const allowOverpay = payAsAdvance || payAsMdDeposit;
      if (!allowOverpay && amt > totalDue + 0.001)
        return toast.error(`Total Due-এর চেয়ে বেশি দেওয়া যাবে না (Due: ${totalDue})`);
      if (!allowOverpay && list.length === 0) return toast.error("কোনো অপরিশোধিত বিল নেই");

      let remaining = amt;
      const parts: string[] = [];
      const allocItems: AllocItem[] = [];
      for (const r of list) {
        if (remaining <= 0.0001) break;
        const due = advanceAdjustedRows.get(r.id)?.displayDue ?? Math.max(balanceOf(r), 0);
        const take = Math.min(remaining, due);
        if (take <= 0) continue;
        allocItems.push(await applyAllocationToRow(r, take));
        remaining -= take;
        parts.push(`${String(r[mod.idColumn] ?? "")}=${take}`);
      }
      // Leftover (from user balance or MD deposit) is stored as an advance entry.
      let advLeft = 0;
      let advRowId: string | null = null;
      if (allowOverpay && remaining > 0.0001) {
        advLeft = remaining;
        advRowId = await recordAdvanceEntry(advLeft, payAsMdDeposit);
        parts.push(`ADVANCE=${advLeft}`);
      }
      // Visible, deletable PAYMENT log for the bill-allocated portion (vendor side).
      await recordPaymentLog(allocItems, amt - advLeft, advRowId);
      const billCount = parts.filter((p) => !p.startsWith("ADVANCE")).length;
      await writeCashMirror(amt, parts[0]?.split("=")[0] ?? payTarget, parts.join(", "));
      const depositLabel = payAsMdDeposit ? "MD Sir Deposit" : "FIFO পেমেন্ট";
      notify.success(
        advLeft > 0
          ? `✓ ${depositLabel} সংরক্ষিত: ${amt.toLocaleString()} (বিলে ${(amt - advLeft).toLocaleString()} + advance ${advLeft.toLocaleString()})`
          : `✓ ${depositLabel} সংরক্ষিত: ${amt.toLocaleString()} (${billCount}টি বিল)`,
        {
          meta: {
            vendor: String(payTarget),
            service: `${payAsMdDeposit ? "MD Sir Deposit" : isAgency ? "Agent Receipt" : "Vendor Payment"} (FIFO, ${billCount} bills${advLeft > 0 ? " + advance" : ""})`,
            refId: parts.map((p) => p.split("=")[0]).join(", "),
            amount: amt,
          },
        },
      );
      setPayOpen(false);
      void load();
    } catch (e) {
      toast.error("সমস্যা: " + errMsg(e));
    } finally {
      setPaySaving(false);
    }
  };

  const submit = async () => {
    if (saving) return; // Prevent double-submit race
    // Mandatory-field validation (e.g. Vendor/Agent name, Payment Method)
    for (const fld of mod.fields) {
      if (!fld.required) continue;
      const v = form[fld.name];
      const empty = v === null || v === undefined || (typeof v === "string" && v.trim() === "");
      if (empty) {
        toast.error(`⚠ আবশ্যিক: "${fld.label}" পূরণ করুন`);
        return;
      }
    }
    // Capture edit state at submit-time to guarantee Update vs Insert routing
    const editRow = editing;
    const editId = editRow?.id;
    const isEdit = !!editId;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const field of mod.fields) {
        const v = form[field.name];
        if (field.type === "number") payload[field.name] = Number(v) || 0;
        else if (field.type === "boolean") payload[field.name] = Boolean(v);
        else if (field.type === "date") payload[field.name] = v ? v : null;
        else payload[field.name] = v ?? null;
      }
      if (user?.id && !isEdit) (payload as Record<string, unknown>).created_by = user.id;

      // The Paid box shows cash + applied advance (see startEdit). Persist back
      // only the cash portion so `advance_applied` is not double-counted.
      if (isEdit && editRow) {
        const applied = Number(editRow.advance_applied ?? 0);
        if (applied > 0 && payload[paidCol] !== undefined) {
          payload[paidCol] = Math.max(0, Number(payload[paidCol]) - applied);
        }
      }

      const entryDateForId = typeof payload.entry_date === "string" ? (payload.entry_date as string) : undefined;
      const finalId = !isEdit ? await generateNextId(mod, entryDateForId) : undefined;
      if (finalId) (payload as Record<string, unknown>)[mod.idColumn] = finalId;

      if (isEdit && editId) {
        // STRICT: existing row — UPDATE only, never insert
        const { error } = await supabase
          .from(mod.table as never)
          .update(payload as never)
          .eq("id", editId);
        if (error) throw error;
        toast.success("আপডেট হয়েছে");
      } else {
        // No id → INSERT new
        const { offline } = await resilientInsert(mod.table, payload as Record<string, unknown>);
        if (!offline) toast.success(`✓ যোগ হয়েছে: ${finalId}`);
      }
      setOpenForm(false);
      setEditing(null);
      void load();
    } catch (e) {
      toast.error("সমস্যা: " + errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteRow) return;
    try {
      // A PAYMENT log row: first reverse the money it applied to the bills (and
      // any leftover-advance row), then delete the log row itself.
      if (!isAgency && isPaymentRow(deleteRow) && deleteRow.alloc_detail) {
        await reversePaymentLog(deleteRow);
      }
      const { error } = await supabase
        .from(mod.table as never)
        .delete()
        .eq("id", deleteRow.id);
      if (error) throw error;
      toast.success(
        !isAgency && isPaymentRow(deleteRow)
          ? "পেমেন্ট রিভার্স ও ডিলিট হয়েছে"
          : "ডিলিট হয়েছে",
      );
      await load();
    } catch (e) {
      toast.error("ডিলিট সমস্যা: " + errMsg(e));
    }
    setDeleteRow(null);
  };

  // ---- export ----
  const exportCsv = () => {
    const headers = [
      mod.idColumn,
      "entry_date",
      groupField,
      "passenger_name",
      "service_type",
      "country_route",
      billCol,
      paidCol,
      "balance_due",
      "remarks",
    ];
    const lines = [headers.join(",")];
    for (const r of filtered) {
      const adjusted = advanceAdjustedRows.get(r.id);
      const paid = adjusted?.displayPaid ?? Number(r[paidCol] ?? 0);
      const due = adjusted?.displayDue ?? Math.max(balanceOf(r), 0);
      const vals = [
        r[mod.idColumn],
        r.entry_date,
        r[groupField],
        r.passenger_name,
        r.service_type,
        r.country_route,
        r[billCol],
        paid,
        due,
        r.remarks,
      ].map((v) => {
        const s = String(v ?? "");
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      });
      lines.push(vals.join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${mod.key}-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printPage = () => {
    const w = window.open("", "_blank", "width=1000,height=700");
    if (!w) {
      toast.error("পপ-আপ ব্লক হয়েছে");
      return;
    }
    const heading = isAgency
      ? "সাব এজেন্সি হিসাব - এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্"
      : "Vendor Ledger - এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্";
    const periodLabel =
      startDate || endDate ? `${startDate || "শুরু"} → ${endDate || "এখন"}` : "সকল তারিখ";
    const fmt = (n: number) => Number(n || 0).toLocaleString();
    const rowsHtml = filtered
      .map((r, i) => {
        const bill = Number(r[billCol] ?? 0);
        const adjusted = advanceAdjustedRows.get(r.id);
        const paid = adjusted?.displayPaid ?? Number(r[paidCol] ?? 0);
        const due = adjusted?.displayDue ?? Math.max(bill - Number(r[paidCol] ?? 0) - discountOf(r), 0);
        const srcId = String(r.source_id ?? "");
        const service = String(r.service_type ?? "");
        const svcU = service.toUpperCase();
        const isTicket = svcU.includes("TICKET");
        const isBmet = svcU.includes("BMET");
        const isVisa = svcU.includes("VISA");
        let cr = String(r.country_route ?? "");
        if (!cr && srcId) {
          if (isTicket) cr = ticketRouteMap.get(srcId) ?? "";
          else if (isBmet) cr = bmetCountryMap.get(srcId) ?? "";
          else if (isVisa) cr = visaCountryMap.get(srcId) ?? "";
        }
        const passenger = String(r.passenger_name ?? "—");
        const agent = String(r[groupField] ?? "—");
        const pInfo = srcId ? sourceInfoMap.get(srcId) : undefined;
        const pIsAdvance = svcU !== "PAYMENT" && svcU !== "ADVANCE" && svcU !== "OPENING" && paid > 0 && !!pInfo?.has_delivery && isAdvancePayment(r.payment_date as string | null, pInfo?.delivery_date);
        const dueCell =
          due > 0
            ? `<span style="color:#dc2626;font-weight:700">${fmt(due)}</span>`
            : `<span style="color:#059669">Paid</span>`;
        return `<tr>
<td>${i + 1}</td>
<td>${formatDate(r.entry_date as string | null)}<div style="font-size:10px;color:#666">${String(r[mod.idColumn] ?? "")}</div></td>
<td>${passenger}</td>
<td>${service || "—"}${cr ? `<div style="font-size:10px;color:#666">${cr}</div>` : ""}</td>
<td>${agent}</td>
<td class="num">${fmt(bill)}</td>
<td class="num">${fmt(paid)}${pIsAdvance ? ' <span style="font-size:9px;color:#d97706;font-weight:700">(Adv)</span>' : ""}</td>
<td class="num">${dueCell}</td>
</tr>`;
      })
      .join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${heading}</title>
<style>
  body{font-family:'Noto Sans Bengali',system-ui,sans-serif;padding:24px;color:#111}
  h1{margin:0 0 4px;font-size:20px}
  .meta{color:#555;font-size:12px;margin-bottom:14px}
  .summary{display:flex;gap:12px;margin-bottom:14px;font-size:14px;font-weight:700}
  .summary div{padding:8px 12px;border:1px solid #ddd;border-radius:6px;flex:1}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border-bottom:1px solid #e5e5e5;padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#f5f5f5;font-weight:600}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  tfoot td{font-weight:700;background:#fafafa}
  @media print{body{padding:8px}}
</style></head><body>
<h1>${heading}</h1>
<div class="meta">${periodLabel} · মোট ${filtered.length} এন্ট্রি</div>
<div class="summary">
  <div>${billLabel}: <b>৳ ${fmt(totals.bill)}</b></div>
  <div style="color:#059669">${paidLabel}: <b>৳ ${fmt(totals.paid)}</b></div>
  <div style="color:#dc2626">Total Due: <b>৳ ${fmt(totals.due)}</b></div>
</div>
<table>
<thead><tr>
<th>#</th><th>Date / ID</th><th>Passenger</th><th>Service</th><th>${groupLabel}</th>
<th class="num">${billLabel}</th><th class="num">${paidLabel}</th><th class="num">Due</th>
</tr></thead>
<tbody>${rowsHtml}</tbody>
<tfoot><tr><td colspan="5">Total</td><td class="num">${fmt(totals.bill)}</td><td class="num">${fmt(totals.paid)}</td><td class="num">${fmt(totals.due)}</td></tr></tfoot>
</table>
<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script>
</body></html>`);
    w.document.close();
  };

  const resetFilters = () => {
    setSearch("");
    setGroupFilter("all");
    setServiceFilter("all");
    setDueOnly(false);
    setStartDate("");
    setEndDate("");
    setLatestInput("");
  };

  return (
    <div className="relative z-10 space-y-4 print:space-y-2">
      {renderMode !== "payment-only" && (
      <>
      <PageWatermark text={mod.label} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold">{mod.label}</h1>
          <p className="text-sm text-muted-foreground">মোট {rows.length} এন্ট্রি</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button onClick={startCreate} className="gap-1.5">
            <Plus className="h-4 w-4" /> নতুন এন্ট্রি
          </Button>
        </div>
      </div>

      {/* Print header */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">Asia Travel — {mod.label}</h1>
        <p className="text-xs text-muted-foreground">
          {startDate || endDate ? `${startDate || "—"} to ${endDate || "—"}` : "All dates"} ·{" "}
          {filtered.length} entries
        </p>
      </div>

      {/* Filter bar — ModulePage-style grid */}
      <Card className="print:hidden">
        <CardContent className="p-2 sm:p-2.5">
          <div className="space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:flex-row lg:flex-nowrap gap-2 items-end w-full">
              <div className="space-y-1.5 min-w-0 lg:flex-1">
                <Label className="text-xs font-medium truncate block">Start Date</Label>
                <DateInput
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-9 text-sm w-full min-w-0"
                />
              </div>
              <div className="space-y-1.5 min-w-0 lg:flex-1">
                <Label className="text-xs font-medium truncate block">End Date</Label>
                <DateInput
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-9 text-sm w-full min-w-0"
                />
              </div>
              <div className="space-y-1.5 min-w-0 lg:flex-1">
                <Label className="text-xs font-medium truncate block">{groupLabel}</Label>
                <Select value={groupFilter} onValueChange={setGroupFilter}>
                  <SelectTrigger className="h-9 text-sm w-full min-w-0">
                    <SelectValue placeholder={`সব ${groupLabel}`} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">সব {groupLabel}</SelectItem>
                    {groupOptions.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 min-w-0 lg:flex-1">
                <Label className="text-xs font-medium truncate block">সার্ভিস মডিউল</Label>
                <Select value={serviceFilter} onValueChange={setServiceFilter}>
                  <SelectTrigger className="h-9 text-sm w-full min-w-0">
                    <SelectValue placeholder="সব সার্ভিস" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">সব সার্ভিস</SelectItem>
                    {serviceOptions.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 min-w-0 lg:flex-1">
                <Label className="text-xs font-medium truncate block">সর্বশেষ N</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={latestInput}
                  disabled={!!(startDate || endDate)}
                  onChange={(e) => setLatestInput(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="N"
                  className="h-9 text-sm tabular-nums disabled:opacity-50 w-full min-w-0"
                />
              </div>
              <div className="space-y-1.5 flex flex-col col-span-2 sm:col-span-3 lg:col-span-1 lg:shrink-0 min-w-0">
                <div className="flex gap-1.5 flex-nowrap w-full min-w-0">
                  <Button
                    type="button"
                    variant={dueOnly ? "default" : "outline"}
                    onClick={() => setDueOnly((v) => !v)}
                    className="h-9 gap-1 px-1.5 flex-1 min-w-0 lg:flex-none lg:shrink-0 text-[11px] sm:text-xs"
                    title="শুধু Due"
                  >
                    <Wallet className="h-4 w-4 shrink-0" />
                    <span className="lg:hidden xl:inline truncate">শুধু Due</span>
                  </Button>
                  {(() => {
                    const t = todayIso();
                    const isToday = startDate === t && endDate === t;
                    return (
                      <Button
                        type="button"
                        variant={isToday ? "default" : "secondary"}
                        onClick={() => {
                          if (isToday) { setStartDate(""); setEndDate(""); }
                          else { setStartDate(t); setEndDate(t); }
                        }}
                        className="h-9 gap-1 px-1.5 flex-1 min-w-0 lg:flex-none lg:shrink-0 text-[11px] sm:text-xs"
                        title="আজকের লেনদেন"
                      >
                        <Wallet className="h-4 w-4 shrink-0" />
                        <span className="lg:hidden xl:inline truncate">আজকের</span>
                      </Button>
                    );
                  })()}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetFilters}
                    className="h-9 gap-1 px-1.5 flex-1 min-w-0 lg:flex-none lg:shrink-0 text-[11px] sm:text-xs"
                    title="Reset"
                  >
                    <RotateCcw className="h-4 w-4 shrink-0" />
                    <span className="lg:hidden xl:inline truncate">Reset</span>
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="খুঁজুন…"
                  className="pl-9 h-9 text-base"
                />
              </div>
              <div className="shrink-0 text-xs px-2.5 py-1.5 rounded-md border bg-muted/30 text-muted-foreground whitespace-nowrap">
                ফলাফল: <span className="font-semibold text-foreground tabular-nums">{filtered.length}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>




      {/* Main ledger entries — Ticket-page style stacked rows */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center justify-between mb-3 print:hidden">
            <h3 className="text-sm font-semibold">
              {mod.label} এন্ট্রি ({filtered.length})
            </h3>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                className="gap-1.5 h-8"
                title="Export CSV"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={printPage}
                className="gap-1.5 h-8"
                title="Print / Save PDF"
              >
                <Printer className="h-3.5 w-3.5" /> Print
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto -mx-2 px-2">
            <div className="space-y-2 min-w-[860px]">
              <div className="grid grid-cols-[1.05fr_1.35fr_1.35fr_1fr_1fr_auto] gap-4 px-4 py-2 text-xs font-semibold text-muted-foreground border-b border-border/60">
                <div>Date / ID</div>
                <div>Passenger</div>
                <div>Service</div>
                <div>{groupLabel}</div>
                <div className="text-right">Amount</div>
                <div className="text-right print:hidden">Actions</div>
              </div>
              {loading ? (
                <div className="text-center text-muted-foreground py-8">লোড হচ্ছে...</div>
              ) : filtered.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  কোনো এন্ট্রি পাওয়া যায়নি
                </div>
              ) : (
                paged.map((r, idx) => {
                  const bal = balanceOf(r);
                  const passenger = String(r.passenger_name ?? "");
                  const service = String(r.service_type ?? "");
                  let cr = String(r.country_route ?? "");
                  const remarks = cleanAdvanceAdjustmentRemarks(String(r.remarks ?? ""));
                  const svcUpper = service.toUpperCase();
                  const svcLower = service.toLowerCase();
                  const isTicket = svcUpper.includes("TICKET") || svcLower === "tickets";
                  const isBmet = svcUpper.includes("BMET") || svcLower === "bmet_cards";
                  const isKuwait =
                    svcLower === "kuwait_visas" ||
                    (svcUpper.includes("KUWAIT") && svcUpper.includes("VISA"));
                  const isSaudi =
                    svcLower === "saudi_visas" ||
                    (svcUpper.includes("SAUDI") && svcUpper.includes("VISA"));
                  const isVisa = svcUpper.includes("VISA") || isKuwait || isSaudi;
                  const isPayment = svcUpper === "PAYMENT";
                  const isManualAdvAdjust = String(r.source_table ?? "") === "manual_adjust";
                  const adjustIsExpense = Number(r[paidCol] ?? 0) < 0;
                  const isManualAdjust =
                    isManualAdvAdjust ||
                    cr.startsWith("Manual Advance Adjustment") || cr.startsWith("Advance Adjustment");
                  const srcId = String(r.source_id ?? "");
                  const info = srcId ? sourceInfoMap.get(srcId) : undefined;
                  if (!cr && srcId) {
                    if (isTicket) cr = ticketRouteMap.get(srcId) ?? "";
                    else if (isBmet) cr = bmetCountryMap.get(srcId) ?? "";
                    else if (isVisa) cr = visaCountryMap.get(srcId) ?? "";
                  }
                  const serviceLabel = isTicket
                    ? "Air Ticket"
                    : isBmet
                      ? "BMET Card"
                      : isKuwait
                        ? "Kuwait Visa"
                        : isSaudi
                          ? "Saudi Visa"
                          : isPayment
                            ? isAgency
                              ? "Payment Received"
                              : "Payment Paid"
                            : service || "—";
                  if (isManualAdjust) {
                    cr = "";
                  }
                  const ServiceIcon = isTicket
                    ? "✈"
                    : isBmet
                      ? "🪪"
                      : isVisa
                        ? "🌍"
                        : isPayment
                          ? "💵"
                          : "•";
                  const adjusted = advanceAdjustedRows.get(r.id);
                  const displayPaid = adjusted?.displayPaid ?? Number(r[paidCol] ?? 0);
                  const displayDue = adjusted?.displayDue ?? Math.max(bal, 0);
                  const appliedAdvance = adjusted?.applied ?? 0;
                  const isAdvanceBeforeDelivery =
                    !isPayment && !isAdvanceRow(r) && displayPaid > 0 && !!info?.has_delivery &&
                    isAdvancePayment(r.payment_date as string | null, info?.delivery_date);
                  const flightDateRaw = isTicket && srcId ? ticketFlightMap.get(srcId) : undefined;
                  const flightDate = flightDateRaw ? formatDate(flightDateRaw) : "";
                  const cb = String(r.created_by ?? "");
                  const byName = cb ? profilesMap[cb] : "";
                  const passport = String(r.passport ?? info?.passport ?? "");
                  const mobile = String(r.mobile ?? info?.mobile ?? "");
                  const rowProfit = r.profit;
                  const profit =
                    rowProfit !== undefined && rowProfit !== null && rowProfit !== ""
                      ? Number(rowProfit)
                      : info && typeof info.sold === "number" && typeof info.cost === "number"
                        ? info.sold - Number(info.discount ?? 0) - info.cost
                        : 0;
                  const status = info?.status ?? "";
                  const rowCancelled = !!info?.cancelled;
                  return (
                     <div
                       key={r.id}
                       className={`relative row-tint-${idx % 4}${rowCancelled ? " cancelled-row opacity-70 grayscale" : ""} grid gap-3 rounded-md border border-border/70 p-4 shadow-sm grid-cols-[1.05fr_1.35fr_1.35fr_1fr_1fr_auto] items-start transition-colors`}
                       title={rowCancelled ? "বাতিল করা কাজ" : undefined}
                     >
                      {rowCancelled && (
                        <span className="absolute right-3 top-3 rounded-full bg-rose-500/90 px-2 py-0.5 text-[10px] font-semibold text-white">
                          বাতিল
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="hidden text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                          Date / ID
                        </div>
                        <div className="font-bold whitespace-nowrap">
                          {formatDate(r.entry_date as string | null)}
                        </div>
                        <div className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">
                          {String(r[mod.idColumn] ?? "")}
                        </div>
                        {status && (
                          <Badge
                            variant="outline"
                            className={cn("mt-1 text-[10px] whitespace-nowrap", statusBadgeClass(status))}
                          >
                            {status}
                          </Badge>
                        )}
                        {byName && (
                          <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                            by {byName}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="hidden text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                          Passenger
                        </div>
                        <div className="font-bold">{passenger || "—"}</div>
                        {passport && (
                          <div className="text-[11px] text-muted-foreground leading-tight font-mono">
                            PP: {passport}
                          </div>
                        )}
                        {mobile && (
                          <div className={`text-[11px] leading-tight ${mobileColorTextClass(colorFor(mobile)) || "text-muted-foreground"}`}>
                            📱 {mobile}
                          </div>
                        )}
                        {remarks && !isManualAdvAdjust && (
                          <div className="text-[11px] text-muted-foreground/80 italic truncate max-w-[200px] mt-0.5">
                            {remarks}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="hidden text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                          Service
                        </div>
                        {isManualAdvAdjust ? (
                          <>
                            <div className="text-sm font-semibold">Manual</div>
                            <div
                              className={cn(
                                "text-xs font-semibold leading-tight",
                                adjustIsExpense
                                  ? "text-rose-600 dark:text-rose-400"
                                  : "text-emerald-600 dark:text-emerald-400",
                              )}
                            >
                              {adjustIsExpense ? "ব্যয়" : "আয়"}
                            </div>
                            {remarks && (
                              <div className="text-xs text-muted-foreground leading-tight mt-0.5">
                                {remarks}
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="text-sm font-semibold">{serviceLabel}</div>
                            {cr && (
                              <div className="text-xs text-muted-foreground leading-tight">
                                {cr}
                              </div>
                            )}
                            {info?.airline && (
                              <div className="text-xs text-muted-foreground leading-tight">
                                {info.airline}
                              </div>
                            )}
                            {flightDate && (
                              <div className="text-xs text-muted-foreground leading-tight">
                                ✈ {flightDate}
                              </div>
                            )}
                            {info?.pnr && (
                              <div className="text-xs text-muted-foreground leading-tight">
                                PNR: {info.pnr}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="hidden text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                          {groupLabel}
                        </div>
                        <span className="font-semibold text-left">
                          {String(r[groupField] ?? "—")}
                        </span>
                        {isAgency && info?.vendor && (
                          <div className="text-[11px] text-muted-foreground leading-tight">
                            V: {info.vendor}
                            {typeof info?.cost === "number" && info.cost > 0 ? (
                              <span className="tabular-nums"> · ৳{info.cost.toLocaleString()}</span>
                            ) : (
                              <span title="Vendor cost এন্ট্রি হয়নি" className="ml-1 text-amber-500">⚠️</span>
                            )}
                          </div>
                        )}
                        {!isAgency && info?.agency_sold && (
                          <div className="text-[11px] text-muted-foreground leading-tight">
                            C: {info.agency_sold}
                            {typeof info?.sold === "number" && info.sold > 0 && (
                              <span className="tabular-nums"> · ৳{info.sold.toLocaleString()}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="tabular-nums whitespace-nowrap text-right">
                        <div className="hidden text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                          Amount
                        </div>
                        {isPayment ? (
                          <>
                            <div className="font-bold text-base text-rose-500">
                              − ৳ {Number(r[paidCol] ?? 0).toLocaleString()}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {String(r.payment_method ?? "—")}
                            </div>
                            <Badge
                              variant="outline"
                              className="mt-1 border-sky-500/50 text-sky-600 dark:text-sky-400 text-[10px]"
                            >
                              {isAgency ? "Payment Received" : "Payment Paid"}
                            </Badge>
                          </>
                        ) : isManualAdvAdjust ? (
                          <>
                            <div
                              className={cn(
                                "font-bold text-base",
                                adjustIsExpense
                                  ? "text-rose-500"
                                  : "text-emerald-600 dark:text-emerald-400",
                              )}
                            >
                              {adjustIsExpense ? "−" : "+"} ৳ {Math.abs(Number(r[paidCol] ?? 0)).toLocaleString()}
                            </div>
                            <Badge
                              variant="outline"
                              className={cn(
                                "mt-1 text-[10px]",
                                adjustIsExpense
                                  ? "border-rose-500/50 text-rose-600 dark:text-rose-400"
                                  : "border-emerald-500/50 text-emerald-600 dark:text-emerald-400",
                              )}
                            >
                              {adjustIsExpense ? "Advance কমেছে" : "Advance বেড়েছে"}
                            </Badge>
                          </>
                        ) : (
                          <>
                        <div className="font-bold text-base">
                          ৳ {Number(r[billCol] ?? 0).toLocaleString()}
                        </div>
                        <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                          {isAgency ? "Recv" : "Paid"}: {isAdvanceBeforeDelivery ? <><AdvanceBadge advance /> </> : null}{displayPaid.toLocaleString()}
                        </div>
                        {appliedAdvance > 0 && (
                          <div className="text-[11px] text-muted-foreground">
                            Advance Adjusted: {appliedAdvance.toLocaleString()}
                          </div>
                        )}
                        <div className="text-xs">
                          {!isAgency && !countsForVendorDue(r) && Number(r[billCol] ?? 0) > 0 ? (
                            <Badge
                              variant="outline"
                              className="border-amber-500/50 text-amber-600 dark:text-amber-400 text-[10px]"
                              title="Vendor থেকে এখনো রিসিভ হয়নি (status: Pending Delivery হলে Due হবে)"
                            >
                              এখনো Due নয়
                            </Badge>
                          ) : displayDue > 0 ? (
                            isAgency && String(r[groupField] ?? "").trim().toLowerCase() === "self" ? (
                              <span
                                className="text-rose-500 font-semibold"
                                title="Self মানে সাধারণ passenger — agent receive প্রযোজ্য নয়"
                              >
                                Cus:-Due: {displayDue.toLocaleString()}
                              </span>
                            ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                isAgency ? openPaymentForRow(r, displayDue) : openPayment(String(r[groupField] ?? ""), displayDue);
                              }}
                              className="inline-flex items-center gap-1 text-rose-500 hover:underline font-semibold rounded-md px-1 outline outline-1 outline-transparent hover:outline-primary hover:bg-primary/10 hover:shadow-md transition-colors"
                              title="পেমেন্ট"
                            >
                              {isAgency ? "Cus:-Due" : "Ven:-Due"}: {displayDue.toLocaleString()} <Wallet className="h-3 w-3" />
                            </button>
                            )
                          ) : bal >= 0 || appliedAdvance > 0 ? (
                            <Badge
                              variant="outline"
                              className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400 text-[10px]"
                            >
                              Paid
                            </Badge>
                          ) : (
                            <span className="text-amber-500">
                              Adv: {Math.abs(bal).toLocaleString()}
                            </span>
                          )}
                        </div>
                        {displayPaid > 0 && typeof info?.cost === "number" && info.cost > 0 && (
                          <div
                            className={cn(
                              "text-[11px] font-medium",
                              profit < 0
                                ? "text-rose-500"
                                : displayDue <= 0 && Number(r[billCol] ?? 0) > 0
                                  ? "text-emerald-400"
                                  : "text-amber-400",
                            )}
                          >
                            Profit: {profit.toLocaleString()}
                          </div>
                        )}
                          </>
                        )}
                      </div>
                      <div className="print:hidden">
                        <div className="flex justify-end gap-0.5 lg:justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => { e.stopPropagation(); setViewRow(r); }}
                            title="View"
                          >
                            <Eye className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => { e.stopPropagation(); startEdit(r); }}
                            title="Edit"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              const owner = r.created_by as string | null | undefined;
                              if (owner && user?.id && owner !== user.id) {
                                toast.error("এটি অন্য ইউজারের এন্ট্রি — আপনি ডিলিট করতে পারবেন না।");
                                return;
                              }
                              setDeleteRow(r);
                            }}
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3 text-rose-500" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          {!loading && filtered.length > 0 && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between print:hidden">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>প্রতি পৃষ্ঠায়</span>
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-[72px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="150">150</SelectItem>
                    <SelectItem value="200">200</SelectItem>
                  </SelectContent>
                </Select>
                <span>টি দেখান</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  পৃষ্ঠা {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  পূর্ববর্তী
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  পরবর্তী
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Form dialog */}
      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "এডিট করুন" : "নতুন এন্ট্রি"} — {mod.label}
            </DialogTitle>
          </DialogHeader>
          {editing &&
            (() => {
              const srcId = String(editing.source_id ?? "");
              const info = srcId ? sourceInfoMap.get(srcId) : undefined;
              const cb = String(editing.created_by ?? "");
              const byName = cb ? profilesMap[cb] : "";
              const svc = String(editing.service_type ?? "");
              const cr = String(editing.country_route ?? "");
              return (
                <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-xs text-primary font-semibold">
                      {String(editing[mod.idColumn] ?? "")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(editing.entry_date as string | null)}
                    </span>
                    {byName && <span className="text-xs text-muted-foreground">by {byName}</span>}
                  </div>
                  <div className="font-semibold">{String(editing.passenger_name ?? "—")}</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {info?.passport && (
                      <div>
                        <span className="opacity-60">Passport:</span>{" "}
                        <span className="text-foreground font-medium">{info.passport}</span>
                      </div>
                    )}
                    {info?.mobile && (
                      <div>
                        <span className="opacity-60">Mobile:</span>{" "}
                        <span className={`font-medium ${mobileColorTextClass(colorFor(String(info.mobile))) || "text-foreground"}`}>{info.mobile}</span>
                      </div>
                    )}
                    {svc && (
                      <div>
                        <span className="opacity-60">Service:</span>{" "}
                        <span className="text-foreground font-medium">{svc}</span>
                      </div>
                    )}
                    {cr && (
                      <div>
                        <span className="opacity-60">Country/Route:</span>{" "}
                        <span className="text-foreground font-medium">{cr}</span>
                      </div>
                    )}
                    <div>
                      <span className="opacity-60">{groupLabel}:</span>{" "}
                      <span className="text-foreground font-medium">
                        {String(editing[groupField] ?? "—")}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}
          <FormSections mod={formMod} form={form} setForm={setForm} />
          {editing && editBalancePreview && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
              <div className="mb-1 text-xs font-semibold text-muted-foreground">
                {groupLabel}: {editBalancePreview.key} — সমন্বিত হিসাব
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
                <div>
                  <span className="opacity-60">মোট {billLabel}:</span>{" "}
                  <span className="font-semibold text-foreground">
                    ৳{Math.round(editBalancePreview.bill).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="opacity-60">মোট {paidLabel}:</span>{" "}
                  <span className="font-semibold text-foreground">
                    ৳{Math.round(editBalancePreview.paid).toLocaleString()}
                  </span>
                </div>
                {editBalancePreview.advance > 0 && (
                  <div>
                    <span className="opacity-60">অগ্রিম:</span>{" "}
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      ৳{Math.round(editBalancePreview.advance).toLocaleString()}
                    </span>
                  </div>
                )}
                <div>
                  <span className="opacity-60">মোট ব্যালেন্স:</span>{" "}
                  {editBalancePreview.net > 0 ? (
                    <span className="font-bold text-destructive">
                      ৳{Math.round(editBalancePreview.net).toLocaleString()} বাকি
                    </span>
                  ) : editBalancePreview.net < 0 ? (
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      ৳{Math.round(-editBalancePreview.net).toLocaleString()} অগ্রিম
                    </span>
                  ) : (
                    <span className="font-bold text-foreground">পরিশোধিত</span>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="sm:justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setForm(emptyForm(mod));
                toast.success("ফর্ম খালি করা হয়েছে");
              }}
              className="gap-1.5"
            >
              <RotateCcw className="h-4 w-4" /> CLEAR
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpenForm(false)}>
                বাতিল
              </Button>
              <Button onClick={submit} disabled={saving}>
                {saving ? "সেভ হচ্ছে..." : "সেভ"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View dialog */}
      <Dialog open={!!viewRow} onOpenChange={(o) => !o && setViewRow(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>এন্ট্রি বিস্তারিত — {String(viewRow?.[mod.idColumn] ?? "")}</DialogTitle>
          </DialogHeader>
          {viewRow && (() => {
            const adjusted = advanceAdjustedRows.get(viewRow.id);
            const applied = Number(viewRow.advance_applied ?? 0);
            const cashPaid = Number(viewRow[paidCol] ?? 0);
            const displayPaid = adjusted?.displayPaid ?? cashPaid + applied;
            const displayDue = adjusted?.displayDue ?? Math.max(balanceOf(viewRow), 0);
            const srcId = String(viewRow.source_id ?? "");
            const info = srcId ? sourceInfoMap.get(srcId) : undefined;
            const cb = String(viewRow.created_by ?? "");
            const byName = cb ? profilesMap[cb] : "";
            return (
            <div className="grid grid-cols-2 gap-3 text-sm">
              {mod.fields.map((f) => {
                const v = viewRow[f.name];
                // Show the FULL paid (cash + applied advance) so it never reads 0.
                const isPaidField = f.name === paidCol;
                const display = isPaidField
                  ? displayPaid.toLocaleString()
                  : f.type === "date"
                    ? formatDate(v as string | null)
                    : f.type === "number"
                      ? Number(v ?? 0).toLocaleString()
                      : String(v ?? "—");
                return (
                  <div key={f.name} className="space-y-0.5">
                    <div className="text-xs text-muted-foreground">{f.label}</div>
                    <div className="font-medium break-words">
                      {display || "—"}
                      {isPaidField && applied > 0 ? (
                        <span className="ml-1 text-[11px] text-muted-foreground">
                          (Cash {cashPaid.toLocaleString()} + Advance {applied.toLocaleString()})
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {(info?.passport || info?.mobile) && (
                <>
                  {info?.passport && (
                    <div className="space-y-0.5">
                      <div className="text-xs text-muted-foreground">Passport</div>
                      <div className="font-medium break-words">{info.passport}</div>
                    </div>
                  )}
                  {info?.mobile && (
                    <div className="space-y-0.5">
                      <div className="text-xs text-muted-foreground">Mobile</div>
                      <div className="font-medium break-words">{info.mobile}</div>
                    </div>
                  )}
                </>
              )}
              {byName && (
                <div className="space-y-0.5 col-span-2">
                  <div className="text-xs text-muted-foreground">Entry By</div>
                  <div className="font-medium break-words">{byName}</div>
                </div>
              )}
              <div className="space-y-0.5 col-span-2 pt-2 border-t border-border/60">
                <div className="text-xs text-muted-foreground">Balance Due</div>
                <div
                  className={cn(
                    "text-lg font-bold tabular-nums",
                    displayDue > 0 ? "text-rose-500" : "text-emerald-600",
                  )}
                >
                  ৳ {displayDue.toLocaleString()}
                </div>
              </div>
            </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewRow(null)}>
              বন্ধ করুন
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <PasswordConfirmDialog
        open={!!deleteRow}
        onOpenChange={(o) => { if (!o) setDeleteRow(null); }}
        title="ডিলিট করবেন?"
        description={
          !isAgency && deleteRow && isPaymentRow(deleteRow)
            ? `এই পেমেন্ট এন্ট্রিটি (${String(deleteRow?.[mod.idColumn] ?? "")}) মুছলে এর মাধ্যমে যেসব বিলে টাকা adjust হয়েছিল তা ফেরত গিয়ে বিলগুলো আবার Due হয়ে যাবে। নিশ্চিত করতে আপনার লগইন পাসওয়ার্ড দিন।`
            : `এই এন্ট্রিটি (${String(deleteRow?.[mod.idColumn] ?? "")}) মুছে ফেলা হবে। নিশ্চিত করতে আপনার লগইন পাসওয়ার্ড দিন।`
        }
        confirmLabel="হ্যাঁ, ডিলেট"
        confirmClassName="bg-rose-600 hover:bg-rose-700 text-white"
        onConfirmed={confirmDelete}
      />
      </>
      )}

      {/* Payment entry dialog (Receive / Pay) */}
      <Dialog
        open={payOpen}
        onOpenChange={(o) => {
          setPayOpen(o);
          if (!o) setPayRow(null);
        }}
      >
        <DialogContent className={cn(payRow ? "max-w-md" : "max-w-3xl", "max-h-[92vh] overflow-y-auto")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" /> {payTitle}
              {payRow && (
                <span className="text-xs font-normal text-muted-foreground">
                  — যাত্রী-নির্দিষ্ট
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {payRow && (
            <div className="rounded-md border bg-muted/30 p-2.5 text-xs space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-primary font-semibold">
                  {String(payRow[mod.idColumn] ?? "")}
                </span>
                <span className="text-muted-foreground">
                  {formatDate(payRow.entry_date as string | null)}
                </span>
                <span className="text-muted-foreground">
                  {String(payRow.service_type ?? "—")}
                </span>
              </div>
              <div className="font-semibold text-sm text-foreground">
                {String(payRow.passenger_name ?? "—")}
              </div>
              <div className="text-muted-foreground">
                {groupFieldLabel}:{" "}
                <span className="text-foreground font-medium">
                  {String(payRow[groupField] ?? "—")}
                </span>
              </div>
            </div>
          )}

          {/* Shared top fields */}
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Date</Label>
                <DateInput
                  
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Entry By</Label>
                <Input value={displayName(profile, user)} readOnly className="h-10 bg-muted/40" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                {groupFieldLabel} <span className="text-rose-500">*</span>
              </Label>
              {payRow ? (
                <Input value={payTarget} readOnly className="h-10 bg-muted/40 font-semibold" />
              ) : (
                <LookupSelect
                  kind={isAgency ? "sub_agency" : "vendor"}
                  compact
                  value={payTarget}
                  onChange={(v) => {
                    setPayTarget(v);
                    const due = dueForGroup(v);
                    setPayDue(due);
                    setPayAmount(String(due > 0 ? due : ""));
                    setSelectedLines({});
                  }}
                />
              )}
            </div>

            {/* Row-mode: single amount input */}
            {payRow && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">এই যাত্রীর Due</Label>
                  <Input
                    value={payDue.toLocaleString()}
                    readOnly
                    className="h-10 bg-muted/40 tabular-nums font-semibold text-rose-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {payAmountLabel} <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="h-10 text-lg font-semibold tabular-nums"
                    autoFocus
                  />
                </div>
              </div>
            )}

            {/* Payment from User Balance toggle (vendor payment only — never on agent receive) */}
            {!payRow && payTarget && !isAgency && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2.5">
                <Checkbox
                  id="payAsAdvance"
                  checked={payAsAdvance}
                  onCheckedChange={(c) => {
                    setPayAsAdvance(!!c);
                    if (c) {
                      setSelectedLines({});
                      setPayAsMdDeposit(false);
                      setPayAsAdjust(false);
                      setPayMode("fifo");
                      // Keep any amount the user already typed; only pre-fill when empty.
                      setPayAmount((prev) =>
                        prev && Number(prev) > 0 ? prev : String(payDue > 0 ? payDue : ""),
                      );
                    }
                  }}
                />
                <Label htmlFor="payAsAdvance" className="text-sm font-medium cursor-pointer flex-1">
                  Mark as Payment from User Balance
                  <span className="block text-[11px] text-muted-foreground font-normal">
                    vendor কে পেমেন্ট দিন user এর balance থেকে। Auto FIFO / Bill-by-Bill দিয়ে বিলে adjust হবে — বেশি দিলে বাকি টাকা advance হিসেবে জমা থাকবে।
                  </span>
                </Label>
              </div>
            )}

            {/* Mark as Vendor Deposit From MD Sir — vendor ledger only, bulk mode */}
            {!payRow && payTarget && !isAgency && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5">
                <Checkbox
                  id="payAsMdDeposit"
                  checked={payAsMdDeposit}
                  onCheckedChange={(c) => {
                    setPayAsMdDeposit(!!c);
                    if (c) {
                      setSelectedLines({});
                      setPayAsAdvance(false);
                      setPayAsAdjust(false);
                      setPayMode("fifo");
                      // Keep any amount the user already typed; only pre-fill when empty.
                      setPayAmount((prev) =>
                        prev && Number(prev) > 0 ? prev : String(payDue > 0 ? payDue : ""),
                      );
                    }
                  }}
                />
                <Label htmlFor="payAsMdDeposit" className="text-sm font-medium cursor-pointer flex-1">
                  Mark as Vendor Deposit From MD Sir
                  <span className="block text-[11px] text-muted-foreground font-normal">
                    টিকেটিং পোর্টাল বা vendor কে Deposit করুন। Auto FIFO / Bill-by-Bill দিয়ে বিলে adjust হবে — due না থাকলে বাকি টাকা advance হিসেবে জমা থাকবে। লেজারের বাহিরের টাকা, user এর balance অপরিবর্তিত থাকবে।
                  </span>
                </Label>
              </div>
            )}

            {/* Manual Advance Adjustment (আয়/ব্যয়) — vendor ledger only, bulk mode */}
            {!payRow && payTarget && !isAgency && (
              <div className="rounded-md border border-sky-500/40 bg-sky-500/5 p-2.5 space-y-2.5">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="payAsAdjust"
                    checked={payAsAdjust}
                    onCheckedChange={(c) => {
                      setPayAsAdjust(!!c);
                      if (c) { setPayAmount(""); setSelectedLines({}); setPayAsAdvance(false); setPayAsMdDeposit(false); }
                    }}
                  />
                  <Label htmlFor="payAsAdjust" className="text-sm font-medium cursor-pointer flex-1">
                    Manual Advance Adjustment (আয়/ব্যয়)
                    <span className="block text-[11px] text-muted-foreground font-normal">
                      Advance balance-এ ম্যানুয়ালি যোগ/বিয়োগ করুন। Cash/Bank ব্যালেঞ্জ অপরিবর্তিত থাকবে।
                    </span>
                  </Label>
                </div>
                {payAsAdjust && (
                  <div className="grid grid-cols-2 gap-3 pl-6">
                    <div className="space-y-1.5">
                      <Label className="text-xs">ধরন (Type)</Label>
                      <Select value={adjustKind} onValueChange={(v) => setAdjustKind(v as "refund" | "expense")}>
                        <SelectTrigger className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="refund">আয় / Refund (Advance +)</SelectItem>
                          <SelectItem value="expense">ব্যয় / অতিরিক্ত বিল (Advance −)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        Amount <span className="text-rose-500">*</span>
                      </Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                        className="h-10 text-lg font-semibold tabular-nums"
                        autoFocus
                      />
                    </div>
                    <div className="col-span-2 text-[11px] text-muted-foreground">
                      বর্তমান Advance Balance:{" "}
                      <span className="font-semibold text-emerald-600">
                        ৳ {advanceForGroup(payTarget).toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Bulk-mode: Tabs (Auto-FIFO / Bill-by-Bill). Shown for the normal flow,
                "Payment from User Balance" (payAsAdvance) and "MD Sir Deposit"
                (payAsMdDeposit). Hidden only for manual adjustment. */}
            {!payRow && payTarget && !payAsAdjust && (
              <Tabs value={payMode} onValueChange={(v) => setPayMode(v as "fifo" | "specific")}>
                <TabsList className="grid grid-cols-2 w-full">
                  <TabsTrigger value="fifo">Auto FIFO (পুরাতন → নতুন)</TabsTrigger>
                  <TabsTrigger value="specific">Bill-by-Bill (নির্দিষ্ট)</TabsTrigger>
                </TabsList>


                <TabsContent value="fifo" className="space-y-3 pt-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Total Outstanding</Label>
                      <Input
                        value={payDue.toLocaleString()}
                        readOnly
                        className="h-10 bg-muted/40 tabular-nums font-semibold text-rose-500"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        {payAmountLabel} <span className="text-rose-500">*</span>
                      </Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                        className="h-10 text-lg font-semibold tabular-nums"
                        autoFocus
                      />
                    </div>
                  </div>
                  {fifoPreview.length > 0 && (
                    <div className="rounded-md border max-h-[40vh] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Date / ID</TableHead>
                            <TableHead className="text-xs">Passenger</TableHead>
                            <TableHead className="text-right text-xs">Due / বাকি</TableHead>
                            <TableHead className="text-right text-xs">Paying Now / এখন দিচ্ছি</TableHead>
                            <TableHead className="text-right text-xs">Remaining / অবশিষ্ট</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {fifoPreview.map(({ row, alloc, due }, idx) => (
                            <TableRow
                              key={row.id}
                              className={alloc > 0 ? `row-tint-${idx % 4}` : `row-tint-${idx % 4} opacity-40`}
                            >
                              <TableCell className="text-xs">
                                <div>{formatDate(row.entry_date as string | null)}</div>
                                <div className="font-mono text-[10px] text-muted-foreground">
                                  {String(row[mod.idColumn] ?? "")}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs">
                                {String(row.passenger_name ?? "—")}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs">
                                {due.toLocaleString()}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs font-semibold text-emerald-600">
                                {alloc > 0 ? alloc.toLocaleString() : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs">
                                {alloc >= due ? (
                                  <Badge variant="outline" className="border-emerald-500/50 text-emerald-600 text-[10px]">✓ Cleared</Badge>
                                ) : alloc > 0 ? (
                                  <span className="text-amber-600 font-semibold">৳ {(due - alloc).toLocaleString()} due</span>
                                ) : (
                                  <span className="text-rose-500">৳ {due.toLocaleString()} due</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="specific" className="space-y-3 pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      নির্দিষ্ট বিল বাছাই করুন এবং পরিমাণ এডিট করুন
                    </span>
                    <span className="font-semibold tabular-nums">
                      মোট: {specificTotal.toLocaleString()}
                    </span>
                  </div>
                  <div className="rounded-md border max-h-[50vh] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8"></TableHead>
                          <TableHead className="text-xs">Date / ID</TableHead>
                          <TableHead className="text-xs">Passenger</TableHead>
                          <TableHead className="text-right text-xs">Due / বাকি</TableHead>
                          <TableHead className="text-right text-xs w-32">Paying Now / এখন দিচ্ছি</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {openBookingsFor(payTarget).map((r, idx) => {
                          const due = advanceAdjustedRows.get(r.id)?.displayDue ?? Math.max(balanceOf(r), 0);
                          const checked = r.id in selectedLines;
                          return (
                            <TableRow key={r.id} className={`row-tint-${idx % 4}`}>
                              <TableCell>
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(c) => {
                                    setSelectedLines((prev) => {
                                      const next = { ...prev };
                                      if (c) next[r.id] = String(due);
                                      else delete next[r.id];
                                      return next;
                                    });
                                  }}
                                />
                              </TableCell>
                              <TableCell className="text-xs">
                                <div>{formatDate(r.entry_date as string | null)}</div>
                                <div className="font-mono text-[10px] text-muted-foreground">
                                  {String(r[mod.idColumn] ?? "")}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs">
                                {String(r.passenger_name ?? "—")}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs">
                                {due.toLocaleString()}
                              </TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  disabled={!checked}
                                  value={selectedLines[r.id] ?? ""}
                                  onChange={(e) =>
                                    setSelectedLines((prev) => ({ ...prev, [r.id]: e.target.value }))
                                  }
                                  className="h-8 text-right tabular-nums"
                                  max={due}
                                />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {openBookingsFor(payTarget).length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-6">
                              কোনো অপরিশোধিত বিল নেই
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            )}

            <div className={payAsAdjust ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
              {!payAsAdjust && (
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    Payment Method <span className="text-rose-500">*</span>
                  </Label>
                  <Select value={payMethod} onValueChange={setPayMethod}>
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="-- Method --" />
                    </SelectTrigger>
                    <SelectContent>
                      {visiblePaymentMethods.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isVendorReceivedMethod(payMethod) ? (
                    <p className="mt-1.5 text-[11px] leading-snug text-orange-600 dark:text-orange-400">
                      🏢 Vendor Rece — যাত্রী সরাসরি Vendor কে দিয়েছে, Vendor এর বিল পরিশোধ হবে ও Due কমবে; আপনার ব্যালেন্সে যোগ হবে না।
                    </p>
                  ) : isAgency && isMdReceivedMethod(payMethod) && (
                    <p className="mt-1.5 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
                      ⚠️ এই টাকা সরাসরি MD-এর কাছে যাবে — user cash balance-এ যোগ হবে না, কিন্তু My Accounts ও Cash Handover-এ এন্ট্রি থাকবে ({payMethod})।
                    </p>
                  )}
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Remarks</Label>
                <Input
                  value={payRemarks}
                  onChange={(e) => setPayRemarks(e.target.value)}
                  placeholder="মন্তব্য (ঐচ্ছিক)"
                />
              </div>
            </div>
          </div>
          {/* Vendor bulk payment: force an explicit classification so staff can't
              accidentally mis-book a payment. One of the three "mark as" options
              must be chosen before saving. */}
          {!isAgency && !payRow && payTarget && !(payAsAdvance || payAsMdDeposit || payAsAdjust) && (
            <p className="text-[12px] text-amber-600 font-medium px-1 -mt-1">
              ⚠️ সংরক্ষণের আগে উপরের তিনটি অপশনের যেকোনো একটি অবশ্যই নির্বাচন করুন (User Balance / MD Deposit / Manual Adjustment)।
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              বাতিল
            </Button>
            <Button
              onClick={submitPayment}
              disabled={
                paySaving ||
                (!isAgency && !payRow && !!payTarget && !(payAsAdvance || payAsMdDeposit || payAsAdjust))
              }
              className="bg-emerald-600 hover:bg-emerald-700 gap-2"
            >
              <Wallet className="h-4 w-4" />{" "}
              {paySaving
                ? "সেভ হচ্ছে..."
                : !payRow && payMode === "specific"
                  ? `সংরক্ষণ (${specificTotal.toLocaleString()})`
                  : "সংরক্ষণ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PartyProfileDrawer
        open={!!profileParty}
        onOpenChange={(o) => !o && setProfileParty(null)}
        kind={isAgency ? "customer" : "vendor"}
        partyName={profileParty}
        onRenamed={(_oldName, newName) => {
          setProfileParty(newName);
          void load();
        }}
      />
    </div>
  );
}
