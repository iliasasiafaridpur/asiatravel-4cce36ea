import { DateInput } from "@/components/ui/date-input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { resilientInsert } from "@/lib/offline-queue";
import { generateNextId } from "@/lib/idgen";
import { formatDate, statusBadgeClass, isAdvancePayment, type Field, type ModuleSchema, type Section } from "@/lib/modules";
import { AdvanceBadge } from "@/components/AdvanceBadge";
import { LookupSelect } from "@/components/LookupSelect";
import { applyFormat, capitalizeWords } from "@/lib/format";
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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2, Search, Wallet, RotateCcw, ChevronDown, Save } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { useFormDraft } from "@/hooks/useFormDraft";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import { PassportScanner, type PassportFields } from "@/components/PassportScanner";
import { speakModuleEntry, speakReceived, speakDelivery } from "@/lib/voice";
import { DueReceiveDialog, type DueReceivePreselect } from "@/components/DueReceiveDialog";
import { BmetQuickManage } from "@/components/BmetQuickManage";
import { PassengerProfileDrawer } from "@/components/PassengerProfileDrawer";
import { StatusChangeDrawer, type StatusChangeRequest } from "@/components/StatusChangeDrawer";
import { useMobileColors, mobileColorTextClass } from "@/hooks/useMobileColors";
import { isMdReceivedMethod } from "@/lib/payment-methods";
import { SmartSearchPanel } from "@/components/SmartSearchPanel";
import { CopyInlineButton } from "@/components/CopyInlineButton";

// Map module table → (received column, service-type label) used by StatusChangeDrawer
const RECV_META: Record<string, { recvCol: string; serviceType: string }> = {
  tickets: { recvCol: "received", serviceType: "Ticket" },
  bmet_cards: { recvCol: "received_amount", serviceType: "BMET Card" },
  saudi_visas: { recvCol: "received_amount", serviceType: "Saudi Visa" },
  kuwait_visas: { recvCol: "received", serviceType: "Kuwait Visa" },
  others: { recvCol: "received_amount", serviceType: "Other" },
};

// মডিউল কী → DueReceiveDialog এর serviceKey মিল
const DUE_SERVICE_KEY: Record<string, DueReceivePreselect["serviceKey"]> = {
  tickets: "tickets",
  bmet: "bmet",
  "saudi-visa": "saudi-visa",
  "kuwait-visa": "kuwait-visa",
};

// মডিউল যেগুলোতে Extra Service যুক্ত করা যাবে (passenger + vendor সহ সার্ভিস মডিউল)
const EXTRA_SERVICE_MODULES = ["tickets", "bmet", "saudi-visa", "kuwait-visa", "other"];

export type ExtraServiceRow = {
  id?: string;
  service_name: string;
  service_price: number;
  vendor_cost: number;
  notes: string;
};

type Row = Record<string, unknown> & { id: string };

interface Props {
  module: ModuleSchema;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

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
  const columns = new Set(["id", mod.idColumn, "created_at", "created_by", "received_by"]);
  // status_by only exists on the service tables that have a status workflow
  if (RECV_META[mod.table]) columns.add("status_by");
  mod.fields.forEach((field) => columns.add(field.name));
  return Array.from(columns).join(",");
}

export function ModulePage({ module: mod }: Props) {
  const { user, profile } = useCurrentUser();
  const { colorFor } = useMobileColors();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [fieldFilters, setFieldFilters] = useState<Record<string, string>>({});
  const [dueOnly, setDueOnly] = useState(false);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const hasDateFilter = useMemo(() => mod.fields.some((f) => f.name === "entry_date"), [mod]);
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
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);
  const [duePreselect, setDuePreselect] = useState<DueReceivePreselect | null>(null);
  const [statusChange, setStatusChange] = useState<StatusChangeRequest | null>(null);
  const [profileRow, setProfileRow] = useState<Row | null>(null);
  const [smartOpen, setSmartOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Per-row latest receive info (method + receiver) for the Recv method badge
  const [recvInfo, setRecvInfo] = useState<Record<string, { method: string | null; received_by: string | null; received_by_name: string | null }>>({});
  // user_id → display name (for rows whose receiver isn't on a receipt)
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const loadingRef = useRef(false);
  const reloadQueuedRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const cacheKey = `cache_v2_${mod.table}`;
  const columns = useMemo(() => selectColumns(mod), [mod]);
  const filterFields = useMemo(() => mod.fields.filter((f) => f.filterable), [mod]);

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

  const load = useCallback(async (showSpinner = !hasLoadedRef.current) => {
    if (loadingRef.current) {
      reloadQueuedRef.current = true;
      return;
    }
    loadingRef.current = true;
    if (showSpinner) setLoading(true);
    try {
      const result = await Promise.race([
        supabase
          .from(mod.table as never)
          .select(columns)
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(250),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("অনেক সময় লাগছে, আবার চেষ্টা করুন")), 6500)),
      ]);
      const { data, error } = result as { data: unknown; error: { message: string } | null };
      if (error) throw error;
      const list = ((data as unknown) as Row[]) ?? [];
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
  }, [mod.table, cacheKey, columns]);

  // Count of extra services per parent row (for the "+N" badge on the data list)
  const loadExtraCounts = useCallback(async () => {
    if (!supportsExtra) return;
    try {
      const { data } = await supabase
        .from("extra_services" as never)
        .select("id,source_id,service_name,service_price,vendor_cost,notes")
        .eq("source_table", mod.table);
      const list =
        ((data as { id: string; source_id: string; service_name: string; service_price: number; vendor_cost: number; notes: string | null }[] | null) ?? []);
      // How much of each extra service the customer has already paid lives on the
      // customer-ledger mirror (source_table='extra_services', source_id=extra.id).
      const exIds = list.map((r) => r.id);
      const settled: Record<string, number> = {};
      if (exIds.length) {
        const { data: led } = await supabase
          .from("agency_ledger")
          .select("source_id,received_amount,discount_amount")
          .eq("source_table", "extra_services")
          .in("source_id", exIds);
        ((led as { source_id: string; received_amount: number | null; discount_amount: number | null }[] | null) ?? []).forEach((l) => {
          const k = String(l.source_id);
          settled[k] = (settled[k] ?? 0) + Number(l.received_amount ?? 0) + Number(l.discount_amount ?? 0);
        });
      }
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
          received: Number(settled[String(r.id)] ?? 0),
        });
      });
      setExtraCounts(m);
      setExtraDetails(d);
    } catch { /* ignore */ }
  }, [mod.table, supportsExtra]);

  // Load latest receive method/receiver per row + a user_id→name map for the Recv badge
  const loadRecvInfo = useCallback(async () => {
    if (!RECV_META[mod.table]) return;
    try {
      const [{ data: receipts }, { data: profs }] = await Promise.all([
        supabase
          .from("payment_receipts")
          .select("service_row_id,method,received_by,received_by_name,created_at")
          .eq("service_table", mod.table)
          .order("created_at", { ascending: true }),
        supabase.from("profiles").select("user_id,full_name"),
      ]);
      const map: Record<string, { method: string | null; received_by: string | null; received_by_name: string | null }> = {};
      ((receipts as { service_row_id: string; method: string | null; received_by: string | null; received_by_name: string | null }[] | null) ?? []).forEach((rc) => {
        // ascending order → last write wins = most recent receipt
        if (rc.service_row_id) map[String(rc.service_row_id)] = { method: rc.method, received_by: rc.received_by, received_by_name: rc.received_by_name };
      });
      setRecvInfo(map);
      const names: Record<string, string> = {};
      ((profs as { user_id: string; full_name: string | null }[] | null) ?? []).forEach((p) => {
        if (p.user_id) names[p.user_id] = String(p.full_name ?? "");
      });
      setProfileNames(names);
    } catch { /* ignore */ }
  }, [mod.table]);

  useEffect(() => { void load(true); void loadExtraCounts(); void loadRecvInfo(); }, [load, loadExtraCounts, loadRecvInfo, mod.key]);

  // Realtime: auto-refresh on any change to this table
  useEffect(() => {
    const ch = supabase
      .channel(`rt_${mod.table}`)
      .on("postgres_changes", { event: "*", schema: "public", table: mod.table }, () => {
        void load(false);
        void loadRecvInfo();
      })
      .subscribe();
    let chx: ReturnType<typeof supabase.channel> | null = null;
    if (supportsExtra) {
      chx = supabase
        .channel(`rt_extra_${mod.table}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "extra_services" }, () => {
          void loadExtraCounts();
        })
        .subscribe();
    }
    return () => { supabase.removeChannel(ch); if (chx) supabase.removeChannel(chx); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mod.table]);


  const computeValue = useCallback((r: Row, name: string): number => {
    const c = mod.computed?.find((x) => x.name === name);
    if (c) return c.compute(r);
    return Number(r[name] ?? 0);
  }, [mod]);

  const filtered = useMemo(() => {
    let xs = rows;
    if (statusFilter !== "all") {
      xs = xs.filter((r) => (String(r.status ?? "") || (mod.statuses?.[0] ?? "")) === statusFilter);
    }
    for (const [name, val] of Object.entries(fieldFilters)) {
      if (val && val !== "all") xs = xs.filter((r) => String(r[name] ?? "") === val);
    }
    if (dueOnly) {
      const dueColumn = mod.computed?.some((c) => c.name === "balance") ? "balance" : "due";
      xs = xs.filter((r) => computeValue(r, dueColumn) > 0);
    }
    if (startDate) xs = xs.filter((r) => String(r.entry_date ?? "").slice(0, 10) >= startDate);
    if (endDate) xs = xs.filter((r) => String(r.entry_date ?? "").slice(0, 10) <= endDate);
    const q = search.trim().toLowerCase();
    if (q) {
      xs = xs.filter((r) =>
        Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q))
      );
    }
    return xs;
  }, [rows, search, statusFilter, fieldFilters, dueOnly, startDate, endDate, computeValue, mod.statuses]);

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
    setForm(f);
    setOpenForm(true);
    if (supportsExtra) {
      void supabase
        .from("extra_services" as never)
        .select("id,service_name,service_price,vendor_cost,notes")
        .eq("source_table", mod.table)
        .eq("source_id", r.id)
        .order("created_at", { ascending: true })
        .then(({ data }) => {
          const rows = ((data as ExtraServiceRow[] | null) ?? []).map((x) => ({
            id: x.id,
            service_name: String(x.service_name ?? ""),
            service_price: Number(x.service_price ?? 0),
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
        vendor_cost: Number(ex.vendor_cost) || 0,
        notes: (ex.notes || "").trim() || null,
      };
      if (ex.id && existingIds.has(ex.id)) {
        keepIds.add(ex.id);
        await supabase.from("extra_services" as never).update(row as never).eq("id", ex.id);
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
        if (recvAmount > 0) (payload as Record<string, unknown>).received_by = user.id;
      }
      if (hasField("entry_by") && (!payload.entry_by || payload.entry_by === "User")) (payload as Record<string, unknown>).entry_by = me;

      if (mod.deriveStatus && hasField("status")) {
        const derived = mod.deriveStatus(payload);
        if (derived !== undefined) (payload as Record<string, unknown>).status = derived;
      }

      // Only generate a fresh ID for NEW rows. Never overwrite the id of an existing row.
      const entryDateForId = typeof payload.entry_date === "string" ? (payload.entry_date as string) : undefined;
      const finalId = !isEdit ? await generateNextId(mod, entryDateForId) : undefined;
      if (finalId) (payload as Record<string, unknown>)[mod.idColumn] = finalId;

      if (isEdit && editId) {
        // STRICT EDIT PATH: UPDATE only — never insert a new row.
        // Make sure no stray id column is in the payload that would target a different row.
        delete (payload as Record<string, unknown>).id;
        const { error } = await supabase
          .from(mod.table as never)
          .update(payload as never)
          .eq("id", editId);
        if (error) throw error;
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
        if (hasExtra) {
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
      if (err?.code === "23505" && /passport.*entry_date|entry_date.*passport|uniq_.*_passport_date/i.test(String(err?.message ?? ""))) {
        toast.error("⛔ ডুপ্লিকেট এন্ট্রি! এই পাসপোর্টের জন্য আজকের তারিখে এই সার্ভিস ইতিমধ্যে বুক করা আছে।", { duration: 6000 });
      } else {
        toast.error("সমস্যা: " + errMsg(e));
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteRow) return;
    const { error } = await supabase.from(mod.table as never).delete().eq("id", deleteRow.id);
    if (error) toast.error("ডিলিট করতে সমস্যা: " + error.message);
    else { toast.success("ডিলিট হয়েছে"); await load(); }
    setDeleteRow(null);
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
      if (due > 0 && svc) {
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
  }, [mod, computeValue, load, profile, user]);

  const handleStatusSelect = useCallback((row: Row, newStatus: string, anchorEl?: HTMLElement | null) => {
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
    });
  }, [mod]);


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
        ? details.map((d) => `${d.service_name || "Service"} — Bill ৳${(d.service_price || 0).toLocaleString()}${d.vendor_cost ? ` / Vendor ৳${(d.vendor_cost || 0).toLocaleString()}` : ""}${d.notes ? ` (${d.notes})` : ""}`).join("\n")
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
      const ex = extraDetails[r.id] ?? [];
      const c = ex.reduce((a, d) => a + (Number(d.vendor_cost) || 0), 0);
      if (!c) return null;
      return (
        <div className="text-[11px] text-fuchsia-600 dark:text-fuchsia-400" title="Extra service — vendor ledger-এ যুক্ত">
          ✨ Extra cost: +৳{fmt(c)}
        </div>
      );
    };

    // Mobile sub-line with per-number color tag applied.
    const mobileSub = (mobile: string) => (
      <div className="text-xs leading-tight">
        <span className="opacity-60 text-muted-foreground">📱:</span>{" "}
        <span className={mobileColorTextClass(colorFor(mobile)) || "text-muted-foreground"}>{mobile}</span>
        <CopyInlineButton value={mobile} />
      </div>
    );
    // Single unified badge — click opens the right-side confirmation drawer.
    // The drawer owns the status dropdown + automation (vendor prompt, dates, due modal).
    const statusOrDeliveryBadge = (r: Row, due?: number) => {
      const status = String(r.status ?? "") || (mod.statuses?.[0] ?? "");
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
      if (due > 0 && svc) {
        return (
          <button
            type="button"
            onClick={() => setDuePreselect({ serviceKey: svc, rowId: r.id })}
            className="inline-flex items-center gap-1 text-rose-500 hover:underline font-semibold rounded-md px-1 outline outline-1 outline-transparent hover:outline-primary hover:bg-primary/10 hover:shadow-md transition-colors"
            title="Due Receive"
          >
            Due: {fmt(due)} <Wallet className="h-3 w-3" />
          </button>
        );
      }
      return <span className={due > 0 ? "text-rose-500 font-semibold" : "text-emerald-600"}>Due: {fmt(due)}</span>;
    };
    // Small badge next to Recv: who/where the received cash is.
    //  - "Cash"  → received (cash) by the logged-in user
    //  - "Abc"   → received (cash) by another user (first 3 letters of name)
    //  - "MD"    → non-cash method (goes straight to MD)
    const recvBadge = (r: Row, recv: number) => {
      if (!(recv > 0)) return null;
      const info = recvInfo[r.id];
      const method = info?.method ?? null;
      // Non-cash methods all flow to MD
      if (method && isMdReceivedMethod(method)) {
        return <span className="inline-flex items-center rounded px-1 mr-1 text-[9px] font-bold align-middle bg-sky-500/15 text-sky-500">MD</span>;
      }
      const rbyId = info?.received_by ?? (r.received_by as string | null) ?? null;
      const rbyName = info?.received_by_name ?? (rbyId ? profileNames[rbyId] : undefined);
      if (rbyId && user && rbyId === user.id) {
        return <span className="inline-flex items-center rounded px-1 mr-1 text-[9px] font-bold align-middle bg-emerald-500/15 text-emerald-500">Cash</span>;
      }
      if (rbyName && rbyName.trim()) {
        return <span className="inline-flex items-center rounded px-1 mr-1 text-[9px] font-bold align-middle bg-amber-500/15 text-amber-500">{rbyName.trim().slice(0, 3)}</span>;
      }
      // Unknown receiver — assume current user's cash
      return <span className="inline-flex items-center rounded px-1 mr-1 text-[9px] font-bold align-middle bg-emerald-500/15 text-emerald-500">Cash</span>;
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
            <div className="text-xs text-fuchsia-600 dark:text-fuchsia-400 font-semibold" title="Extra service-এর বকেয়া — Customer ledger থেকে receive করুন">
              ✨ Extra Due: {fmt(extraDue)}
            </div>
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
              {r.mobile ? mobileSub(String(r.mobile)) : null}
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
              {r.mobile ? mobileSub(String(r.mobile)) : null}
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
              {r.mobile ? mobileSub(String(r.mobile)) : null}
            </div>
          )},
          { key: "visa", header: "Visa Info", render: (r) => (
            <div>
              <div className="font-medium">{String(r.visa_type ?? r.visa_no ?? "—")}</div>
              {r.visa_no && r.visa_type ? subLine("No", String(r.visa_no)) : null}
              {r.sponsor_name ? subLine("Sponsor", String(r.sponsor_name)) : null}
              {r.medical_status ? subLine("Medical", String(r.medical_status)) : null}
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
              {r.mobile ? mobileSub(String(r.mobile)) : null}
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

      case "vendors":
        return [
          { key: "name", header: "Name", render: (r) => (
            <div>
              <div className="font-medium">{String(r.name ?? "—")}</div>
              <div className="text-[11px] font-mono text-muted-foreground">{String(r[mod.idColumn] ?? "")}</div>
            </div>
          )},
          { key: "contact", header: "Contact", render: (r) => (
            <div>
              {r.phone ? <div className={`text-sm ${mobileColorTextClass(colorFor(String(r.phone)))}`}>📱 {String(r.phone)}</div> : <div className="text-xs text-muted-foreground">— no phone —</div>}
              {r.address ? subLine("📍", String(r.address)) : null}
            </div>
          )},
          { key: "notes", header: "Notes", render: (r) => (
            <div className="text-xs text-muted-foreground max-w-[260px] whitespace-pre-wrap">{String(r.notes ?? "")}</div>
          )},
        ];
      default:
        return null;
    }
  }, [mod, computeValue, handleStatusSelect, colorFor, extraCounts, extraDetails, recvInfo, profileNames, user]);

  // Smart Search → scroll the main list to the chosen row (panel stays open)
  const scrollToRow = useCallback((row: Row) => {
    const el = document.getElementById(`row-${row.id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightId(row.id);
      window.setTimeout(() => setHighlightId((h) => (h === row.id ? null : h)), 2500);
    }
  }, []);



  return (
    <div className="space-y-4">
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
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0">
            <DialogHeader className="sticky top-0 z-20 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 border-b px-4 sm:px-6 py-3">
              <div className="flex items-center justify-between gap-2 pr-12">
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
                </div>
              </div>
            </DialogHeader>
            <div className="px-4 sm:px-6 pb-4 pt-3">
              <FormSections mod={mod} form={form} setForm={setForm} isEdit={!!editing} />
              {supportsExtra && (
                <ExtraServiceSection
                  rows={extraServices}
                  setRows={setExtraServices}
                  show={showExtra}
                  setShow={setShowExtra}
                  vendorName={String(form.vendor_bought ?? "")}
                />
              )}
            </div>

          </DialogContent>
        </Dialog>
        </div>
      </div>


      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 items-end justify-between">
              <div className="flex flex-wrap gap-2 items-end">
                {hasDateFilter && (
                  <>
                    <div className="space-y-1 w-32">
                      <Label className="text-sm font-medium">Start Date</Label>
                      <DateInput value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 px-2 text-sm" />
                    </div>
                    <div className="space-y-1 w-32">
                      <Label className="text-sm font-medium">End Date</Label>
                      <DateInput value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 px-2 text-sm" />
                    </div>
                  </>
                )}
                {filterFields.map((f) => {
                  const opts = Array.from(new Set([
                    ...(f.lookupDefaults ?? []),
                    ...rows.map((r) => String(r[f.name] ?? "")).filter(Boolean),
                  ])).sort();
                  return (
                    <div key={f.name} className="space-y-1 w-32">
                      <Label className="text-sm font-medium">{f.label}</Label>
                      <Select value={fieldFilters[f.name] ?? "all"} onValueChange={(v) => setFieldFilters((s) => ({ ...s, [f.name]: v }))}>
                        <SelectTrigger className="h-9 px-2 text-sm"><SelectValue placeholder={`সব ${f.label}`} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">সব {f.label}</SelectItem>
                          {opts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
                {mod.statuses && (
                  <div className="space-y-1 w-32">
                    <Label className="text-sm font-medium">Status</Label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="h-9 px-2 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">সব Status</SelectItem>
                        {mod.statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {mod.computed?.some((c) => c.name === "balance") && (
                  <Button type="button" variant={dueOnly ? "default" : "outline"} onClick={() => setDueOnly((v) => !v)} className="h-9 px-2.5 gap-1.5">
                    <Wallet className="h-4 w-4" /> শুধু Due
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSearch(""); setStatusFilter("all"); setFieldFilters({});
                    setDueOnly(false); setStartDate(""); setEndDate("");
                  }}
                  className="h-9 px-2.5 gap-1.5"
                  title="Reset"
                >
                  <RotateCcw className="h-4 w-4" /> Reset
                </Button>
              </div>
              {mod.key === "bmet" && (
                <div className="shrink-0">
                  <BmetQuickManage rows={rows} onChanged={() => load(true)} />
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
                  className="pl-9 h-11 text-base"
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
                  if (filtered.length === 0) return (<TableRow><TableCell colSpan={colSpan} className="text-center text-muted-foreground py-8">কোনো এন্ট্রি পাওয়া যায়নি</TableCell></TableRow>);
                  return filtered.map((r, idx) => (
                    <TableRow
                      key={r.id}
                      id={`row-${r.id}`}
                      className={`align-top row-tint-${idx % 4} cursor-pointer outline outline-1 transition-colors hover:outline-primary/60 hover:shadow-md ${highlightId === r.id ? "row-selected" : "outline-transparent"}`}
                      onClick={(e) => {
                        const t = e.target as HTMLElement;
                        if (t.closest('button,a,[role="menuitem"],[role="menu"],input,select,textarea,[data-row-noopen]')) return;
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
                              const isServiceDue = c.comp.name === "due" && v > 0 && DUE_SERVICE_KEY[mod.key];
                              return (
                                <TableCell key={c.comp.name} className="text-right tabular-nums whitespace-nowrap">
                                  {isServiceDue ? (
                                    <button
                                      type="button"
                                      onClick={() => setDuePreselect({ serviceKey: DUE_SERVICE_KEY[mod.key], rowId: r.id })}
                                      className="inline-flex items-center gap-1 text-rose-500 hover:underline font-semibold"
                                      title="Due Receive"
                                    >
                                      {v.toLocaleString()} <Wallet className="h-3.5 w-3.5" />
                                    </button>
                                  ) : (
                                    <span className={v < 0 ? "text-rose-500" : v > 0 && c.comp.name === "balance" ? "text-rose-500 font-semibold" : v > 0 ? "text-emerald-600" : ""}>{v.toLocaleString()}</span>
                                  )}
                                </TableCell>
                              );
                            }
                            const f = c.field;
                            return (
                              <TableCell key={f.name} className="whitespace-nowrap">
                                {f.name === "status" && mod.statuses ? (
                                  <Badge variant="outline" className={statusBadgeClass(String(r[f.name] ?? ""))}>{String(r[f.name] ?? "")}</Badge>
                                ) : f.type === "date" ? (
                                  formatDate(r[f.name] as string | null)
                                ) : f.type === "number" ? (
                                  <span className="tabular-nums">{(f.name === "received" || f.name === "received_amount") && Number(r[f.name] ?? 0) > 0 && mod.fields.some((x) => x.name === "delivery_date") && isAdvancePayment(r.payment_date as string, r.delivery_date as string) ? <><AdvanceBadge advance /> </> : null}{Number(r[f.name] ?? 0).toLocaleString()}</span>
                                ) : (
                                  String(r[f.name] ?? "")
                                )}
                              </TableCell>
                            );
                          })}
                        </>
                      )}
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => startEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => {
                            if (profile?.role !== "admin") {
                              toast.error("আপনার ডিলিট করার অনুমতি নেই। Admin-এর সাথে যোগাযোগ করুন।");
                              return;
                            }
                            setDeleteRow(r);
                          }}><Trash2 className="h-3.5 w-3.5 text-rose-500" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ));
                })()}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ডিলিট করবেন?</AlertDialogTitle>
            <AlertDialogDescription>এই এন্ট্রিটি ({String(deleteRow?.[mod.idColumn] ?? "")}) মুছে ফেলা হবে।</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>বাতিল</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-rose-600 hover:bg-rose-700">ডিলিট</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DueReceiveDialog
        open={!!duePreselect}
        onOpenChange={(v) => { if (!v) setDuePreselect(null); }}
        preselect={duePreselect}
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

  return (
    <div className="space-y-3 py-1" onKeyDown={onFormKeyDown}>
      {hasPassportFields && (
        <PassportScanner onResult={applyOcr} />
      )}
      {(usesSections ? grouped : [{ section: "passenger" as Section, fields: shownFields }]).map((g) => (
        <div key={g.section}>
          {usesSections && (
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 pb-0.5 border-b">
              {SECTION_LABELS[g.section]}
            </h3>
          )}
          <div className="flex flex-wrap gap-1.5 items-start">
            {g.fields.map((field) => (
              <FormField
                key={field.name}
                field={field}
                value={form[field.name]}
                onChange={(v) => setForm((s) => ({ ...s, [field.name]: v }))}
                disabled={isEdit && ["received", "received_amount", "paid_amount"].includes(field.name)}
              />
            ))}
          </div>
        </div>
      ))}

    </div>
  );
}

function ExtraServiceSection({ rows, setRows, show, setShow, vendorName }: {
  rows: ExtraServiceRow[];
  setRows: React.Dispatch<React.SetStateAction<ExtraServiceRow[]>>;
  show: boolean;
  setShow: React.Dispatch<React.SetStateAction<boolean>>;
  vendorName: string;
}) {
  const addRow = () => {
    setShow(true);
    setRows((p) => [...p, { service_name: "", service_price: 0, vendor_cost: 0, notes: "" }]);
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
        <Button type="button" variant="outline" size="sm" onClick={addRow} className="h-8 gap-1">
          <Plus className="h-3.5 w-3.5" /> Extra Service
        </Button>
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

function FormField({ field, value, onChange, disabled }: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const strVal = (value as string) ?? "";
  // Compact fixed widths with flex-wrap; textareas take full row.
  let widthStyle: React.CSSProperties = { width: 180, flex: "0 0 auto" };
  if (field.type === "textarea") {
    widthStyle = { width: "100%", flex: "1 1 100%" };
  } else if (field.lookup) {
    widthStyle = { width: 240, flex: "0 0 auto" };
  } else if ((field.type === "text" || !field.type) && strVal.length > 22) {
    const extra = Math.min(220, (strVal.length - 22) * 8);
    widthStyle = { width: 180 + extra, flex: "0 0 auto" };
  } else if (field.type === "date") {
    widthStyle = { width: 150, flex: "0 0 auto" };
  } else if (field.type === "number") {
    widthStyle = { width: 140, flex: "0 0 auto" };
  }
  // Never let a field exceed the dialog width on small screens (prevents cut-off).
  widthStyle = { ...widthStyle, maxWidth: "100%" };
  const isEntryBy = field.name === "entry_by";
  return (
    <div className="space-y-1" style={widthStyle}>

      <Label className="text-sm font-medium">{field.label}{field.required && <span className="text-rose-500"> *</span>}</Label>
      {field.lookup ? (
        <LookupSelect kind={field.lookup} value={strVal} onChange={(v) => onChange(v)} defaults={field.lookupDefaults} />
      ) : field.type === "textarea" ? (
        <Textarea value={strVal} onChange={(e) => onChange(e.target.value)} rows={2} className="min-h-[60px]" />
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
    </div>
  );
}



