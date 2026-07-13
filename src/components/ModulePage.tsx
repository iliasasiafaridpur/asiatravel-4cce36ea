import { DateInput } from "@/components/ui/date-input";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { resilientInsert } from "@/lib/offline-queue";
import { generateNextId } from "@/lib/idgen";
import { formatDate, statusBadgeClass, isAdvancePayment, type Field, type ModuleSchema, type Section } from "@/lib/modules";
import { AdvanceBadge } from "@/components/AdvanceBadge";
import { PageWatermark } from "@/components/PageWatermark";
import { LookupSelect } from "@/components/LookupSelect";
import { applyFormat, capitalizeWords, partyCodePrefix, partySerialCode } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2, Search, Wallet, RotateCcw, ChevronDown, ChevronLeft, ChevronRight, Save, Ban, Eye, UserRound, Users, Building2, X } from "lucide-react";
import { PasswordConfirmDialog, verifyCurrentPassword } from "@/components/PasswordConfirmDialog";
import { toast } from "sonner";
import { TicketRefundDialog } from "@/components/TicketRefundDialog";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { useRole } from "@/hooks/useRole";
import { useFormDraft } from "@/hooks/useFormDraft";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { PassportScanner, type PassportFields } from "@/components/PassportScanner";
import { speakModuleEntry, speakReceived, speakDelivery } from "@/lib/voice";
import { DueReceiveDialog, type DueReceivePreselect } from "@/components/DueReceiveDialog";
import { ExtraDueReceiveDialog, type ExtraDuePreselect } from "@/components/ExtraDueReceiveDialog";
import { BmetQuickManage } from "@/components/BmetQuickManage";
import { BmetMonthlyPrint } from "@/components/BmetMonthlyPrint";
import { PassengerProfileDrawer } from "@/components/PassengerProfileDrawer";
import { RowDetailDrawer } from "@/components/RowDetailDrawer";
import { StatusChangeDrawer, type StatusChangeRequest } from "@/components/StatusChangeDrawer";
import { useMobileColors, mobileColorTextClass, normalizeMobileForColor } from "@/hooks/useMobileColors";
import { DUE_RECEIVE_METHODS, isCashMethod } from "@/lib/payment-methods";

import { SmartSearchPanel } from "@/components/SmartSearchPanel";
import { AirlinesPadDialog } from "@/components/AirlinesPadDialog";
import { CopyInlineButton } from "@/components/CopyInlineButton";

// Map module table → (received column, service-type label) used by StatusChangeDrawer
const RECV_META: Record<string, { recvCol: string; serviceType: string }> = {
  tickets: { recvCol: "received", serviceType: "Ticket" },
  bmet_cards: { recvCol: "received_amount", serviceType: "BMET Card" },
  saudi_visas: { recvCol: "received_amount", serviceType: "Saudi Visa" },
  kuwait_visas: { recvCol: "received", serviceType: "Kuwait Visa" },
  others: { recvCol: "received_amount", serviceType: "Other" },
};

// এন্ট্রির সময় প্রাথমিক টাকা গ্রহণের মাধ্যম নির্বাচন — "Vendor Received" এখানে
// বাদ (বুকিংয়ের সময় ভেন্ডর সেটেল ফ্লো আলাদা)। Cash = স্টাফ ক্যাশে, বাকি সব MD-তে।
const ENTRY_RECEIVE_METHODS = DUE_RECEIVE_METHODS.filter((m) => m !== "Vendor Received");

// টেবিল যেগুলোতে "কাজ বাতিল / ফেরত" (soft-cancel) সুবিধা আছে
const CANCELABLE_TABLES = new Set(["bmet_cards", "saudi_visas", "kuwait_visas", "tickets"]);

// মডিউল কী → DueReceiveDialog এর serviceKey মিল
const DUE_SERVICE_KEY: Record<string, DueReceivePreselect["serviceKey"]> = {
  tickets: "tickets",
  bmet: "bmet",
  "saudi-visa": "saudi-visa",
  "kuwait-visa": "kuwait-visa",
  other: "other",
};

// মডিউল যেগুলোতে Extra Service যুক্ত করা যাবে (passenger + vendor সহ সার্ভিস মডিউল)
const EXTRA_SERVICE_MODULES = ["tickets", "bmet", "saudi-visa", "kuwait-visa", "other"];
const STATUS_EVENT_SOURCES = new Set(["status_event", "status_change", "status-delivery"]);

export type ExtraServiceRow = {
  id?: string;
  service_name: string;
  service_price: number;
  received_amount: number;
  vendor_cost: number;
  notes: string;
};

type Row = Record<string, unknown> & { id: string };

interface Props {
  module: ModuleSchema;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const BN_MONTHS = [
  "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
  "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
];
// "YYYY-MM" → "জুলাই ২০২৬"
const formatMonthLabel = (key: string) => {
  const [y, m] = key.split("-");
  const idx = Number(m) - 1;
  const name = idx >= 0 && idx < 12 ? BN_MONTHS[idx] : m;
  return `${name} ${y}`;
};



function partySerialLabel(kind: "agent" | "vendor", serial: unknown, code?: unknown): string {
  const prefix = partyCodePrefix(kind);
  const n = Number(serial);
  if (Number.isFinite(n) && n > 0) return partySerialCode(kind, Math.trunc(n));
  const raw = String(code ?? "").trim();
  if (!raw) return "—";
  const tail = raw.match(/(\d+)$/)?.[1];
  if (tail) return `${prefix}-${tail.padStart(3, "0")}`;
  return raw.replace(/^(VND|VEN)-/i, "V-").replace(/^AGT-/i, "A-");
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    return String(o.message ?? o.details ?? o.hint ?? JSON.stringify(o));
  }
  return String(e);
}

function emptyForm(mod: ModuleSchema): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  for (const field of mod.fields) {
    if (field.type === "number") f[field.name] = 0;
    else if (field.type === "boolean") f[field.name] = false;
    else if (field.name === "status" && mod.statuses?.length) f[field.name] = mod.statuses[0];
    else if (field.type === "date" && field.name === "entry_date") f[field.name] = todayIso();
    else if (field.type === "select") f[field.name] = field.defaultEmpty ? "" : (field.options?.[0] ?? "");
    else if (field.lookup === "sub_agency") f[field.name] = "Self";
    else f[field.name] = "";
  }
  return f;
}

function selectColumns(mod: ModuleSchema): string {
  // Contact tables (agents/vendors) have no transactional columns
  // (entry_date / created_by / received_by). Only request those on tables
  // that actually carry an entry_date field.
  const isTransactional = mod.fields.some((f) => f.name === "entry_date");
  const columns = new Set(["id", mod.idColumn, "created_at"]);
  if (isTransactional) {
    columns.add("created_by");
    columns.add("received_by");
  }
  // status_by only exists on the service tables that have a status workflow
  if (RECV_META[mod.table]) columns.add("status_by");
  // এন্ট্রির গৃহীত টাকার মাধ্যম (edit ফর্মে সঠিক মাধ্যম দেখাতে দরকার)
  if (RECV_META[mod.table]) columns.add("payment_method");
  // soft-cancel columns (BMET / Saudi / Kuwait / Tickets)
  if (CANCELABLE_TABLES.has(mod.table)) {
    columns.add("cancelled");
    columns.add("cancel_reason");
    columns.add("cancel_date");
  }
  // Air Ticket cancel & refund figures
  if (mod.table === "tickets") {
    columns.add("vendor_refund");
    columns.add("vendor_refund_fee");
    columns.add("passenger_refund");
    columns.add("passenger_refund_mode");
    columns.add("office_refund_fee");
  }
  // BMET কল ফলো-আপ ফিল্ড (Quick Manage এর "কল করা" মোডে দরকার হয়)
  if (mod.table === "bmet_cards") {
    columns.add("received_date");
    columns.add("call_status");
    columns.add("last_call_date");
    columns.add("called_by");
  }
  if (mod.table === "agents" || mod.table === "vendors") {
    columns.add("serial_no");
  }
  mod.fields.forEach((field) => columns.add(field.name));
  return Array.from(columns).join(",");
}

export function ModulePage({ module: mod }: Props) {
  const { user, profile } = useCurrentUser();
  const { canApprove } = useRole();
  const { colorFor } = useMobileColors();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [fieldFilters, setFieldFilters] = useState<Record<string, string>>({});
  const [dueOnly, setDueOnly] = useState(false);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  // মাস-ভিত্তিক পেজিনেশন (শুধু Air Ticket / BMET): 0 = সর্বশেষ মাস
  const [monthIndex, setMonthIndex] = useState(0);
  // BMET: তারিখ অনুযায়ী স্টাটাস পরিবর্তন ফিল্টার — কোন তারিখে কোন স্টাটাসে গিয়েছে তা দেখায়
  const [statusChangeDate, setStatusChangeDate] = useState<string>("");
  const [statusChangeStatus, setStatusChangeStatus] = useState<string>("");
  const hasDateFilter = useMemo(() => mod.fields.some((f) => f.name === "entry_date"), [mod]);
  // স্টাটাস → যে তারিখ কলামে ঐ স্টাটাস পরিবর্তন রেকর্ড হয় তার ম্যাপ (BMET)
  const statusDateColMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {
      "NEW": "entry_date",
      "File Process": "vendor_sent_date",
      "Pending Delivery": "received_date",
      "Delivery But Due": "delivery_date",
      "Delivered": "delivery_date",
    };
    // শুধু সেইসব স্টাটাস রাখি যাদের তারিখ কলাম এই মডিউলে আছে
    const fieldNames = new Set(mod.fields.map((f) => f.name));
    const filtered: Record<string, string> = {};
    for (const [st, col] of Object.entries(map)) {
      if (fieldNames.has(col) && (mod.statuses ?? []).includes(st)) filtered[st] = col;
    }
    return filtered;
  }, [mod]);
  const supportsStatusChangeFilter = mod.key === "bmet" && Object.keys(statusDateColMap).length > 0;
  const [showGroup, setShowGroup] = useState(true);
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>(() => emptyForm(mod));
  const supportsExtra = EXTRA_SERVICE_MODULES.includes(mod.key);
  const [extraServices, setExtraServices] = useState<ExtraServiceRow[]>([]);
  const [showExtra, setShowExtra] = useState(false);
  const [extraCounts, setExtraCounts] = useState<Record<string, number>>({});
  const [extraDetails, setExtraDetails] = useState<Record<string, { service_name: string; service_price: number; vendor_cost: number; notes: string; received: number }[]>>({});
  const [saving, setSaving] = useState(false);
  
  // কাজ বাতিল / ফেরত (soft-cancel)
  const canCancel = CANCELABLE_TABLES.has(mod.table);
  const [cancelRow, setCancelRow] = useState<Row | null>(null);
  // Air Ticket uses a richer cancel + refund dialog instead of the generic one.
  const [refundRow, setRefundRow] = useState<Row | null>(null);
  const isTicketModule = mod.table === "tickets";
  const openCancelOrRefund = (r: Row) => {
    if (isTicketModule) {
      setRefundRow(r);
      return;
    }
    setCancelReason("");
    setCancelDate(todayIso());
    setCancelPw("");
    setCancelRow(r);
  };
  const [cancelReason, setCancelReason] = useState("");
  const [cancelDate, setCancelDate] = useState<string>(todayIso());
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelPw, setCancelPw] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  // Generic password-confirm request (delete / restore)
  const [pwConfirm, setPwConfirm] = useState<{
    title: string;
    description: ReactNode;
    confirmLabel: string;
    confirmClassName?: string;
    action: () => void | Promise<void>;
  } | null>(null);
  const [duePreselect, setDuePreselect] = useState<DueReceivePreselect | null>(null);
  const [extraDuePreselect, setExtraDuePreselect] = useState<ExtraDuePreselect | null>(null);
  const [statusChange, setStatusChange] = useState<StatusChangeRequest | null>(null);
  const [profileRow, setProfileRow] = useState<Row | null>(null);
  const [detailRow, setDetailRow] = useState<Row | null>(null);
  const [smartOpen, setSmartOpen] = useState(false);
  // Persistent "row I just worked on" — stays RED until another row is acted on.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Remembers list scroll position so it is restored after an action overlay closes.
  const workScrollRef = useRef(0);
  // Mark a row as "the one I am working on": remember scroll position + set the
  // persistent RED selection. Used for status change, due receive, view, edit, search.
  const selectRow = useCallback((id: string) => {
    workScrollRef.current = window.scrollY;
    setSelectedId(id);
  }, []);
  const isPartyList = mod.key === "agents" || mod.key === "vendors";
  const canShowDelete = useCallback((r: Row) => {
    if (isPartyList) return canApprove;
    const owner = r.created_by as string | null | undefined;
    return !owner || (!!user?.id && owner === user.id);
  }, [canApprove, isPartyList, user?.id]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Per-row latest receive info (method + receiver) for the Recv method badge
  const [recvInfo, setRecvInfo] = useState<Record<string, { method: string | null; received_by: string | null; received_by_name: string | null }>>({});
  // user_id → display name (for rows whose receiver isn't on a receipt)
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  // এজেন্সির নাম (normalized) → হিসাব ধরন (settle_mode). "মোটের উপর" (total)
  // এজেন্সির জন্য এই ডাটা পেইজে বিল-বাই-বিল "Due Receive" বাটন দেখানো হয় না —
  // তাদের টাকা এজেন্সি লেজারে মোট হিসাবে (Auto FIFO) গ্রহণ করা হয়।
  const [settleModeByAgency, setSettleModeByAgency] = useState<Record<string, string>>({});
  const agencyIsTotalSettle = useCallback(
    (agencyName: unknown): boolean => {
      const n = String(agencyName ?? "").trim().replace(/[\s\-_,.]+/g, " ").toLowerCase();
      if (!n || n === "self") return false;
      // শুধুমাত্র সুস্পষ্টভাবে "মোটের উপর" সেট করা এজেন্সির ক্ষেত্রে লুকানো হয়;
      // সেট না থাকা / এক-একটা-বিল এজেন্সিতে বাটন আগের মতোই থাকে।
      return settleModeByAgency[n] === "total";
    },
    [settleModeByAgency],
  );
  // এজেন্সিভিত্তিক হিসাব ধরন লোড — শুধু সার্ভিস মডিউলে (যেখানে agency_sold আছে)।
  useEffect(() => {
    if (!mod.fields.some((f) => f.name === "agency_sold")) return;
    let alive = true;
    void supabase
      .from("agents")
      .select("name,settle_mode")
      .limit(5000)
      .then(({ data }) => {
        if (!alive) return;
        const modeMap: Record<string, string> = {};
        for (const r of (data as { name?: string | null; settle_mode?: string | null }[] | null) ?? []) {
          const key = String(r.name ?? "").trim().replace(/[\s\-_,.]+/g, " ").toLowerCase();
          // সেট না থাকা এজেন্সি per-passenger (one_by_one) হিসেবেই থাকবে —
          // শুধু স্পষ্টভাবে "total" সেট করা থাকলেই মোটের হিসাব ধরা হবে।
          if (key && key !== "self") modeMap[key] = (r.settle_mode ?? "").trim();
        }
        setSettleModeByAgency(modeMap);
      });
    return () => { alive = false; };
  }, [mod]);
  const loadingRef = useRef(false);
  const reloadQueuedRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const cacheKey = `cache_v2_${mod.table}`;
  const columns = useMemo(() => selectColumns(mod), [mod]);
  const filterFields = useMemo(() => mod.fields.filter((f) => f.filterable), [mod]);
  const mobileColorForRow = useCallback((mobile: string, r?: Row) => {
    const callStatus = String(r?.call_status ?? "");
    if (callStatus === "talked") return "green";
    if (callStatus === "no_answer") return "red";
    return colorFor(mobile);
  }, [colorFor]);

  // Preserve list scroll position when the add/edit dialog opens & closes.
  const saveScroll = useScrollRestore(openForm);

  // Auto-save draft for NEW entries only (not while editing existing rows)
  const { clear: clearDraft } = useFormDraft(
    `module:${mod.key}:new`,
    form,
    setForm,
    openForm && !editing,
  );

  // Hydrate from localStorage cache instantly (offline-first)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const cached = JSON.parse(raw) as Row[];
        if (Array.isArray(cached)) {
          setRows(cached);
          setLoadError(null);
          setLoading(false);
          hasLoadedRef.current = true;
        }
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mod.table]);

  const load = useCallback(async (showSpinner = !hasLoadedRef.current): Promise<Row[]> => {
    if (loadingRef.current) {
      reloadQueuedRef.current = true;
      return [];
    }
    loadingRef.current = true;
    if (showSpinner) setLoading(true);
    let resultList: Row[] = [];
    try {
      const baseQuery = supabase.from(mod.table as never).select(columns);
      // Contact tables (agents/vendors) have no entry_date column — ordering by
      // it would throw a 400. Only transactional tables get the entry_date sort.
      const orderedQuery = hasDateFilter
        ? baseQuery.order("entry_date", { ascending: false }).order("created_at", { ascending: false })
        : baseQuery.order("created_at", { ascending: false });
      const result = await Promise.race([
        orderedQuery.limit(250),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("অনেক সময় লাগছে, আবার চেষ্টা করুন")), 6500)),
      ]);
      const { data, error } = result as { data: unknown; error: { message: string } | null };
      if (error) throw error;
      const list = ((data as unknown) as Row[]) ?? [];
      resultList = list;
      setRows(list);
      setLoadError(null);
      try { localStorage.setItem(cacheKey, JSON.stringify(list)); } catch { /* quota */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ডাটা লোড করা যায়নি";
      setLoadError(msg);
      if (!hasLoadedRef.current) toast.error("লোড করতে সমস্যা: " + msg);
    }
    loadingRef.current = false;
    hasLoadedRef.current = true;
    setLoading(false);
    if (reloadQueuedRef.current) {
      reloadQueuedRef.current = false;
      window.setTimeout(() => void load(false), 250);
    }
    return resultList;
  }, [mod.table, cacheKey, columns, hasDateFilter]);


  // Count of extra services per parent row (for the "+N" badge on the data list)
  const loadExtraCounts = useCallback(async () => {
    if (!supportsExtra) return;
    try {
      // Receipt/discount is tracked directly on the extra_services row (works for
      // both agency-billed and "Self" passengers — no ledger mirror required).
      const { data } = await supabase
        .from("extra_services" as never)
        .select("id,source_id,service_name,service_price,vendor_cost,notes,received_amount,discount_amount")
        .eq("source_table", mod.table);
      const list =
        ((data as { id: string; source_id: string; service_name: string; service_price: number; vendor_cost: number; notes: string | null; received_amount: number | null; discount_amount: number | null }[] | null) ?? []);
      const m: Record<string, number> = {};
      const d: Record<string, { service_name: string; service_price: number; vendor_cost: number; notes: string; received: number }[]> = {};
      list.forEach((r) => {
        const k = String(r.source_id);
        m[k] = (m[k] ?? 0) + 1;
        (d[k] ||= []).push({
          service_name: String(r.service_name ?? ""),
          service_price: Number(r.service_price ?? 0),
          vendor_cost: Number(r.vendor_cost ?? 0),
          notes: String(r.notes ?? ""),
          // received folds in discount so extraDue = bill - (cash + discount).
          received: Number(r.received_amount ?? 0) + Number(r.discount_amount ?? 0),
        });
      });
      setExtraCounts(m);
      setExtraDetails(d);
    } catch { /* ignore */ }
  }, [mod.table, supportsExtra]);

  // Load latest receive method/receiver per row + a user_id→name map for the Recv badge.
  // Scoped to the currently-loaded row ids so we never pull the whole receipts table.
  const profilesLoadedRef = useRef(false);
  const loadRecvInfo = useCallback(async (ids?: string[]) => {
    if (!RECV_META[mod.table]) return;
    // Nothing visible yet → skip the receipts round-trip entirely.
    if (ids && ids.length === 0) { setRecvInfo({}); return; }
    try {
      let recvQuery = supabase
        .from("payment_receipts")
        .select("service_row_id,method,source,amount,received_by,received_by_name,created_at")
        .eq("service_table", mod.table)
        .order("created_at", { ascending: true });
      if (ids && ids.length > 0) recvQuery = recvQuery.in("service_row_id", ids);
      // Profiles map rarely changes — fetch it once, then reuse.
      const [{ data: receipts }, profsRes] = await Promise.all([
        recvQuery,
        profilesLoadedRef.current
          ? Promise.resolve({ data: null })
          : supabase.from("profiles").select("user_id,full_name"),
      ]);

      const map: Record<string, { method: string | null; received_by: string | null; received_by_name: string | null }> = {};
      ((receipts as { service_row_id: string; method: string | null; source: string | null; amount: number | null; received_by: string | null; received_by_name: string | null }[] | null) ?? []).forEach((rc) => {
        const isStatus = STATUS_EVENT_SOURCES.has(String(rc.source ?? "")) || String(rc.method ?? "").toLowerCase() === "status";
        if (isStatus || Number(rc.amount ?? 0) <= 0) return;
        // ascending order → last write wins = most recent receipt
        if (rc.service_row_id) map[String(rc.service_row_id)] = { method: rc.method, received_by: rc.received_by, received_by_name: rc.received_by_name };
      });
      setRecvInfo(map);
      const profs = (profsRes as { data: { user_id: string; full_name: string | null }[] | null }).data;
      if (profs) {
        const names: Record<string, string> = {};
        profs.forEach((p) => { if (p.user_id) names[p.user_id] = String(p.full_name ?? ""); });
        setProfileNames(names);
        profilesLoadedRef.current = true;
      }
    } catch { /* ignore */ }
  }, [mod.table]);


  useEffect(() => {
    void load(true).then((list) => loadRecvInfo(list.map((r) => String((r as { id?: string }).id ?? "")).filter(Boolean)));
    void loadExtraCounts();
  }, [load, loadExtraCounts, loadRecvInfo, mod.key]);

  // Realtime: auto-refresh on any change to this table (debounced so a burst of
  // edits triggers a single reload instead of a storm of network round-trips).
  const rtId = useId();
  const rtTimerRef = useRef<number | null>(null);
  useEffect(() => {
    const scheduleReload = (withRecv: boolean) => {
      if (rtTimerRef.current) window.clearTimeout(rtTimerRef.current);
      rtTimerRef.current = window.setTimeout(() => {
        void load(false).then((list) => {
          if (withRecv) void loadRecvInfo(list.map((r) => String((r as { id?: string }).id ?? "")).filter(Boolean));
        });
      }, 600);
    };
    const ch = supabase
      .channel(`rt_${mod.table}_${rtId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: mod.table }, () => {
        scheduleReload(true);
      })
      .subscribe();
    let chx: ReturnType<typeof supabase.channel> | null = null;
    if (supportsExtra) {
      chx = supabase
        .channel(`rt_extra_${mod.table}_${rtId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "extra_services" }, () => {
          void loadExtraCounts();
        })
        .subscribe();
    }
    return () => {
      if (rtTimerRef.current) window.clearTimeout(rtTimerRef.current);
      supabase.removeChannel(ch);
      if (chx) supabase.removeChannel(chx);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mod.table]);


  const computeValue = useCallback((r: Row, name: string): number => {
    const c = mod.computed?.find((x) => x.name === name);
    if (c) return c.compute(r);
    return Number(r[name] ?? 0);
  }, [mod]);

  const cancelledCount = useMemo(
    () => (canCancel ? rows.filter((r) => r.cancelled).length : 0),
    [rows, canCancel],
  );

  const filtered = useMemo(() => {
    let xs = rows;
    if (mod.key === "agents") {
      xs = xs.filter((r) => String(r.name ?? "").trim().toLowerCase() !== "self");
    }
    // বাতিল করা এন্ট্রি চলমান তালিকায়ও দেখানো হয় (ধূসর রঙে ও বিশেষ চিহ্নসহ),
    // সার্চ করা হোক বা না হোক। শুধু "বাতিল" বাটন চাপলে কেবল বাতিল এন্ট্রি দেখা যায়।
    if (canCancel && showCancelled) {
      xs = xs.filter((r) => r.cancelled);
    }
    if (statusFilter !== "all") {
      xs = xs.filter((r) => (String(r.status ?? "") || (mod.statuses?.[0] ?? "")) === statusFilter);
    }
    for (const [name, val] of Object.entries(fieldFilters)) {
      if (val && val !== "all") xs = xs.filter((r) => String(r[name] ?? "") === val);
    }
    if (dueOnly) {
      const dueColumn = mod.computed?.some((c) => c.name === "balance") ? "balance" : "due";
      // বাতিল করা কাজ due হিসেবে গণনা হয় না, তাই "শুধু বকেয়া" তালিকায় দেখানো হবে না।
      xs = xs.filter((r) => computeValue(r, dueColumn) > 0 && !(canCancel && r.cancelled));
    }
    if (startDate) xs = xs.filter((r) => String(r.entry_date ?? "").slice(0, 10) >= startDate);
    if (endDate) xs = xs.filter((r) => String(r.entry_date ?? "").slice(0, 10) <= endDate);
    // তারিখ অনুযায়ী স্টাটাস পরিবর্তন ফিল্টার: নির্বাচিত স্টাটাসের তারিখ কলাম == নির্বাচিত তারিখ
    if (supportsStatusChangeFilter && statusChangeStatus && statusChangeDate) {
      const col = statusDateColMap[statusChangeStatus];
      if (col) {
        // একাধিক স্টাটাস একই তারিখ কলাম শেয়ার করলে (যেমন "Delivered" ও
        // "Delivery But Due" — দুটোই delivery_date) শুধু তারিখ মেলালে দুটো
        // আলাদা স্টাটাস এক হয়ে যায়। তাই কলাম শেয়ার হলে রো-এর আসল স্টাটাসও মেলাই।
        const sharesColumn =
          Object.entries(statusDateColMap).filter(([, c]) => c === col).length > 1;
        xs = xs.filter((r) => {
          if (String(r[col] ?? "").slice(0, 10) !== statusChangeDate) return false;
          if (!sharesColumn) return true;
          return (String(r.status ?? "") || (mod.statuses?.[0] ?? "")) === statusChangeStatus;
        });
      }
    }
    const q = search.trim().toLowerCase();
    if (q) {
      xs = xs.filter((r) =>
        Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q))
      );
    }
    return xs;
  }, [rows, search, statusFilter, fieldFilters, dueOnly, startDate, endDate, statusChangeDate, statusChangeStatus, supportsStatusChangeFilter, statusDateColMap, computeValue, mod.statuses, mod.key, canCancel, showCancelled]);

  // কোনো ফিল্টার/সার্চ সক্রিয় থাকলে মাস-ভিত্তিক সীমাবদ্ধতা বাদ — সব ফলাফল দেখাই।
  const filterActive = useMemo(() => {
    return (
      search.trim() !== "" ||
      statusFilter !== "all" ||
      Object.values(fieldFilters).some((v) => v && v !== "all") ||
      dueOnly ||
      startDate !== "" ||
      endDate !== "" ||
      (!!statusChangeStatus && !!statusChangeDate) ||
      (canCancel && showCancelled)
    );
  }, [search, statusFilter, fieldFilters, dueOnly, startDate, endDate, statusChangeStatus, statusChangeDate, canCancel, showCancelled]);

  const monthPagingOn = !!mod.paginateByMonth && !filterActive;

  // মাস-ভিত্তিক পেজিং: filtered রো থেকে distinct মাস (YYYY-MM) বের করে সর্বশেষ আগে সাজাই।
  const monthKeys = useMemo(() => {
    if (!monthPagingOn) return [] as string[];
    const set = new Set<string>();
    for (const r of filtered) {
      const k = String(r.entry_date ?? "").slice(0, 7);
      if (k) set.add(k);
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }, [filtered, monthPagingOn]);

  // ফিল্টার বদলালে বা মাস তালিকা বদলালে সূচক সীমার মধ্যে রাখি (সর্বশেষ মাসে ফিরি)।
  useEffect(() => {
    if (monthPagingOn && monthIndex > Math.max(0, monthKeys.length - 1)) {
      setMonthIndex(0);
    }
  }, [monthKeys.length, monthIndex, monthPagingOn]);

  const curMonthKey = monthPagingOn ? monthKeys[monthIndex] : undefined;
  const pageRows = useMemo(() => {
    if (!monthPagingOn || !curMonthKey) return filtered;
    return filtered.filter((r) => String(r.entry_date ?? "").slice(0, 7) === curMonthKey);
  }, [filtered, monthPagingOn, curMonthKey]);

  const monthPager = monthPagingOn && monthKeys.length > 0 ? (
    <div className="flex items-center justify-center gap-2 flex-wrap">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        disabled={monthIndex >= monthKeys.length - 1}
        onClick={() => setMonthIndex((i) => Math.min(monthKeys.length - 1, i + 1))}
      >
        <ChevronLeft className="h-4 w-4" /> পূর্ববর্তী মাস
      </Button>
      <span className="text-sm font-medium px-2 whitespace-nowrap">
        {formatMonthLabel(curMonthKey!)}
        <span className="text-muted-foreground font-normal"> ({monthIndex + 1}/{monthKeys.length})</span>
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        disabled={monthIndex <= 0}
        onClick={() => setMonthIndex((i) => Math.max(0, i - 1))}
      >
        পরবর্তী মাস <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  ) : null;




  const summary = useMemo(() => {
    if (!mod.summaryFields) return null;
    return mod.summaryFields.map((s) => ({
      label: s.label,
      name: s.name,
      total: filtered.reduce((sum, r) => sum + computeValue(r, s.name), 0),
    }));
  }, [filtered, mod.summaryFields, computeValue]);

  const groupSummary = useMemo(() => {
    if (!mod.groupBy) return null;
    const map = new Map<string, Record<string, number>>();
    for (const r of filtered) {
      const k = String(r[mod.groupBy.field] ?? "—") || "—";
      const cur = map.get(k) ?? {};
      for (const m of mod.groupBy.metrics) cur[m.name] = (cur[m.name] ?? 0) + computeValue(r, m.name);
      map.set(k, cur);
    }
    return Array.from(map.entries())
      .map(([key, vals]) => ({ key, vals }))
      .sort((a, b) => (b.vals.balance ?? 0) - (a.vals.balance ?? 0));
  }, [filtered, mod.groupBy, computeValue]);

  const startCreate = () => {
    saveScroll();
    setEditing(null);
    setExtraServices([]);
    setShowExtra(false);
    const f = emptyForm(mod);
    // Auto-fill "Entry By" with current user's name
    if (mod.fields.some((fld) => fld.name === "entry_by")) {
      f.entry_by = displayName(profile, user);
    }
    setForm(f);
    setOpenForm(true);
  };

  const startEdit = (r: Row) => {
    saveScroll();
    setEditing(r);
    setExtraServices([]);
    setShowExtra(false);
    const f: Record<string, unknown> = {};
    for (const field of mod.fields) f[field.name] = r[field.name] ?? (field.type === "number" ? 0 : "");
    if (mod.fields.some((fld) => fld.name === "entry_by") && (!f.entry_by || f.entry_by === "User")) {
      f.entry_by = displayName(profile, user);
    }
    if (RECV_META[mod.table]) {
      f.payment_method = String((r as Record<string, unknown>).payment_method || "Cash");
    }
    setForm(f);
    setOpenForm(true);
    if (supportsExtra) {
      void supabase
        .from("extra_services" as never)
        .select("id,service_name,service_price,vendor_cost,received_amount,notes")
        .eq("source_table", mod.table)
        .eq("source_id", r.id)
        .order("created_at", { ascending: true })
        .then(({ data }) => {
          const rows = ((data as ExtraServiceRow[] | null) ?? []).map((x) => ({
            id: x.id,
            service_name: String(x.service_name ?? ""),
            service_price: Number(x.service_price ?? 0),
            received_amount: Number(x.received_amount ?? 0),
            vendor_cost: Number(x.vendor_cost ?? 0),
            notes: String(x.notes ?? ""),
          }));
          setExtraServices(rows);
          setShowExtra(rows.length > 0);
        });
    }
  };


  // Persist the form's extra services against a saved parent row. Inserts new
  // rows, updates kept ones, deletes removed ones. Denormalizes the parent's
  // vendor/agency/passenger so the DB trigger can mirror into the ledgers.
  const syncExtraServices = useCallback(async (parentId: string, parent: Record<string, unknown>) => {
    if (!supportsExtra) return;
    const base = {
      source_table: mod.table,
      source_id: parentId,
      entry_date: (parent.entry_date as string) || todayIso(),
      vendor_name: (parent.vendor_bought as string) || null,
      agency_sold: (parent.agency_sold as string) || null,
      passenger_name: (parent.passenger_name as string) || null,
      passport: (parent.passport as string) || null,
      mobile: (parent.mobile as string) || null,
      created_by: user?.id ?? null,
    };
    const { data: existing } = await supabase
      .from("extra_services" as never)
      .select("id")
      .eq("source_table", mod.table)
      .eq("source_id", parentId);
    const existingIds = new Set(((existing as { id: string }[] | null) ?? []).map((x) => x.id));
    const keepIds = new Set<string>();
    for (const ex of extraServices) {
      const name = (ex.service_name || "").trim();
      if (!name) continue;
      const row = {
        ...base,
        service_name: name,
        service_price: Number(ex.service_price) || 0,
        received_amount: Number(ex.received_amount) || 0,
        vendor_cost: Number(ex.vendor_cost) || 0,
        notes: (ex.notes || "").trim() || null,
      };
      if (ex.id && existingIds.has(ex.id)) {
        keepIds.add(ex.id);
        // `received_amount` is owned exclusively by ExtraDueReceiveDialog and
        // `created_by` defines delete-ownership — never overwrite them on a
        // parent edit, or (a) payments collected after the form was opened get
        // silently reverted and (b) the row's owner changes. Only the editable
        // descriptive/price fields are updated here.
        const { received_amount: _omitReceived, created_by: _omitCreator, ...updatable } = row;
        await supabase.from("extra_services" as never).update(updatable as never).eq("id", ex.id);
      } else {
        await supabase.from("extra_services" as never).insert(row as never);
      }
    }
    const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
    if (toDelete.length) {
      await supabase.from("extra_services" as never).delete().in("id", toDelete);
    }
  }, [supportsExtra, mod.table, extraServices, user?.id]);

  const submit = async () => {

    if (saving) return; // Prevent double-submit
    // Required-field validation (works even if the user bypasses HTML required)
    for (const f of mod.fields) {
      if (!f.required || f.hideInForm) continue;
      const v = form[f.name];
      const empty =
        f.type === "number"
          ? v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) || Number(v) <= 0
          : v === undefined || v === null || (typeof v === "string" && !v.trim());
      if (empty) {
        toast.error(`${f.label} আবশ্যক`);
        return;
      }
    }
    // Capture edit state at submit-time so re-renders can't lose the ID
    const editRow = editing;
    const editId = editRow?.id;
    const isEdit = !!editId;
    setSaving(true);
    try {
      // Build payload, coerce types, drop empty optional dates.
      const payload: Record<string, unknown> = {};
      const hasField = (n: string) => mod.fields.some((f) => f.name === n);
      for (const field of mod.fields) {
        const v = form[field.name];
        if (field.type === "number") payload[field.name] = Number(v) || 0;
        else if (field.type === "boolean") payload[field.name] = Boolean(v);
        else if (field.type === "date") payload[field.name] = v ? v : null;
        else payload[field.name] = v ?? null;
      }
      if (hasField("status") && mod.statuses?.length && !payload.status) {
        payload.status = mod.statuses[0];
      }

      const me = displayName(profile, user);
      const recvCols = ["received", "received_amount", "paid_amount"];
      const recvAmount = recvCols.reduce((sum, c) => sum + Number((payload as Record<string, unknown>)[c] ?? 0), 0);

      if (user?.id) {
        if (!isEdit) (payload as Record<string, unknown>).created_by = user.id;
        // received_by ("কে টাকা নিয়েছিল") শুধু নতুন এন্ট্রিতে সেট হবে। এডিটে received
        // ফিল্ড locked থাকে (টাকা বদলায় না), তাই পুরনো collector-কে ওভাররাইট করা যাবে না —
        // নইলে নাম/তারিখ ঠিক করলেও audit-trail নষ্ট হতো।
        if (recvAmount > 0 && !isEdit) (payload as Record<string, unknown>).received_by = user.id;
      }
      // এন্ট্রিতে টাকা গৃহীত হলে চয়ন করা মাধ্যম সংরক্ষণ — এটি থেকে DB trigger
      // (sync_service_receipt) receipt-এর method ঠিক করবে (Cash=স্টাফ, বাকি=MD)।
      if (RECV_META[mod.table] && recvAmount > 0) {
        (payload as Record<string, unknown>).payment_method =
          String(form.payment_method || "Cash");
      }
      // Auto-capture payment date when money is received but none was entered,
      // so it always shows in the edit form and view page.
      if (hasField("payment_date") && recvAmount > 0 && !payload.payment_date) {
        (payload as Record<string, unknown>).payment_date =
          (payload.entry_date as string) || todayIso();
      }
      if (hasField("entry_by") && (!payload.entry_by || payload.entry_by === "User")) (payload as Record<string, unknown>).entry_by = me;

      if (mod.deriveStatus && hasField("status")) {
        const derived = mod.deriveStatus(payload);
        if (derived !== undefined) (payload as Record<string, unknown>).status = derived;
      }

      const isPartyModule = mod.table === "agents" || mod.table === "vendors";
      // Only generate a fresh ID for NEW rows. Party IDs are assigned by the
      // database trigger so serial_no + visible code can never drift apart.
      const entryDateForId = typeof payload.entry_date === "string" ? (payload.entry_date as string) : undefined;
      let finalId = !isEdit && !isPartyModule ? await generateNextId(mod, entryDateForId) : undefined;
      if (finalId) (payload as Record<string, unknown>)[mod.idColumn] = finalId;

      // --- Edit-form status automation (mirror of the Status badge drawer) ---
      // Changing the status from the Edit form now auto-stamps the workflow
      // dates and creates/removes the vendor ledger entry the same way the
      // status badge does, so the vendor accounting stays in sync.
      let edLedgerForward = false;
      let edLedgerBackward = false;
      if (isEdit && hasField("status")) {
        const eqs = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
        const order = mod.statuses ?? [];
        const idxOf = (s: string) => order.findIndex((x) => eqs(x, s));
        const prevS = String(editRow?.status ?? "") || (order[0] ?? "");
        const newS = String((payload as Record<string, unknown>).status ?? "") || (order[0] ?? "");
        const curIdx = idxOf(prevS);
        const tgtIdx = idxOf(newS);
        const direction = tgtIdx > curIdx ? "forward" : tgtIdx < curIdx ? "backward" : "same";
        const pdIdx = idxOf("Pending Delivery");
        const issueIdx = order.findIndex((x) => eqs(x, "ISSUE"));
        const dlIdx = order.findIndex((x) => eqs(x, "Delivered") || eqs(x, "Delivery"));
        const ledgerIdx = pdIdx >= 0 ? pdIdx : issueIdx >= 0 ? issueIdx : dlIdx;
        const fpIdx = idxOf("File Process");

        if (direction === "forward") {
          if (fpIdx >= 0 && curIdx < fpIdx && tgtIdx >= fpIdx && hasField("vendor_sent_date") && !payload.vendor_sent_date) {
            (payload as Record<string, unknown>).vendor_sent_date = todayIso();
          }
          if (pdIdx >= 0 && curIdx < pdIdx && tgtIdx >= pdIdx && hasField("received_date") && !payload.received_date) {
            (payload as Record<string, unknown>).received_date = todayIso();
          }
          if (dlIdx >= 0 && curIdx < dlIdx && tgtIdx >= dlIdx && hasField("delivery_date") && !payload.delivery_date) {
            (payload as Record<string, unknown>).delivery_date = todayIso();
          }
          if (ledgerIdx >= 0 && curIdx < ledgerIdx && tgtIdx >= ledgerIdx) edLedgerForward = true;
        } else if (direction === "backward") {
          if (fpIdx >= 0 && tgtIdx < fpIdx && hasField("vendor_sent_date")) (payload as Record<string, unknown>).vendor_sent_date = null;
          if (pdIdx >= 0 && tgtIdx < pdIdx && hasField("received_date")) (payload as Record<string, unknown>).received_date = null;
          if (dlIdx >= 0 && tgtIdx < dlIdx && hasField("delivery_date")) (payload as Record<string, unknown>).delivery_date = null;
          if (ledgerIdx >= 0 && curIdx >= ledgerIdx && tgtIdx < ledgerIdx) edLedgerBackward = true;
        }
      }

      if (isEdit && editId) {
        // STRICT EDIT PATH: UPDATE only — never insert a new row.
        // Make sure no stray id column is in the payload that would target a different row.
        delete (payload as Record<string, unknown>).id;
        const { error } = await supabase
          .from(mod.table as never)
          .update(payload as never)
          .eq("id", editId);
        if (error) throw error;
        // Mirror the status-badge automation: create/remove the vendor ledger
        // entry when the Edit form moved the status across the ledger checkpoint.
        if (edLedgerForward || edLedgerBackward) {
          try {
            const vendorName = String((payload as Record<string, unknown>).vendor_bought ?? editRow?.vendor_bought ?? "").trim();
            const costPrice = Number((payload as Record<string, unknown>).cost_price ?? editRow?.cost_price ?? 0);
            if (edLedgerForward && vendorName && costPrice > 0 && mod.key !== "other") {
              const { data: existing } = await supabase
                .from("vendor_ledger").select("id")
                .eq("source_table", mod.table).eq("source_id", editId).limit(1);
              if (!existing || existing.length === 0) {
                let ledgerId: string;
                try {
                  ledgerId = await generateNextId({ key: "_vdl", label: "", short: "", table: "vendor_ledger", idColumn: "ledger_id", idPrefix: "VDL", monthlyId: true, fields: [] } as unknown as ModuleSchema);
                } catch {
                  const d = new Date();
                  ledgerId = `VDL-${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getFullYear()).slice(-2)}-OFFLINE-${Date.now().toString().slice(-6)}`;
                }
                const meta = RECV_META[mod.table] ?? { recvCol: "received", serviceType: mod.label };
                const pname = String((payload as Record<string, unknown>).passenger_name ?? editRow?.passenger_name ?? "");
                const passport = String((payload as Record<string, unknown>).passport ?? editRow?.passport ?? "");
                await resilientInsert("vendor_ledger", {
                  ledger_id: ledgerId, entry_date: todayIso(),
                  vendor_name: vendorName, passenger_name: pname,
                  passport: passport || null,
                  mobile: String((payload as Record<string, unknown>).mobile ?? editRow?.mobile ?? "") || null,
                  service_type: meta.serviceType,
                  country_route: String((payload as Record<string, unknown>).country_name ?? (payload as Record<string, unknown>).country_route ?? editRow?.country_name ?? editRow?.country_route ?? "") || null,
                  total_payable: costPrice, paid_amount: 0, advance_applied: 0,
                  payment_method: "Cash", source_table: mod.table, source_id: editId,
                  remarks: `Cost for ${pname}${passport ? ` - ${passport}` : ""} (Received on ${todayIso()})`,
                  created_by: user?.id ?? null,
                });
              }
            } else if (edLedgerBackward) {
              await supabase.rpc("delete_vendor_ledger_by_source", { _source_table: mod.table, _source_id: editId });
            }
          } catch { /* vendor ledger best-effort */ }
        }
        if (supportsExtra) {
          try { await syncExtraServices(editId, payload); } catch { /* extra services best-effort */ }
        }
        setOpenForm(false);
        setEditing(null);
        toast.success("আপডেট হয়েছে");
        const prevStatus = String(editRow?.status ?? "");
        const newStatus = String((payload as Record<string, unknown>).status ?? "");
        if (newStatus && newStatus !== prevStatus && /deliver/i.test(newStatus)) {
          speakDelivery(String((payload as Record<string, unknown>).passenger_name ?? ""));
        }
        if (recvAmount > 0 && Number(editRow?.received ?? editRow?.received_amount ?? editRow?.paid_amount ?? 0) !== recvAmount) {
          speakReceived(recvAmount);
        }
      } else {
        // INSERT PATH: only when no editing id was captured.
        const hasExtra = supportsExtra && extraServices.some((x) => (x.service_name || "").trim());
        if (isPartyModule) {
          const { data: inserted, error } = await supabase
            .from(mod.table as never)
            .insert(payload as never)
            .select(`id,${mod.idColumn},serial_no`)
            .single();
          if (error) throw error;
          const row = inserted as Record<string, unknown> | null;
          finalId = String(row?.[mod.idColumn] ?? partySerialLabel(mod.table === "agents" ? "agent" : "vendor", row?.serial_no));
          setOpenForm(false);
          toast.success(`✓ যোগ হয়েছে: ${finalId}`);
          clearDraft();
        } else if (hasExtra) {
          // Direct insert so we can capture the new row id and attach extra services.
          const { data: inserted, error } = await supabase
            .from(mod.table as never)
            .insert(payload as never)
            .select("id")
            .single();
          if (error) throw error;
          const newId = (inserted as { id: string } | null)?.id;
          if (newId) {
            try { await syncExtraServices(newId, payload); } catch { /* best-effort */ }
          }
          setOpenForm(false);
          toast.success(`✓ যোগ হয়েছে: ${finalId}`);
          speakModuleEntry(mod.key);
          if (recvAmount > 0) speakReceived(recvAmount);
          clearDraft();
        } else {
          const { offline } = await resilientInsert(mod.table, payload as Record<string, unknown>);
          setOpenForm(false);
          if (!offline) {
            toast.success(`✓ যোগ হয়েছে: ${finalId}`);
            speakModuleEntry(mod.key);
            if (recvAmount > 0) speakReceived(recvAmount);
          }
          clearDraft();
        }
      }
      void load();
      void loadExtraCounts();

    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      const msg = String(err?.message ?? "");
      if (err?.code === "23505" && /passport.*entry_date|entry_date.*passport|uniq_.*_passport_date/i.test(msg)) {
        toast.error("⛔ ডুপ্লিকেট এন্ট্রি! এই পাসপোর্টের জন্য আজকের তারিখে এই সার্ভিস ইতিমধ্যে বুক করা আছে।", { duration: 6000 });
      } else if (err?.code === "23505" && /(agents|vendors)_name_unique/i.test(msg)) {
        toast.error("⛔ এই নামে ইতিমধ্যে একটি এন্ট্রি আছে। একই নামে দুটি তৈরি করা যাবে না — আগের এন্ট্রিটি এডিট করুন।", { duration: 6000 });
      } else {
        toast.error("সমস্যা: " + errMsg(e));
      }

    } finally {
      setSaving(false);
    }
  };



  // কাজ বাতিল হিসেবে চিহ্নিত করা — এন্ট্রি ডিলেট না করে রেকর্ড সংরক্ষণ করে।
  // বাতিল কনফার্ম করতে অবশ্যই user-এর পাসওয়ার্ড দিতে হবে।
  const confirmCancel = async () => {
    if (!cancelRow) return;
    if (!cancelPw.trim()) { toast.error("নিশ্চিত করতে পাসওয়ার্ড দিন"); return; }
    setCancelBusy(true);
    try {
      const ok = await verifyCurrentPassword(user?.email ?? "", cancelPw);
      if (!ok) { toast.error("ভুল পাসওয়ার্ড"); return; }
      const { error } = await supabase
        .from(mod.table as never)
        .update({
          cancelled: true,
          cancel_reason: cancelReason.trim() || null,
          cancel_date: cancelDate || todayIso(),
        } as never)
        .eq("id", cancelRow.id);
      if (error) throw error;
      toast.success(`বাতিল হয়েছে: ${String(cancelRow[mod.idColumn] ?? "")}`);
      setCancelRow(null);
      setCancelReason("");
      setCancelDate(todayIso());
      setCancelPw("");
      await load(false);
    } catch (e) {
      toast.error("বাতিল করা যায়নি: " + errMsg(e));
    } finally {
      setCancelBusy(false);
    }
  };

  // বাতিল ফিরিয়ে আনা — আবার চলমান কাজে যুক্ত হবে। (পাসওয়ার্ড লাগবে)
  const restoreRow = async (r: Row) => {
    try {
      // Air Ticket: also reset the refund figures and remove any refund side-entries.
      const restorePatch: Record<string, unknown> = { cancelled: false, cancel_reason: null, cancel_date: null };
      if (isTicketModule) {
        restorePatch.vendor_refund = 0;
        restorePatch.vendor_refund_fee = 0;
        restorePatch.passenger_refund = 0;
        restorePatch.passenger_refund_mode = "cash";
        restorePatch.office_refund_fee = 0;
      }
      const { error } = await supabase
        .from(mod.table as never)
        .update(restorePatch as never)
        .eq("id", r.id);
      if (error) throw error;
      if (isTicketModule) {
        await supabase
          .from("agency_ledger" as never)
          .delete()
          .eq("source_table", "ticket_refund_advance")
          .eq("source_id", r.id);
        await supabase
          .from("cash_expenses" as never)
          .delete()
          .eq("linked_source_table", "ticket_refund")
          .eq("linked_source_id", r.id);
      }
      toast.success(`ফিরিয়ে আনা হয়েছে: ${String(r[mod.idColumn] ?? "")}`);
      await load(false);
    } catch (e) {
      toast.error("ফিরিয়ে আনা যায়নি: " + errMsg(e));
    }
  };

  // পাসওয়ার্ড দিয়ে নিশ্চিত করে বাতিল ফিরিয়ে আনা।
  const requestRestore = (r: Row) => {
    setPwConfirm({
      title: "বাতিল ফিরিয়ে আনবেন?",
      description: `${String(r.passenger_name ?? "")} (${String(r[mod.idColumn] ?? "")}) আবার চলমান কাজে যুক্ত হবে।`,
      confirmLabel: "ফিরিয়ে আনুন",
      confirmClassName: "bg-emerald-600 hover:bg-emerald-700 text-white",
      action: () => restoreRow(r),
    });
  };

  // পাসওয়ার্ড দিয়ে নিশ্চিত করে ডিলিট করা।
  const requestDelete = (r: Row) => {
    setPwConfirm({
      title: "ডিলিট নিশ্চিত করুন?",
      description: `এই এন্ট্রিটি (${String(r[mod.idColumn] ?? "")}) স্থায়ীভাবে মুছে যাবে এবং সংশ্লিষ্ট সকল হিসাব থেকেও সরে যাবে।`,
      confirmLabel: "ডিলিট করুন",
      confirmClassName: "bg-rose-600 hover:bg-rose-700 text-white",
      action: async () => {
        const { error } = await supabase.from(mod.table as never).delete().eq("id", r.id);
        if (error) toast.error("ডিলিট করতে সমস্যা: " + error.message);
        else { toast.success("ডিলিট হয়েছে"); await load(); }
      },
    });
  };




  // Inline status change from the table badge dropdown.
  // Handles vendor prompt for "File Process", auto-dates for "Pending Delivery",
  // and routes through Due Receive when "Delivered" with outstanding balance.
  const applyStatusChange = useCallback(async (row: Row, newStatus: string, extra?: Record<string, unknown>) => {
    const hasField = (n: string) => mod.fields.some((f) => f.name === n);
    const currentStatus = String(row.status ?? "");
    if (currentStatus === newStatus && !extra) return;

    // CASE C: Delivered with outstanding due → open Due Receive modal
    if (newStatus === "Delivered") {
      const dueColumn = mod.computed?.some((c) => c.name === "balance") ? "balance" : "due";
      const due = computeValue(row, dueColumn);
      const svc = DUE_SERVICE_KEY[mod.key];
      if (due > 0 && svc && !agencyIsTotalSettle(row.agency_sold)) {
        setDuePreselect({ serviceKey: svc, rowId: row.id });
        return;
      }
    }

    const payload: Record<string, unknown> = { status: newStatus, ...extra };
    // Track who last changed the status (service tables only)
    if (RECV_META[mod.table]) payload.status_by = displayName(profile, user);

    // CASE A: File Process → vendor + vendor_sent_date
    if (newStatus === "File Process" && hasField("vendor_sent_date")) {
      payload.vendor_sent_date = todayIso();
    }
    // CASE B: Pending Delivery → received_date
    if (newStatus === "Pending Delivery" && hasField("received_date")) {
      payload.received_date = todayIso();
    }
    // Delivered (no due) → delivery_date
    if (newStatus === "Delivered" && hasField("delivery_date") && !row.delivery_date) {
      payload.delivery_date = todayIso();
    }
    // নিরাপত্তা: সরাসরি "Delivered" দিলেও যদি বকেয়া থেকে যায় এবং মডিউলে
    // "Delivery But Due" স্ট্যাটাস থাকে, তবে সেটিই লেখা হবে — দুটো এক হবে না।
    if (newStatus === "Delivered" && (mod.statuses ?? []).includes("Delivery But Due")) {
      const dueCol = mod.computed?.some((c) => c.name === "balance") ? "balance" : "due";
      if (computeValue(row, dueCol) > 0) payload.status = "Delivery But Due";
    }


    try {
      const { error } = await supabase
        .from(mod.table as never)
        .update(payload as never)
        .eq("id", row.id);
      if (error) throw error;
      {
        const _refId = String(row[mod.idColumn] ?? "");
        toast.success(`Status: ${newStatus}${_refId ? `-${_refId}` : ""}`, {
          meta: {
            passenger: String(row.passenger_name ?? "") || undefined,
            country: String(row.country_name ?? row.country_route ?? "") || undefined,
            vendor: String(row.vendor_bought ?? "") || undefined,
          },
        } as Parameters<typeof toast.success>[1]);
      }
      if (newStatus === "Delivered") speakDelivery(String(row.passenger_name ?? ""));
      void load(false);
    } catch (e) {
      toast.error("Status আপডেট করা যায়নি: " + errMsg(e));
    }
  }, [mod, computeValue, load, profile, user, agencyIsTotalSettle]);

  const handleStatusSelect = useCallback((row: Row, newStatus: string, anchorEl?: HTMLElement | null) => {
    selectRow(row.id);
    const hasField = (n: string) => mod.fields.some((f) => f.name === n);
    const meta = RECV_META[mod.table] ?? { recvCol: "received", serviceType: mod.label };
    // Auto-advance: if clicked badge is current status, preselect the NEXT one in order
    const order = mod.statuses ?? [];
    const currentStatus = String(row.status ?? "") || (order[0] ?? "");
    let target = newStatus;
    if (order.length > 0 && newStatus.trim().toLowerCase() === currentStatus.trim().toLowerCase()) {
      const idx = order.findIndex((s) => s.trim().toLowerCase() === currentStatus.trim().toLowerCase());
      if (idx >= 0 && idx < order.length - 1) target = order[idx + 1];
    }
    setStatusChange({
      row,
      newStatus: target,
      table: mod.table,
      recvCol: meta.recvCol,
      serviceType: meta.serviceType,
      refId: String(row[mod.idColumn] ?? ""),
      hasVendorField: hasField("vendor_bought") && mod.key !== "other",
      hasVendorSentDate: hasField("vendor_sent_date"),
      hasReceivedDate: hasField("received_date"),
      hasDeliveryDate: hasField("delivery_date"),
      statusOrder: mod.statuses,
      moduleKey: mod.key,
      anchorEl: anchorEl ?? null,
      // "মোটের উপর" এজেন্সির যাত্রী হলে ডেলিভারির সাথে পেমেন্টের সম্পর্ক থাকবে না।
      agencyTotalSettle: agencyIsTotalSettle(row.agency_sold),
    });
  }, [mod, selectRow, agencyIsTotalSettle]);


  const startGroupPayment = (groupKey: string, dueAmount: number) => {
    if (!mod.groupBy) return;
    setEditing(null);
    const f = emptyForm(mod);
    f[mod.groupBy.field] = groupKey;
    // payment column varies by ledger
    if (mod.fields.some((x) => x.name === "paid_amount")) f.paid_amount = dueAmount;
    if (mod.fields.some((x) => x.name === "received_amount")) f.received_amount = dueAmount;
    if (mod.fields.some((fld) => fld.name === "entry_by")) f.entry_by = displayName(profile, user);
    setForm(f);
    setOpenForm(true);
  };

  // Build the ordered list-column descriptors. Honors mod.listOrder if present;
  // accepts both field names and computed-column names so we can interleave Due/Profit.
  type ListCol =
    | { kind: "field"; field: Field }
    | { kind: "computed"; comp: NonNullable<ModuleSchema["computed"]>[number] };
  const listCols: ListCol[] = useMemo(() => {
    if (mod.listOrder && mod.listOrder.length) {
      const out: ListCol[] = [];
      for (const name of mod.listOrder) {
        const f = mod.fields.find((x) => x.name === name);
        if (f) { out.push({ kind: "field", field: f }); continue; }
        const c = mod.computed?.find((x) => x.name === name);
        if (c) out.push({ kind: "computed", comp: c });
      }
      return out;
    }
    const fs: ListCol[] = mod.fields.filter((f) => f.showInList).map((field) => ({ kind: "field" as const, field }));
    const cs: ListCol[] = (mod.computed ?? []).map((comp) => ({ kind: "computed" as const, comp }));
    return [...fs, ...cs];
  }, [mod]);

  // Stacked-row mode: condense many columns into a few "primary + secondary lines" cells.
  type StackedCol = { key: string; header: string; align?: "right"; className?: string; render: (r: Row) => React.ReactNode };
  const stackedCols: StackedCol[] | null = useMemo(() => {
    const fmt = (n: unknown) => Number(n ?? 0).toLocaleString();
    // For tickets in BOOK status: cost/vendor are pre-filled but should not
    // surface anywhere (no vendor ledger, no profit, no cost display).
    const isTicketBook = (r: Row) =>
      mod.key === "tickets" && String(r.status ?? "").toUpperCase() === "BOOK";
    const money = (r: Row, recvField: string) => {
      const sold = Number(r.sold_price ?? 0);
      const recv = Number(r[recvField] ?? 0);
      const discount = Number(r.discount_amount ?? 0);
      const cost = isTicketBook(r) ? 0 : Number(r.cost_price ?? 0);
      // Extra services billed to the passenger (service_price) and payable to the
      // vendor (vendor_cost). Each extra is also a SEPARATE customer-ledger entry,
      // so it has its own received amount and its own due. We fold the figures into
      // the row's totals so the passenger's FULL account is clear at a glance.
      const ex = extraDetails[r.id] ?? [];
      const extraSold = ex.reduce((s, d) => s + (Number(d.service_price) || 0), 0);
      const extraCost = ex.reduce((s, d) => s + (Number(d.vendor_cost) || 0), 0);
      const extraReceived = ex.reduce((s, d) => s + (Number(d.received) || 0), 0);
      const extraDue = Math.max(0, extraSold - extraReceived);
      const totalSold = sold + extraSold;
      const totalCost = cost + extraCost;
      const totalRecv = recv + extraReceived;
      // Service-row due drives the Due Receive button (it receives into the service
      // row). The extra-service due is received separately via the customer ledger,
      // so it is surfaced as its own clearly-labelled line.
      const due = Math.max(0, sold - recv - discount);
      const profit = totalSold - discount - totalCost;
      return { sold, recv, discount, cost, due, profit, extraSold, extraCost, extraReceived, extraDue, totalSold, totalCost, totalRecv };
    };
    const subLine = (label: string, val: React.ReactNode, copyValue?: string) => (
      <div className="text-xs text-muted-foreground leading-tight">
        <span className="opacity-60">{label}:</span> {val}
        {copyValue ? <CopyInlineButton value={copyValue} /> : null}
      </div>
    );
    // Combined copy value for the passenger name: "name - passport - mobile".
    const nameCopyValue = (r: Row) =>
      [r.passenger_name, r.passport, r.mobile]
        .map((v) => (v == null ? "" : String(v).trim()))
        .filter(Boolean)
        .join(" - ");
    // Copy button shown to the LEFT of the passenger name.
    const nameCopyBtn = (r: Row) => (
      <CopyInlineButton value={nameCopyValue(r)} className="!ml-0 mr-1" />
    );
    // "+N" badge shown next to passenger name when extra services exist for the row.
    const extraBadge = (r: Row) => {
      const n = extraCounts[r.id] ?? 0;
      if (!n) return null;
      const details = extraDetails[r.id] ?? [];
      const tip = details.length
        ? details.map((d) => {
            const due = Math.max(0, (Number(d.service_price) || 0) - (Number(d.received) || 0));
            return `${d.service_name || "Service"} — Bill ৳${(d.service_price || 0).toLocaleString()}${d.vendor_cost ? ` / Vendor ৳${(d.vendor_cost || 0).toLocaleString()}` : ""} · ${due > 0 ? `Due ৳${due.toLocaleString()}` : "পরিশোধিত"}${d.notes ? ` (${d.notes})` : ""}`;
          }).join("\n")
        : `${n} Extra Service`;
      return (
        <Badge
          variant="outline"
          className="ml-1 align-middle bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/30 px-1.5 py-0 text-[10px]"
          title={tip}
        >
          +{n}
        </Badge>
      );
    };

    // Notes from extra services for a row — shown as a small line in the data list.
    const extraNotesLine = (r: Row) => {
      const notes = (extraDetails[r.id] ?? []).map((d) => d.notes.trim()).filter(Boolean);
      if (!notes.length) return null;
      return (
        <div className="text-xs text-fuchsia-600 dark:text-fuchsia-400 leading-tight mt-0.5 break-words">
          📝 {notes.join(" · ")}
        </div>
      );
    };

    // (Extra-service passenger bill is now folded into the unified amount cell.)
    // Extra-service vendor cost surfaced in the Agency / Vendor column (vendor side).
    const extraCostLine = (r: Row) => {
      const ex = (extraDetails[r.id] ?? []).filter((d) => Number(d.vendor_cost) > 0);
      if (!ex.length) return null;
      return (
        <div className="mt-0.5 space-y-0.5" title="Extra service — vendor ledger-এ যুক্ত">
          {ex.map((d, idx) => (
            <div key={`${r.id}-extra-cost-${idx}`} className="text-[11px] text-fuchsia-600 dark:text-fuchsia-400">
              ✨ {d.service_name || "Extra Service"}: +৳{fmt(Number(d.vendor_cost) || 0)}
            </div>
          ))}
        </div>
      );
    };

    // Mobile sub-line with per-number color tag applied.
    const mobileSub = (mobile: string, r?: Row) => (
      <div className="text-xs leading-tight">
        <span className="opacity-60 text-muted-foreground">📱:</span>{" "}
        <span className={mobileColorTextClass(mobileColorForRow(mobile, r)) || "text-muted-foreground"}>{mobile}</span>
        <CopyInlineButton value={mobile} />
      </div>
    );
    // Single unified badge — click opens the right-side confirmation drawer.
    // The drawer owns the status dropdown + automation (vendor prompt, dates, due modal).
    const statusOrDeliveryBadge = (r: Row, due?: number) => {
      const status = String(r.status ?? "") || (mod.statuses?.[0] ?? "");
      // বাতিল করা এন্ট্রি — স্ট্যাটাসের বদলে স্পষ্ট লাল ব্যাজ দেখাই।
      if (canCancel && r.cancelled) {
        const reason = String(r.cancel_reason ?? "").trim();
        const cdate = r.cancel_date ? formatDate(r.cancel_date as string) : "";
        return (
          <div className="mt-1">
            <Badge
              variant="outline"
              className="bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/40"
              title={[reason && `কারণ: ${reason}`, cdate && `তারিখ: ${cdate}`].filter(Boolean).join("\n") || "কাজ বাতিল"}
            >
              ❌ বাতিল{cdate ? ` · ${cdate}` : ""}
            </Badge>
          </div>
        );
      }
      const isServiceMod = ["tickets", "bmet", "saudi-visa", "kuwait-visa"].includes(mod.key);
      const dueColumn = mod.computed?.some((c) => c.name === "balance") ? "balance" : "due";
      const computedDue = typeof due === "number" ? due : computeValue(r, dueColumn);

      let badgeNode: React.ReactNode;
      if (isServiceMod && status === "Delivered") {
        badgeNode = (
          <Badge className={computedDue > 0
            ? "bg-orange-500 text-white border-transparent hover:bg-orange-500/90 cursor-pointer"
            : "bg-emerald-600 text-white border-transparent hover:bg-emerald-600/90 cursor-pointer"}>
            {computedDue > 0 ? "⚠️ Delivered with Due" : "✅ Delivered"}
            <ChevronDown className="ml-1 h-3 w-3 opacity-80" />
          </Badge>
        );
      } else if (isServiceMod && status === "Pending Delivery") {
        badgeNode = (
          <Badge variant="outline" className="bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30 cursor-pointer">
            📦 Pending Delivery
            <ChevronDown className="ml-1 h-3 w-3 opacity-80" />
          </Badge>
        );
      } else {
        badgeNode = (
          <Badge variant="outline" className={`${statusBadgeClass(status)} cursor-pointer`}>
            {status}
            <ChevronDown className="ml-1 h-3 w-3 opacity-80" />
          </Badge>
        );
      }

      if (!mod.statuses || mod.statuses.length === 0) {
        return <div className="mt-1">{badgeNode}</div>;
      }

      return (
        <div className="mt-1">
          <button
            type="button"
            className="inline-flex items-center rounded-md outline outline-1 outline-transparent hover:outline-primary hover:bg-primary/10 hover:shadow-md transition-colors"
            title="Status পরিবর্তন করুন"
            data-row-noopen
            onClick={(e) => {
              e.stopPropagation();
              handleStatusSelect(r, status, e.currentTarget as HTMLElement);
            }}
          >
            {badgeNode}
          </button>
        </div>
      );
    };
    const dueBtn = (r: Row, due: number) => {
      const svc = DUE_SERVICE_KEY[mod.key];
      const totalSettle = agencyIsTotalSettle(r.agency_sold);
      if (due > 0 && svc && !totalSettle) {
        return (
          <button
            type="button"
            onClick={() => { selectRow(r.id); setDuePreselect({ serviceKey: svc, rowId: r.id }); }}
            className="inline-flex items-center gap-1 text-rose-500 hover:underline font-semibold rounded-md px-1 outline outline-1 outline-transparent hover:outline-primary hover:bg-primary/10 hover:shadow-md transition-colors"
            title="Due Receive"
          >
            Due: {fmt(due)} <Wallet className="h-3 w-3" />
          </button>
        );
      }
      return (
        <span
          className={due > 0 ? "text-rose-500 font-semibold" : "text-emerald-600"}
          title={due > 0 && totalSettle ? "মোটের উপর হিসাব — টাকা এজেন্সি লেজারে মোট হিসাবে গ্রহণ করুন" : undefined}
        >
          Due: {fmt(due)}
        </span>
      );
    };
    // Small badge next to Recv: ALWAYS the first 3 letters of the name of the
    // user who actually RECEIVED the payment (not the MD who later receives it
    // through the cash handover). Independent of payment method.
    const recvBadge = (r: Row, recv: number) => {
      if (!(recv > 0)) return null;
      const info = recvInfo[r.id];
      const rbyId = info?.received_by ?? (r.received_by as string | null) ?? null;
      let rbyName = info?.received_by_name ?? (rbyId ? profileNames[rbyId] : undefined);
      // Fallback: receipt belongs to the logged-in user but name not loaded yet.
      if ((!rbyName || !rbyName.trim()) && rbyId && user && rbyId === user.id) {
        rbyName = displayName(profile, user);
      }
      if (rbyName && rbyName.trim()) {
        return <span className="inline-flex items-center rounded px-1 mr-1 text-[9px] font-bold align-middle bg-amber-500/15 text-amber-500">{rbyName.trim().slice(0, 3)}</span>;
      }
      return null;
    };

    // Unified Amount cell — shows the passenger's FULL account at a glance:
    // combined bill (ticket + extra), combined received, the actionable service
    // due, plus a clearly-labelled extra-service due (received via customer ledger).
    const amountCell = (r: Row, recvField: string, opts?: { advance?: boolean }) => {
      const { sold, recv, discount, cost, due, profit, extraSold, extraDue, totalSold, totalRecv } = money(r, recvField);
      const hasExtra = extraSold > 0;
      const combinedDue = due + extraDue;
      const showProfit = (recv > 0 && cost > 0) || extraSold > 0;
      const profitClass = profit < 0 ? "text-rose-500" : combinedDue <= 0 ? "text-emerald-500" : "text-yellow-500";
      const showAdvance = !!opts?.advance && recv > 0 && isAdvancePayment(r.payment_date as string, r.delivery_date as string);
      return (
        <div className="text-right tabular-nums whitespace-nowrap">
          <div className="font-semibold">৳ {fmt(totalSold)}</div>
          {hasExtra ? (
            <div className="text-[10px] text-muted-foreground" title="মূল সার্ভিস + Extra service bill">
              মূল ৳{fmt(sold)} + ✨ ৳{fmt(extraSold)}
            </div>
          ) : null}
          <div className="text-xs text-emerald-600">{showAdvance ? <><AdvanceBadge advance /> </> : null}{recvBadge(r, totalRecv)}Recv: {fmt(totalRecv)}</div>
          {discount > 0 ? <div className="text-xs text-amber-600">Discount: {fmt(discount)}</div> : null}
          <div className="text-xs">{dueBtn(r, due)}</div>
          {extraDue > 0 ? (
            <button
              type="button"
              data-row-noopen
              onClick={(e) => {
                e.stopPropagation();
                selectRow(r.id);
                setExtraDuePreselect({
                  sourceTable: mod.table,
                  sourceId: r.id,
                  refId: String(r[mod.idColumn] ?? ""),
                  passenger: String(r.passenger_name ?? ""),
                });
              }}
              className="inline-flex items-center gap-1 text-fuchsia-600 dark:text-fuchsia-400 font-semibold text-xs rounded-md px-1 outline outline-1 outline-transparent hover:outline-fuchsia-500 hover:bg-fuchsia-500/10 hover:shadow-md transition-colors"
              title="Extra service-এর বকেয়া receive করুন"
            >
              ✨ Extra Due: {fmt(extraDue)} <Wallet className="h-3 w-3" />
            </button>
          ) : null}
          {showProfit ? <div className={`text-xs ${profitClass}`}>Profit: {fmt(profit)}</div> : null}
        </div>
      );
    };



    switch (mod.key) {
      case "tickets":
        return [
          { key: "ref", header: "Date / ID", render: (r) => (
            <div>
              <div className="font-medium whitespace-nowrap">{formatDate(r.entry_date as string)}</div>
              <div className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">{String(r[mod.idColumn] ?? "")}</div>
              {statusOrDeliveryBadge(r)}
              {(r.status_by || r.entry_by) ? <div className="text-[10px] text-muted-foreground whitespace-nowrap">by {String(r.status_by ?? r.entry_by)}</div> : null}
            </div>
          )},
          { key: "passenger", header: "Passenger", render: (r) => (
            <div className="min-w-[140px]">
              <div className="font-medium">{nameCopyBtn(r)}{String(r.passenger_name ?? "—")}{extraBadge(r)}</div>
              {extraNotesLine(r)}
              {r.passport ? subLine("PP", String(r.passport), String(r.passport)) : null}
              {r.mobile ? mobileSub(String(r.mobile), r) : null}
            </div>
          )},
          { key: "trip", header: "Trip", render: (r) => (
            <div className="min-w-[140px]">
              <div className="font-medium">{String(r.trip_road ?? "—")}</div>
              {r.airline ? <div className="text-xs text-muted-foreground leading-tight">{String(r.airline)}</div> : null}
              {r.flight_date ? <div className="text-xs text-muted-foreground leading-tight">✈ {formatDate(r.flight_date as string)}</div> : null}
              {r.pnr ? subLine("PNR", String(r.pnr)) : null}
            </div>
          )},
          { key: "parties", header: "Agency / Vendor", render: (r) => (
            <div>
              {r.agency_sold ? <div className="text-sm">{String(r.agency_sold)}</div> : <div className="text-xs text-muted-foreground">— no agency —</div>}
              {!isTicketBook(r) && r.vendor_bought ? <div className="text-xs text-muted-foreground">V: {String(r.vendor_bought)}{r.cost_price ? <span className="text-[10px] ml-1">(৳{fmt(Number(r.cost_price))})</span> : <span title="Vendor cost এন্ট্রি হয়নি" className="text-[10px] ml-1 text-amber-500">⚠️</span>}</div> : null}
              {extraCostLine(r)}

              
              {r.notes ? <div className="text-sm font-bold text-red-500 mt-1 max-w-[220px] whitespace-pre-wrap"><span>Note:</span> {String(r.notes)}</div> : null}
            </div>
          )},
          { key: "amount", header: "Amount", align: "right", render: (r) => amountCell(r, "received") },


        ];
      case "bmet":
        return [
          { key: "ref", header: "Date / ID", render: (r) => (
            <div>
              <div className="font-medium whitespace-nowrap">{formatDate(r.entry_date as string)}</div>
              <div className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">{String(r[mod.idColumn] ?? "")}</div>
              {statusOrDeliveryBadge(r)}
              {(r.status_by || r.entry_by) ? <div className="text-[10px] text-muted-foreground whitespace-nowrap mt-1">by {String(r.status_by ?? r.entry_by)}</div> : null}
            </div>
          )},
          { key: "passenger", header: "Passenger", render: (r) => (
            <div className="min-w-[150px]">
              <div className="font-medium">{nameCopyBtn(r)}{String(r.passenger_name ?? "—")}{extraBadge(r)}</div>
              {extraNotesLine(r)}
              {r.passport ? subLine("PP", String(r.passport), String(r.passport)) : null}
              {r.mobile ? mobileSub(String(r.mobile), r) : null}
              {r.country_name ? subLine("🌍", String(r.country_name)) : null}
            </div>
          )},
          { key: "process", header: "Process Dates", render: (r) => (
            <div className="text-xs">
              {r.attested_date ? subLine("Attested", formatDate(r.attested_date as string)) : null}
              {r.vendor_sent_date ? subLine("V.Sent", formatDate(r.vendor_sent_date as string)) : null}
              {r.received_date ? subLine("Recv", formatDate(r.received_date as string)) : null}
              {r.delivery_date ? subLine("Delivered", formatDate(r.delivery_date as string)) : null}
            </div>
          )},
          { key: "parties", header: "Agency / Vendor", render: (r) => (
            <div>
              {r.agency_sold ? <div className="text-sm">{String(r.agency_sold)}</div> : <div className="text-xs text-muted-foreground">—</div>}
              {r.vendor_bought ? <div className="text-xs text-muted-foreground">V: {String(r.vendor_bought)}{r.cost_price ? <span className="text-[10px] ml-1">(৳{fmt(Number(r.cost_price))})</span> : <span title="Vendor cost এন্ট্রি হয়নি" className="text-[10px] ml-1 text-amber-500">⚠️</span>}</div> : null}
              {extraCostLine(r)}
              {r.without_passport ? <div className="text-xs font-semibold text-amber-600 dark:text-amber-400 mt-0.5">Without passport</div> : null}
              {r.notes ? <div className="text-sm font-bold text-red-500 mt-1 max-w-[220px] whitespace-pre-wrap"><span>Note:</span> {String(r.notes)}</div> : null}
            </div>
          )},
          { key: "amount", header: "Amount", align: "right", render: (r) => amountCell(r, "received_amount", { advance: true }) },

        ];
      case "saudi-visa":
      case "kuwait-visa": {
        const recvField = mod.key === "saudi-visa" ? "received_amount" : "received";
        return [
          { key: "ref", header: "Date / ID", render: (r) => (
            <div>
              <div className="font-medium whitespace-nowrap">{formatDate(r.entry_date as string)}</div>
              <div className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">{String(r[mod.idColumn] ?? "")}</div>
              {statusOrDeliveryBadge(r)}
              {(r.status_by || r.entry_by) ? <div className="text-[10px] text-muted-foreground whitespace-nowrap mt-1">by {String(r.status_by ?? r.entry_by)}</div> : null}
            </div>
          )},
          { key: "passenger", header: "Passenger", render: (r) => (
            <div className="min-w-[150px]">
              <div className="font-medium">{nameCopyBtn(r)}{String(r.passenger_name ?? "—")}{extraBadge(r)}</div>
              {extraNotesLine(r)}
              {r.passport ? subLine("PP", String(r.passport), String(r.passport)) : null}
              {r.mobile ? mobileSub(String(r.mobile), r) : null}
            </div>
          )},
          { key: "visa", header: "Visa Info", render: (r) => (
            <div>
              <div className="font-medium">{String(r.visa_type ?? r.visa_no ?? "—")}</div>
              {r.visa_no && r.visa_type ? subLine("No", String(r.visa_no)) : null}
              {r.sponsor_name ? subLine("Sponsor", String(r.sponsor_name)) : null}
              {r.medical_status ? subLine("Medical", String(r.medical_status)) : null}
              {r.vendor_sent_date ? subLine("V.Sent", formatDate(r.vendor_sent_date as string)) : null}
              {r.received_date ? subLine("V.Recv", formatDate(r.received_date as string)) : null}
            </div>
          )},
          { key: "parties", header: "Agency / Vendor", render: (r) => (
            <div>
              {r.agency_sold ? <div className="text-sm">{String(r.agency_sold)}</div> : <div className="text-xs text-muted-foreground">—</div>}
              {r.vendor_bought ? <div className="text-xs text-muted-foreground">V: {String(r.vendor_bought)}{r.cost_price ? <span className="text-[10px] ml-1">(৳{fmt(Number(r.cost_price))})</span> : <span title="Vendor cost এন্ট্রি হয়নি" className="text-[10px] ml-1 text-amber-500">⚠️</span>}</div> : null}
              {extraCostLine(r)}
              {r.delivery_date ? subLine("Delivered", formatDate(r.delivery_date as string)) : null}
              {r.notes ? <div className="text-sm font-bold text-red-500 mt-1 max-w-[220px] whitespace-pre-wrap"><span>Note:</span> {String(r.notes)}</div> : null}
            </div>
          )},
          { key: "amount", header: "Amount", align: "right", render: (r) => amountCell(r, recvField, { advance: true }) },

        ];
      }
      case "other":
        return [
          { key: "ref", header: "Date / ID", render: (r) => (
            <div>
              <div className="font-medium whitespace-nowrap">{formatDate(r.entry_date as string)}</div>
              <div className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">{String(r[mod.idColumn] ?? "")}</div>
              {statusOrDeliveryBadge(r)}
              {(r.status_by || r.entry_by) ? <div className="text-[10px] text-muted-foreground whitespace-nowrap mt-1">by {String(r.status_by ?? r.entry_by)}</div> : null}
            </div>
          )},
          { key: "passenger", header: "Passenger", render: (r) => (
            <div className="min-w-[150px]">
              <div className="font-medium">{nameCopyBtn(r)}{String(r.passenger_name ?? "—")}{extraBadge(r)}</div>
              {extraNotesLine(r)}
              {r.passport ? subLine("PP", String(r.passport), String(r.passport)) : null}
              {r.mobile ? mobileSub(String(r.mobile), r) : null}
            </div>
          )},
          { key: "service", header: "Service", render: (r) => (
            <div>
              <div className="font-medium">{String(r.service_name ?? "—")}</div>
              {r.airline ? <div className="text-xs text-muted-foreground leading-tight">{String(r.airline)}</div> : null}
              {r.trip_road ? <div className="text-xs text-muted-foreground leading-tight">{String(r.trip_road)}</div> : null}
              {r.flight_date ? <div className="text-xs text-muted-foreground leading-tight">✈ {formatDate(r.flight_date as string)}</div> : null}
            </div>
          )},
          { key: "parties", header: "Agency / Vendor", render: (r) => (
            <div>
              {r.agency_sold ? <div className="text-sm">{String(r.agency_sold)}</div> : <div className="text-xs text-muted-foreground">—</div>}
              {r.vendor_bought ? <div className="text-xs text-muted-foreground">V: {String(r.vendor_bought)}{r.cost_price ? <span className="text-[10px] ml-1">(৳{fmt(Number(r.cost_price))})</span> : null}</div> : null}
              {extraCostLine(r)}
              {r.delivery_date ? subLine("Delivered", formatDate(r.delivery_date as string)) : null}
              {r.notes ? <div className="text-sm font-bold text-red-500 mt-1 max-w-[220px] whitespace-pre-wrap"><span>Note:</span> {String(r.notes)}</div> : null}
            </div>
          )},
          { key: "amount", header: "Amount", align: "right", render: (r) => amountCell(r, "received_amount", { advance: true }) },

        ];
      case "agents":

      case "vendors": {
        const isAgent = mod.key === "agents";
        const kind = isAgent ? "agent" : "vendor";
        return [
          { key: "serial", header: "ID", render: (r) => (
            <div className="font-mono text-xs tabular-nums text-muted-foreground whitespace-nowrap">
              {partySerialLabel(kind, r.serial_no, r[mod.idColumn])}
            </div>
          )},
          { key: "name", header: "Name", render: (r) => (
            <div>
              <div className="font-medium">{String(r.name ?? "—")}</div>
              <div className="text-[11px] font-mono text-muted-foreground">{String(r[mod.idColumn] ?? "")}</div>
            </div>
          )},
          { key: "contact", header: "Contact", render: (r) => (
            <div>
              {r.phone ? <div className={`text-sm ${mobileColorTextClass(mobileColorForRow(String(r.phone), r))}`}>📱 {String(r.phone)}</div> : <div className="text-xs text-muted-foreground">— no phone —</div>}
              {r.address ? subLine("📍", String(r.address)) : null}
            </div>
          )},
          { key: "notes", header: "Notes", render: (r) => (
            <div className="text-xs text-muted-foreground max-w-[260px] whitespace-pre-wrap">{String(r.notes ?? "")}</div>
          )},
        ];
      }
      default:
        return null;
    }
  }, [mod, computeValue, handleStatusSelect, mobileColorForRow, extraCounts, extraDetails, recvInfo, profileNames, user, canCancel, selectRow, agencyIsTotalSettle]);


  // After any action overlay (edit / due / status / view) closes, restore the
  // list scroll position and gently bring the worked row back into view.
  const anyOverlay =
    openForm || !!duePreselect || !!extraDuePreselect || !!statusChange ||
    !!profileRow || !!detailRow || !!cancelRow || !!refundRow || !!pwConfirm;
  const prevOverlayRef = useRef(anyOverlay);
  useEffect(() => {
    if (prevOverlayRef.current && !anyOverlay) {
      const y = workScrollRef.current;
      const restore = () => {
        if (y > 0) window.scrollTo(0, y);
        if (selectedId) {
          const el = document.getElementById(`row-${selectedId}`);
          el?.scrollIntoView({ block: "nearest" });
        }
      };
      requestAnimationFrame(() => requestAnimationFrame(restore));
      window.setTimeout(restore, 150);
      window.setTimeout(restore, 350);
    }
    prevOverlayRef.current = anyOverlay;
  }, [anyOverlay, selectedId]);

  // Clear the RED "worked row" highlight when the user clicks anywhere that is
  // NOT a data row (empty space, header, another control). Clicking a row sets
  // a new selection via selectRow; clicking elsewhere removes the red. Skipped
  // while an action overlay is open so scroll-restore keeps the row marked.
  useEffect(() => {
    if (!selectedId) return;
    const onDocClick = (e: MouseEvent) => {
      if (anyOverlay) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Inside a data row? keep / let selectRow handle it.
      if (target.closest('[id^="row-"]')) return;
      // Inside a popover/dialog/portal layer? ignore (action UI).
      if (target.closest('[role="dialog"],[data-radix-popper-content-wrapper]')) return;
      setSelectedId(null);
    };
    document.addEventListener("click", onDocClick, true);
    return () => document.removeEventListener("click", onDocClick, true);
  }, [selectedId, anyOverlay]);

  // Smart Search → scroll the main list to the chosen row (panel stays open)
  const scrollToRow = useCallback((row: Row) => {
    selectRow(row.id);
    const el = document.getElementById(`row-${row.id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectRow]);

  // Master Search (dashboard) → open this module already focused on one row.
  useEffect(() => {
    if (rows.length === 0) return;
    let raw: string | null = null;
    try { raw = sessionStorage.getItem("master_focus"); } catch { /* ignore */ }
    if (!raw) return;
    let parsed: { module?: string; id?: string } | null = null;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    if (!parsed || parsed.module !== mod.key || !parsed.id) return;
    const focusId = String(parsed.id);
    const target = rows.find((r) => String(r[mod.idColumn] ?? "") === focusId);
    try { sessionStorage.removeItem("master_focus"); } catch { /* ignore */ }
    if (!target) return;
    setSearch(focusId);
    selectRow(String(target.id));
    const doScroll = () => {
      const el = document.getElementById(`row-${target.id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.setTimeout(doScroll, 200);
    window.setTimeout(doScroll, 500);
  }, [rows, mod.key, mod.idColumn, selectRow]);




  return (
    <div className="relative z-10 space-y-4">
      <PageWatermark text={mod.label} />
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{mod.label}</h1>
          <p className="text-sm text-muted-foreground">মোট {rows.length} এন্ট্রি</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setSmartOpen(true)} className="gap-1.5">
            <Search className="h-4 w-4" /> Smart Search
          </Button>
        <Dialog open={openForm} onOpenChange={setOpenForm}>
          <DialogTrigger asChild>
            <Button onClick={startCreate} className="gap-1.5">
              <Plus className="h-4 w-4" /> নতুন এন্ট্রি
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0 [&>button.absolute]:hidden">
            <DialogHeader className="sticky top-0 z-20 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 border-b px-4 sm:px-6 py-3">
              <div className="flex items-center justify-between gap-2">
                <DialogTitle className="text-base sm:text-lg truncate">
                  {editing ? "এডিট করুন" : "নতুন এন্ট্রি"} — {mod.label}
                </DialogTitle>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!editing && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const f = emptyForm(mod);
                        if (mod.fields.some((fld) => fld.name === "entry_by")) {
                          f.entry_by = displayName(profile, user);
                        }
                        setForm(f);
                        toast.success("ফর্ম খালি করা হয়েছে");
                      }}
                      className="h-8 gap-1 px-2"
                      title="Clear"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Clear</span>
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setOpenForm(false)}
                    className="h-8 gap-1 px-2"
                    title="Search / Close"
                  >
                    <Search className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Search</span>
                  </Button>
                  <Button
                    onClick={submit}
                    disabled={saving}
                    size="sm"
                    className="h-8 gap-1 px-3 bg-emerald-600 hover:bg-emerald-700"
                    title="Save"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {saving ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setOpenForm(false)}
                    className="h-8 w-8 shrink-0"
                    title="বন্ধ করুন"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </DialogHeader>
            <div className="px-4 sm:px-6 pb-4 pt-3">
              <FormSections mod={mod} form={form} setForm={setForm} isEdit={!!editing} />
              {supportsExtra ? (
                <ExtraServiceSection
                  rows={extraServices}
                  setRows={setExtraServices}
                  show={showExtra}
                  setShow={setShowExtra}
                  vendorName={String(form.vendor_bought ?? "")}
                  headerExtra={
                    editing && canCancel ? (
                    editing.cancelled ? (
                      <div className="flex items-center gap-2">
                        {isTicketModule ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                            onClick={() => {
                              const r = editing;
                              setOpenForm(false);
                              setEditing(null);
                              openCancelOrRefund(r);
                            }}
                          >
                            <Ban className="h-3 w-3" /> টিকেট ক্যানসেল ও রিফান্ড
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs border-emerald-500/50 text-emerald-600 hover:bg-emerald-500/10"
                          onClick={() => { const r = editing; setOpenForm(false); setEditing(null); requestRestore(r); }}
                        >
                          <RotateCcw className="h-3 w-3" /> ফেরত আনুন
                        </Button>
                      </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                          onClick={() => {
                            const r = editing;
                            setOpenForm(false);
                            setEditing(null);
                            openCancelOrRefund(r);
                          }}
                        >
                          <Ban className="h-3 w-3" /> {isTicketModule ? "টিকেট ক্যানসেল ও রিফান্ড" : "কাজ বাতিল / ফেরত"}
                        </Button>
                      )
                    ) : null
                  }
                />
              ) : editing && canCancel ? (
                <div className="mt-4 flex justify-end border-t pt-3">
                  {editing.cancelled ? (
                    <div className="flex items-center gap-2">
                      {isTicketModule ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                          onClick={() => {
                            const r = editing;
                            setOpenForm(false);
                            setEditing(null);
                            openCancelOrRefund(r);
                          }}
                        >
                          <Ban className="h-3 w-3" /> টিকেট ক্যানসেল ও রিফান্ড
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs border-emerald-500/50 text-emerald-600 hover:bg-emerald-500/10"
                        onClick={() => { const r = editing; setOpenForm(false); setEditing(null); requestRestore(r); }}
                      >
                        <RotateCcw className="h-3 w-3" /> ফেরত আনুন
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                      onClick={() => {
                        const r = editing;
                        setOpenForm(false);
                        setEditing(null);
                        openCancelOrRefund(r);
                      }}
                    >
                      <Ban className="h-3 w-3" /> {isTicketModule ? "টিকেট ক্যানসেল ও রিফান্ড" : "কাজ বাতিল / ফেরত"}
                    </Button>
                  )}
                </div>
              ) : null}
            </div>


          </DialogContent>
        </Dialog>
        </div>
      </div>


      <Card>
        <CardContent className="p-2 sm:p-2.5">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5 items-end justify-between">
              <div className="flex flex-wrap gap-1.5 items-end">
                {hasDateFilter && (
                  <>
                    <div className="space-y-0.5 w-32">
                      <Label className="text-xs font-medium">Start Date</Label>
                      <DateInput value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-8 px-2 text-sm" />
                    </div>
                    <div className="space-y-0.5 w-32">
                      <Label className="text-xs font-medium">End Date</Label>
                      <DateInput value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-8 px-2 text-sm" />
                    </div>
                  </>
                )}
                {filterFields.map((f) => {
                  const opts = Array.from(new Set([
                    ...(f.lookupDefaults ?? []),
                    ...rows.map((r) => String(r[f.name] ?? "")).filter(Boolean),
                  ])).sort();
                  return (
                    <div key={f.name} className="space-y-0.5 w-32">
                      <Label className="text-xs font-medium">{f.label}</Label>
                      <Select value={fieldFilters[f.name] ?? "all"} onValueChange={(v) => setFieldFilters((s) => ({ ...s, [f.name]: v }))}>
                        <SelectTrigger className="h-8 px-2 text-sm"><SelectValue placeholder={`সব ${f.label}`} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">সব {f.label}</SelectItem>
                          {opts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
                {mod.statuses && (
                  <div className="space-y-0.5 w-32">
                    <Label className="text-xs font-medium">Status</Label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="h-8 px-2 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">সব Status</SelectItem>
                        {mod.statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {supportsStatusChangeFilter && (
                  <div className="flex flex-wrap gap-1.5 items-end rounded-md border border-sky-300 bg-sky-50 dark:bg-sky-950/30 px-2 py-1">
                    <div className="space-y-0.5">
                      <Label className="text-xs font-medium text-sky-700 dark:text-sky-300">স্টাটাস পরিবর্তনের তারিখ</Label>
                      <DateInput value={statusChangeDate} onChange={(e) => setStatusChangeDate(e.target.value)} className="h-8 px-2 text-sm w-36" />
                    </div>
                    <div className="space-y-0.5 w-36">
                      <Label className="text-xs font-medium text-sky-700 dark:text-sky-300">যে স্টাটাসে গেছে</Label>
                      <Select value={statusChangeStatus || "none"} onValueChange={(v) => setStatusChangeStatus(v === "none" ? "" : v)}>
                        <SelectTrigger className="h-8 px-2 text-sm"><SelectValue placeholder="স্টাটাস" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">স্টাটাস নির্বাচন</SelectItem>
                          {Object.keys(statusDateColMap).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    {(statusChangeDate || statusChangeStatus) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => { setStatusChangeDate(""); setStatusChangeStatus(""); }}
                        className="h-8 px-2 gap-1 text-sky-700 dark:text-sky-300"
                        title="তারিখ-স্টাটাস ফিল্টার মুছুন"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
                {mod.computed?.some((c) => c.name === "balance" || c.name === "due") && (
                  <Button type="button" variant={dueOnly ? "default" : "outline"} onClick={() => setDueOnly((v) => !v)} className="h-8 px-2.5 gap-1.5">
                    <Wallet className="h-4 w-4" /> শুধু Due
                  </Button>
                )}
                {canCancel && (
                  <Button
                    type="button"
                    variant={showCancelled ? "default" : "outline"}
                    onClick={() => setShowCancelled((v) => !v)}
                    className="h-8 px-2.5 gap-1.5"
                    title="বাতিল করা এন্ট্রি দেখুন"
                  >
                    <Ban className="h-4 w-4" /> বাতিল{cancelledCount > 0 ? ` (${cancelledCount})` : ""}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSearch(""); setStatusFilter("all"); setFieldFilters({});
                    setDueOnly(false); setStartDate(""); setEndDate(""); setShowCancelled(false);
                    setStatusChangeDate(""); setStatusChangeStatus("");
                  }}
                  className="h-8 px-2.5 gap-1.5"
                  title="Reset"
                >
                  <RotateCcw className="h-4 w-4" /> Reset
                </Button>
              </div>
              {mod.key === "bmet" && (
                <div className="shrink-0 flex items-center gap-2">
                  <BmetQuickManage rows={rows} onChanged={() => { void load(true); }} />
                  <BmetMonthlyPrint rows={rows} idColumn={mod.idColumn} />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="খুঁজুন…"
                  className="pl-9 h-9 text-sm"
                />
              </div>
              <div className="shrink-0 text-xs px-2.5 py-1.5 rounded-md border bg-muted/30 text-muted-foreground whitespace-nowrap">
                ফলাফল: <span className="font-semibold text-foreground tabular-nums">{filtered.length}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {summary.map((s) => (
                <div key={s.name} className="rounded-md border bg-muted/30 p-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
                  <div className={`mt-1 text-lg font-bold tabular-nums ${s.name === "balance" ? "text-rose-500" : ""}`}>
                    {s.total.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {groupSummary && groupSummary.length > 0 && (
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="mb-2">
              <h3 className="text-sm font-semibold">{mod.groupBy!.label} অনুযায়ী Due সারাংশ ({groupSummary.length})</h3>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">{mod.groupBy!.label}</TableHead>
                    {mod.groupBy!.metrics.map((m) => (
                      <TableHead key={m.name} className="text-right whitespace-nowrap">{m.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupSummary.map((g) => (
                    <TableRow key={g.key}>
                      <TableCell className="font-medium">{g.key}</TableCell>
                      {mod.groupBy!.metrics.map((m) => {
                        const val = g.vals[m.name] ?? 0;
                        const isDueClickable = m.name === "balance" && val > 0;
                        return (
                          <TableCell key={m.name} className={`text-right tabular-nums ${m.name === "balance" && val > 0 ? "text-rose-500 font-semibold" : ""}`}>
                            {isDueClickable ? (
                              <button
                                type="button"
                                onClick={() => startGroupPayment(g.key, val)}
                                className="inline-flex items-center gap-1 hover:underline"
                                title="পেমেন্ট পরিশোধ"
                              >
                                {val.toLocaleString()} <Wallet className="h-3.5 w-3.5" />
                              </button>
                            ) : (
                              val.toLocaleString()
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-3 sm:p-4">
          {monthPager && <div className="mb-3">{monthPager}</div>}
          <div className="overflow-x-auto rounded-md border">

            <Table>
              <TableHeader>
                <TableRow>
                  {stackedCols ? (
                    stackedCols.map((c) => (
                      <TableHead key={c.key} className={`whitespace-nowrap ${c.align === "right" ? "text-right" : ""}`}>{c.header}</TableHead>
                    ))
                  ) : (
                    <>
                      <TableHead className="whitespace-nowrap">{mod.idColumn}</TableHead>
                      {listCols.map((c) => (
                        <TableHead
                          key={c.kind === "field" ? c.field.name : c.comp.name}
                          className={`whitespace-nowrap ${c.kind === "computed" ? "text-right" : ""}`}
                        >
                          {c.kind === "field" ? c.field.label : c.comp.label}
                        </TableHead>
                      ))}
                    </>
                  )}
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  const colSpan = (stackedCols ? stackedCols.length : listCols.length + 1) + 1;
                  if (loading) return (<TableRow><TableCell colSpan={colSpan} className="text-center text-muted-foreground py-8">লোড হচ্ছে...</TableCell></TableRow>);
                  if (loadError) return (
                    <TableRow>
                      <TableCell colSpan={colSpan} className="text-center py-8">
                        <div className="space-y-2">
                          <p className="text-sm text-destructive">লোড করতে সমস্যা: {loadError}</p>
                          <Button type="button" variant="outline" size="sm" onClick={() => void load(true)}>আবার লোড করুন</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                  if (pageRows.length === 0) return (<TableRow><TableCell colSpan={colSpan} className="text-center text-muted-foreground py-8">কোনো এন্ট্রি পাওয়া যায়নি</TableCell></TableRow>);
                  return pageRows.map((r, idx) => (
                    <TableRow
                      key={r.id}
                      id={`row-${r.id}`}
                      className={`align-top row-tint-${idx % 4} cursor-pointer outline outline-1 transition-colors hover:outline-primary/60 hover:shadow-md ${selectedId === r.id ? "row-worked" : "outline-transparent"} ${canCancel && r.cancelled ? "cancelled-row opacity-70 grayscale bg-muted/50 text-muted-foreground" : ""}`}
                      onClick={(e) => {
                        const t = e.target as HTMLElement;
                        if (t.closest('button,a,[role="menuitem"],[role="menu"],input,select,textarea,[data-row-noopen]')) return;
                        selectRow(r.id);
                        setProfileRow(r);
                      }}
                    >
                      {stackedCols ? (
                        stackedCols.map((c) => (
                          <TableCell key={c.key} className={`py-3 ${c.align === "right" ? "text-right" : ""}`}>
                            {c.render(r)}
                          </TableCell>
                        ))
                      ) : (
                        <>
                          <TableCell className="font-mono text-xs whitespace-nowrap">{String(r[mod.idColumn] ?? "")}</TableCell>
                          {listCols.map((c) => {
                            if (c.kind === "computed") {
                              const v = c.comp.compute(r);
                              const isServiceDue = c.comp.name === "due" && v > 0 && DUE_SERVICE_KEY[mod.key] && !agencyIsTotalSettle(r.agency_sold);
                              return (
                                <TableCell key={c.comp.name} className="text-right tabular-nums whitespace-nowrap">
                                  {isServiceDue ? (
                                    <button
                                      type="button"
                                      onClick={() => { selectRow(r.id); setDuePreselect({ serviceKey: DUE_SERVICE_KEY[mod.key], rowId: r.id }); }}
                                      className="inline-flex items-center gap-1 text-rose-500 hover:underline font-semibold"
                                      title="Due Receive"
                                    >
                                      {v.toLocaleString()} <Wallet className="h-3.5 w-3.5" />
                                    </button>
                                  ) : (
                                    <span
                                      className={v < 0 ? "text-rose-500" : v > 0 && c.comp.name === "balance" ? "text-rose-500 font-semibold" : v > 0 ? "text-emerald-600" : ""}
                                      title={c.comp.name === "due" && v > 0 && DUE_SERVICE_KEY[mod.key] && agencyIsTotalSettle(r.agency_sold) ? "মোটের উপর হিসাব — টাকা এজেন্সি লেজারে মোট হিসাবে গ্রহণ করুন" : undefined}
                                    >{v.toLocaleString()}</span>
                                  )}
                                </TableCell>
                              );
                            }
                            const f = c.field;
                            return (
                              <TableCell key={f.name} className="whitespace-nowrap">
                                {f.name === "status" && mod.statuses ? (
                                  canCancel && r.cancelled ? (
                                    <Badge variant="outline" className="bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/40" title={String(r.cancel_reason ?? "") || "কাজ বাতিল"}>❌ বাতিল</Badge>
                                  ) : (
                                    <Badge variant="outline" className={statusBadgeClass(String(r[f.name] ?? ""))}>{String(r[f.name] ?? "")}</Badge>
                                  )
                                ) : f.type === "date" ? (
                                  formatDate(r[f.name] as string | null)
                                ) : f.type === "number" ? (
                                  <span className="tabular-nums">{(f.name === "received" || f.name === "received_amount") && Number(r[f.name] ?? 0) > 0 && mod.fields.some((x) => x.name === "delivery_date") && isAdvancePayment(r.payment_date as string, r.delivery_date as string) ? <><AdvanceBadge advance /> </> : null}{Number(r[f.name] ?? 0).toLocaleString()}</span>
                                ) : f.format === "mobile" || f.name === "mobile" || f.name === "phone" ? (
                                  <span className={mobileColorTextClass(mobileColorForRow(String(r[f.name] ?? ""), r))}>{String(r[f.name] ?? "")}</span>
                                ) : (
                                  String(r[f.name] ?? "")
                                )}
                              </TableCell>
                            );
                          })}
                        </>
                      )}
                      <TableCell className="text-right p-1">
                        <div className="flex justify-end gap-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="View" onClick={() => { selectRow(r.id); setDetailRow(r); }}>
                            <Eye className="h-3 w-3 text-primary" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="এডিট করুন" onClick={() => { selectRow(r.id); startEdit(r); }}><Pencil className="h-3 w-3" /></Button>
                          {canShowDelete(r) && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="ডিলিট করুন" onClick={() => {
                              selectRow(r.id);
                              const owner = r.created_by as string | null | undefined;
                              if (owner && user?.id && owner !== user.id) {
                                toast.error("এটি অন্য ইউজারের এন্ট্রি — আপনি ডিলিট করতে পারবেন না।");
                                return;
                              }
                              requestDelete(r);
                            }}><Trash2 className="h-3 w-3 text-rose-500" /></Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ));
                })()}
              </TableBody>
            </Table>
          </div>
          {monthPager && <div className="mt-3">{monthPager}</div>}
        </CardContent>

      </Card>


      {/* পাসওয়ার্ড দিয়ে নিশ্চিতকরণ (ডিলিট / বাতিল ফেরত) */}
      <PasswordConfirmDialog
        open={!!pwConfirm}
        onOpenChange={(o) => { if (!o) setPwConfirm(null); }}
        title={pwConfirm?.title}
        description={pwConfirm?.description}
        confirmLabel={pwConfirm?.confirmLabel}
        confirmClassName={pwConfirm?.confirmClassName}
        onConfirmed={async () => { await pwConfirm?.action(); setPwConfirm(null); }}
      />

      {/* Air Ticket — ক্যানসেল ও রিফান্ড ডায়ালগ */}
      <TicketRefundDialog
        row={refundRow}
        userEmail={user?.email ?? ""}
        userId={user?.id ?? null}
        onClose={() => setRefundRow(null)}
        onDone={() => { void load(false); }}
      />

      {/* কাজ বাতিল / ফেরত ডায়ালগ */}
      <Dialog open={!!cancelRow} onOpenChange={(o) => { if (!o) { setCancelRow(null); setCancelPw(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>কাজ বাতিল / ফেরত</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{String(cancelRow?.passenger_name ?? "")}</span>
              {" "}({String(cancelRow?.[mod.idColumn] ?? "")}) — এন্ট্রি ডিলেট হবে না, শুধু "বাতিল" হিসেবে চিহ্নিত হবে এবং চলমান কাজের তালিকা থেকে সরে যাবে।
            </p>
            <div className="space-y-1.5">
              <Label className="text-sm">বাতিলের তারিখ</Label>
              <DateInput value={cancelDate} onChange={(e) => setCancelDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">বাতিলের কারণ (ঐচ্ছিক)</Label>
              <Textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="যেমন: যাত্রী কাজ ফেরত নিয়ে গেছেন"
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">আপনার পাসওয়ার্ড (নিশ্চিত করতে)</Label>
              <Input
                type="password"
                value={cancelPw}
                onChange={(e) => setCancelPw(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCancelRow(null); setCancelPw(""); }} disabled={cancelBusy}>ফিরে যান</Button>
            <Button onClick={confirmCancel} disabled={cancelBusy} className="bg-amber-600 hover:bg-amber-700 text-white">
              {cancelBusy ? "প্রসেস হচ্ছে..." : "বাতিল করুন"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>



      <DueReceiveDialog
        open={!!duePreselect}
        onOpenChange={(v) => { if (!v) setDuePreselect(null); }}
        preselect={duePreselect}
        onDone={() => load(false)}
      />

      <ExtraDueReceiveDialog
        open={!!extraDuePreselect}
        onOpenChange={(v) => { if (!v) setExtraDuePreselect(null); }}
        preselect={extraDuePreselect}
        onDone={() => { void loadExtraCounts(); void load(false); }}
      />

      <StatusChangeDrawer
        request={statusChange}
        onClose={() => setStatusChange(null)}
        onApplied={() => void load(false)}
      />


      <PassengerProfileDrawer
        open={!!profileRow}
        onOpenChange={(v) => { if (!v) setProfileRow(null); }}
        row={profileRow}
        serviceTable={mod.table}
        moduleKey={mod.key}
        statusOrder={mod.statuses}
      />

      <RowDetailDrawer
        open={!!detailRow}
        onOpenChange={(v) => { if (!v) setDetailRow(null); }}
        row={detailRow}
        module={mod}
      />


      <SmartSearchPanel
        open={smartOpen}
        onClose={() => setSmartOpen(false)}
        rows={filtered}
        idColumn={mod.idColumn}
        moduleLabel={mod.label}
        onPick={scrollToRow}
      />
    </div>
  );
}

export const SECTION_LABELS: Record<Section, string> = {
  passenger: "১. Passenger Details",
  agency: "২. Sub Agency / Reference",
  vendor: "৩. Vendor Information",
};

export const SECTION_META: Record<Section, { label: string; icon: typeof UserRound }> = {
  passenger: { label: "Passenger Details", icon: UserRound },
  agency: { label: "Sub Agency / Reference", icon: Users },
  vendor: { label: "Vendor Information", icon: Building2 },
};

export function FormSections({ mod, form, setForm, isEdit }: {
  mod: ModuleSchema;
  form: Record<string, unknown>;
  setForm: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  isEdit?: boolean;
}) {
  const isFieldVisible = (f: Field) => {
    if (f.hideInForm) return false;
    if (f.showWhen) {
      const cur = String(form[f.showWhen.field] ?? "");
      if (!f.showWhen.equals.includes(cur)) return false;
    }
    return true;
  };
  const visibleFields = mod.fields.filter(isFieldVisible);
  const shownFields = visibleFields;
  // এন্ট্রিতে টাকা গ্রহণ করা হলে মাধ্যম (Cash/bKash/Bank...) নির্বাচনের সুযোগ।
  const recvNow = ["received", "received_amount", "paid_amount"]
    .reduce((s, c) => s + Number(form[c] ?? 0), 0);
  const showMethod = !!RECV_META[mod.table] && recvNow > 0;
  const methodVal = String(form.payment_method || "Cash");
  const sections: Section[] = ["passenger", "agency", "vendor"];
  const grouped = sections
    .map((s) => ({ section: s, fields: shownFields.filter((f) => (f.section ?? "passenger") === s) }))
    .filter((g) => g.fields.length > 0);
  const usesSections = visibleFields.some((f) => f.section);
  const hasPassportFields = mod.fields.some((f) => f.name === "passenger_name") && mod.fields.some((f) => f.name === "passport");
  const applyOcr = (fields: PassportFields) => {
    setForm((s) => {
      const next = { ...s };
      if (fields.passenger_name) next.passenger_name = fields.passenger_name;
      if (fields.passport) next.passport = fields.passport.toUpperCase();
      return next;
    });
  };
  const [agencyPhones, setAgencyPhones] = useState<{ name: string; phone: string; serial: number | null }[]>([]);

  useEffect(() => {
    if (!mod.fields.some((f) => f.lookup === "sub_agency" || f.name === "agency_sold")) return;
    let alive = true;
    void supabase
      .from("agents")
      .select("name,phone,serial_no")
      .limit(5000)
      .then(({ data }) => {
        if (!alive) return;
        setAgencyPhones(
          ((data as { name?: string | null; phone?: string | null; serial_no?: number | null }[] | null) ?? [])
            .map((r) => ({ name: String(r.name ?? "").trim(), phone: String(r.phone ?? "").trim(), serial: r.serial_no ?? null }))
            .filter((r) => r.name && r.name.toLowerCase() !== "self"),
        );
      });
    return () => { alive = false; };
  }, [mod]);

  // Loosely match a chosen agency name to its পরিচিতি বোর্ড row (ignores
  // spaces / dashes / case so "Future travel-Bhanga" still matches).
  const matchAgency = (name: string) => {
    const norm = (s: string) => s.trim().replace(/[\s\-_,.]+/g, " ").toLowerCase();
    const selected = norm(name);
    if (!selected || selected === "self") return undefined;
    return (
      agencyPhones.find((r) => norm(r.name) === selected) ??
      agencyPhones.find((r) => {
        const n = norm(r.name);
        return Boolean(n) && (selected.includes(n) || n.includes(selected));
      })
    );
  };

  // Enter → focus next input. Textarea/buttons keep native behavior.
  const onFormKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter") return;
    const t = e.target as HTMLElement;
    const tag = t.tagName;
    if (tag === "TEXTAREA" || tag === "BUTTON") return;
    if (tag !== "INPUT") return;
    e.preventDefault();
    const root = e.currentTarget;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>('input:not([readonly]):not([disabled])')
    );
    const idx = focusables.indexOf(t as HTMLElement);
    const next = focusables[idx + 1];
    if (next) next.focus();
  };

  // Generic field setter. When an agency (sub_agency / agency_sold) is chosen —
  // except "Self" — auto-fill the Mobile field with that agency's first phone
  // number from its পরিচিতি বোর্ড (agents.phone). Other fields just set as-is.
  const hasMobileField = mod.fields.some((f) => f.name === "mobile");
  const onFieldChange = (field: Field, v: unknown) => {
    setForm((s) => ({ ...s, [field.name]: v }));
    if (
      (field.lookup === "sub_agency" || field.name === "agency_sold") &&
      hasMobileField &&
      typeof v === "string"
    ) {
      const name = v.trim();
      if (name && name.toLowerCase() !== "self") {
        const loose = matchAgency(name);
        const first = String(loose?.phone ?? "")
          .split(/[,;\n|]+/)
          .map((p) => p.trim())
          .find((p) => normalizeMobileForColor(p));
        if (first) setForm((s) => ({ ...s, mobile: first }));
      }
    }
  };

  return (
    <div className="space-y-2 py-0.5" onKeyDown={onFormKeyDown}>
      {hasPassportFields && (
        <PassportScanner onResult={applyOcr} />
      )}
      {(usesSections ? grouped : [{ section: "passenger" as Section, fields: shownFields }]).map((g, gi) => {
        const meta = SECTION_META[g.section];
        const Icon = meta.icon;
        return (
          <section key={g.section} className="rounded-xl border bg-card/40 shadow-sm overflow-hidden">
            {usesSections && (
              <div className="flex items-center gap-2 px-2.5 py-1.5 border-b bg-muted/40">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-3 w-3" />
                </span>
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80">
                  {meta.label}
                </h3>
                <span className="ml-auto text-[10px] font-medium text-muted-foreground tabular-nums">
                  {gi + 1}/{grouped.length}
                </span>
              </div>
            )}
            <div
              className="grid gap-x-2 gap-y-1.5 p-2"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}
            >
              {g.fields.map((field) => {
                const isAgencyField = field.lookup === "sub_agency" || field.name === "agency_sold";
                const agencyVal = isAgencyField ? String(form[field.name] ?? "").trim() : "";
                const matched = isAgencyField && agencyVal && agencyVal.toLowerCase() !== "self" ? matchAgency(agencyVal) : undefined;
                const isRecvField = ["received", "received_amount", "paid_amount"].includes(field.name);
                return (
                  <Fragment key={field.name}>
                    <div className="space-y-0.5 min-w-0" style={fieldGridStyle(field)}>
                      <FormField
                        field={field}
                        value={form[field.name]}
                        onChange={(v) => onFieldChange(field, v)}
                        disabled={isEdit && ["received", "received_amount", "paid_amount"].includes(field.name)}
                      />
                      {isAgencyField && agencyVal && agencyVal.toLowerCase() !== "self" && (
                        <p className="text-[10px] leading-tight text-muted-foreground">
                          {matched?.serial != null ? (
                            <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">{partySerialCode("agent", matched.serial)}</span>
                          ) : (
                            <span className="text-amber-500">ID নেই</span>
                          )}
                          {" · "}
                          {matched?.phone ? (
                            <span className="text-emerald-500">📱 {matched.phone}</span>
                          ) : (
                            <span className="text-amber-500">এজেন্সির পরিচিতি বোর্ডে মোবাইল নেই</span>
                          )}
                        </p>
                      )}
                    </div>
                    {showMethod && isRecvField && (
                      <div className="space-y-0.5 min-w-0">
                        <Label className="flex items-center gap-1 text-[11px] font-medium text-foreground/80">
                          <Wallet className="h-3 w-3 text-primary" /> টাকা গ্রহণের মাধ্যম
                        </Label>
                        <Select
                          value={methodVal}
                          onValueChange={(v) => setForm((s) => ({ ...s, payment_method: v }))}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ENTRY_RECEIVE_METHODS.map((m) => (
                              <SelectItem key={m} value={m}>{m}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[10px] leading-tight text-muted-foreground">
                          {isCashMethod(methodVal)
                            ? "Cash — আপনার ক্যাশে যোগ হবে।"
                            : "সরাসরি MD-তে যাবে।"}
                        </p>
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </section>
        );
      })}



    </div>
  );
}

export function ExtraServiceSection({ rows, setRows, show, setShow, vendorName, headerExtra }: {
  rows: ExtraServiceRow[];
  setRows: React.Dispatch<React.SetStateAction<ExtraServiceRow[]>>;
  show: boolean;
  setShow: React.Dispatch<React.SetStateAction<boolean>>;
  vendorName: string;
  headerExtra?: ReactNode;
}) {
  const addRow = () => {
    setShow(true);
    setRows((p) => [...p, { service_name: "", service_price: 0, received_amount: 0, vendor_cost: 0, notes: "" }]);
  };
  const update = (i: number, patch: Partial<ExtraServiceRow>) =>
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows((p) => p.filter((_, idx) => idx !== i));

  return (
    <div className="mt-4 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Extra Service
        </h3>
        <div className="flex items-center gap-2">
          {headerExtra}
          <Button type="button" variant="outline" size="sm" onClick={addRow} className="h-8 gap-1">
            <Plus className="h-3.5 w-3.5" /> Extra Service
          </Button>
        </div>
      </div>


      {show && rows.length > 0 && (
        <div className="space-y-2 mt-2">
          {vendorName ? (
            <p className="text-xs text-muted-foreground">
              Vendor cost যোগ হবে: <b className="text-foreground">{vendorName}</b> এর হিসাবে।
            </p>
          ) : (
            <p className="text-xs text-amber-500">
              ⚠️ Vendor cost যোগ করতে আগে উপরে Vendor সিলেক্ট করুন।
            </p>
          )}
          {rows.map((ex, i) => (
            <div key={i} className="flex flex-wrap gap-2 items-end border rounded-md p-2">
              <div className="space-y-1" style={{ width: 240, maxWidth: "100%" }}>
                <Label className="text-sm font-medium">Service Name</Label>
                <LookupSelect
                  kind="extra_service"
                  value={ex.service_name}
                  onChange={(v) => update(i, { service_name: v })}
                />
              </div>
              <div className="space-y-1" style={{ width: 140, maxWidth: "100%" }}>
                <Label className="text-sm font-medium">Service Price</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={ex.service_price || ""}
                  onChange={(e) => update(i, { service_price: Number(e.target.value) || 0 })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1" style={{ width: 140, maxWidth: "100%" }}>
                <Label className="text-sm font-medium">Received Amount</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={ex.received_amount || ""}
                  onChange={(e) => update(i, { received_amount: Number(e.target.value) || 0 })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1" style={{ width: 140, maxWidth: "100%" }}>
                <Label className="text-sm font-medium">Vendor Cost</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={ex.vendor_cost || ""}
                  onChange={(e) => update(i, { vendor_cost: Number(e.target.value) || 0 })}
                  placeholder="0"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(i)}
                title="মুছুন"
                className="h-9 w-9"
              >
                <Trash2 className="h-4 w-4 text-rose-500" />
              </Button>
              <div className="space-y-1 w-full">
                <Label className="text-sm font-medium">Note</Label>
                <Input
                  value={ex.notes || ""}
                  onChange={(e) => update(i, { notes: e.target.value })}
                  placeholder="এই সার্ভিস সম্পর্কে নোট (সব হিসাবে দেখা যাবে)"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AutoGrowTextInput({
  value, onChange, onBlur, onFocus, className, readOnly, required, placeholder, inputMode,

}: {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
  className?: string;
  readOnly?: boolean;
  required?: boolean;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLTextAreaElement>["inputMode"];
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.max(36, el.scrollHeight) + "px";
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange({ target: { value: e.target.value } })}
      onBlur={onBlur}
      onFocus={onFocus}
      readOnly={readOnly}
      required={required}
      placeholder={placeholder}
      inputMode={inputMode}
      onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
      className={
        "flex w-full min-h-9 resize-none overflow-hidden rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 leading-6 break-words " +
        (className ?? "")
      }
    />
  );
}

// Grid-span/width for a field. Must be applied to the actual grid item
// (the wrapper div in FormSections), not to a nested child — otherwise the
// span has no effect and every field collapses to one 140px column.
export function fieldGridStyle(field: Field): React.CSSProperties {
  if (field.type === "textarea") return { gridColumn: "span 2" };
  if (field.name === "passenger_name") return { gridColumn: "span 2" };
  if (field.name === "airline") return { gridColumn: "span 2" };
  if (field.type === "number") return { gridColumn: "span 1", maxWidth: 130 };
  if (field.lookup) return { gridColumn: "span 2" };
  return {};
}

function FormField({ field, value, onChange, disabled }: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const strVal = (value as string) ?? "";
  const isEntryBy = field.name === "entry_by";
  return (
    <div className="space-y-0.5 min-w-0">

      <Label className="text-[11px] font-medium text-muted-foreground leading-tight">{field.label}{field.required && <span className="text-rose-500"> *</span>}</Label>
      {field.lookup ? (
        <LookupSelect kind={field.lookup} value={strVal} onChange={(v) => onChange(v)} defaults={field.lookupDefaults} />
      ) : field.type === "textarea" ? (
        <Textarea value={strVal} onChange={(e) => onChange(e.target.value)} rows={1} className="min-h-9" />
      ) : field.type === "select" ? (
        <Select value={strVal} onValueChange={onChange}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {field.options?.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : field.type === "boolean" ? (
        <div className="flex items-center h-9">
          <Checkbox checked={Boolean(value)} onCheckedChange={(v) => onChange(Boolean(v))} />
          <span className="ml-2 text-sm text-muted-foreground">Yes</span>
        </div>
      ) : field.type === "date" ? (
        <DateInput
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          max={field.noFuture ? todayIso() : undefined}
        />
      ) : (
        <AutoGrowTextInput
          inputMode={field.type === "number" ? "decimal" : undefined}
          value={
            field.type === "number"
              ? (value === 0 || value === null || value === undefined || value === "" ? "" : String(value))
              : strVal
          }
          placeholder={field.type === "number" ? "0" : undefined}
          className={(isEntryBy || disabled) ? "bg-muted text-muted-foreground" : ""}
          onChange={(e) => {
            if (disabled) return;
            if (field.type === "number") {
              const raw = e.target.value.trim();
              if (raw === "") return onChange(0);
              const m = /^(-?\d*\.?\d+)\s*([klmKLM])?$/.exec(raw);
              if (m) {
                let n = Number(m[1]);
                const suf = (m[2] || "").toLowerCase();
                if (suf === "k") n *= 1_000;
                else if (suf === "l") n *= 100_000;
                else if (suf === "m") n *= 1_000_000;
                onChange(n);
              } else {
                const n = Number(raw);
                onChange(Number.isFinite(n) ? n : 0);
              }
            } else {
              onChange(field.format ? applyFormat(field.format, e.target.value) : e.target.value);
            }
          }}
          onFocus={(e) => { if (field.type === "number" && (e.target.value === "0" || e.target.value === "")) (e.target as HTMLTextAreaElement).select(); }}
          onBlur={(e) => {
            if (field.format === "name") onChange(capitalizeWords(e.target.value));
          }}
          required={field.required}
          readOnly={isEntryBy || disabled}
        />
      )}
      {disabled && ["received", "received_amount", "paid_amount"].includes(field.name) && (
        <p className="text-[10px] leading-tight text-amber-600 dark:text-amber-400">
          🔒 লক করা — টাকা জমা নিতে "Due Receive" ব্যবহার করুন
        </p>
      )}
    </div>
  );
}



