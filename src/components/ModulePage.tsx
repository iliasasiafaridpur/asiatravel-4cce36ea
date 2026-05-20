import { DateInput } from "@/components/ui/date-input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { resilientInsert } from "@/lib/offline-queue";
import { generateNextId } from "@/lib/idgen";
import { formatDate, statusBadgeClass, type Field, type ModuleSchema, type Section } from "@/lib/modules";
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Plus, Pencil, Trash2, Search, Wallet, RotateCcw, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { useFormDraft } from "@/hooks/useFormDraft";
import { PassportScanner, type PassportFields } from "@/components/PassportScanner";
import { speakModuleEntry, speakReceived, speakDelivery } from "@/lib/voice";
import { DueReceiveDialog, type DueReceivePreselect } from "@/components/DueReceiveDialog";
import { BmetQuickManage } from "@/components/BmetQuickManage";
import { PassengerProfileDrawer } from "@/components/PassengerProfileDrawer";
import { StatusChangeDrawer, type StatusChangeRequest } from "@/components/StatusChangeDrawer";

// Map module table → (received column, service-type label) used by StatusChangeDrawer
const RECV_META: Record<string, { recvCol: string; serviceType: string }> = {
  tickets: { recvCol: "received", serviceType: "Ticket" },
  bmet_cards: { recvCol: "received_amount", serviceType: "BMET Card" },
  saudi_visas: { recvCol: "received_amount", serviceType: "Saudi Visa" },
  kuwait_visas: { recvCol: "received", serviceType: "Kuwait Visa" },
};

// মডিউল কী → DueReceiveDialog এর serviceKey মিল
const DUE_SERVICE_KEY: Record<string, DueReceivePreselect["serviceKey"]> = {
  tickets: "tickets",
  bmet: "bmet",
  "saudi-visa": "saudi-visa",
  "kuwait-visa": "kuwait-visa",
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
    else if (field.type === "date" && field.name === "entry_date") f[field.name] = todayIso();
    else if (field.type === "select") f[field.name] = field.defaultEmpty ? "" : (field.options?.[0] ?? "");
    else if (field.lookup === "sub_agency") f[field.name] = "Self";
    else f[field.name] = "";
  }
  return f;
}

function selectColumns(mod: ModuleSchema): string {
  const columns = new Set(["id", mod.idColumn, "created_at", "created_by", "received_by"]);
  mod.fields.forEach((field) => columns.add(field.name));
  return Array.from(columns).join(",");
}

export function ModulePage({ module: mod }: Props) {
  const { user, profile } = useCurrentUser();
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
  const [saving, setSaving] = useState(false);
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);
  const [duePreselect, setDuePreselect] = useState<DueReceivePreselect | null>(null);
  const [statusChange, setStatusChange] = useState<StatusChangeRequest | null>(null);
  const [profileRow, setProfileRow] = useState<Row | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const reloadQueuedRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const cacheKey = `cache_v2_${mod.table}`;
  const columns = useMemo(() => selectColumns(mod), [mod]);
  const filterFields = useMemo(() => mod.fields.filter((f) => f.filterable), [mod]);

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

  useEffect(() => { void load(true); }, [load, mod.key]);

  // Realtime: auto-refresh on any change to this table
  useEffect(() => {
    const ch = supabase
      .channel(`rt_${mod.table}`)
      .on("postgres_changes", { event: "*", schema: "public", table: mod.table }, () => {
        void load(false);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mod.table]);

  const computeValue = useCallback((r: Row, name: string): number => {
    const c = mod.computed?.find((x) => x.name === name);
    if (c) return c.compute(r);
    return Number(r[name] ?? 0);
  }, [mod]);

  const filtered = useMemo(() => {
    let xs = rows;
    if (statusFilter !== "all") xs = xs.filter((r) => r.status === statusFilter);
    for (const [name, val] of Object.entries(fieldFilters)) {
      if (val && val !== "all") xs = xs.filter((r) => String(r[name] ?? "") === val);
    }
    if (dueOnly) xs = xs.filter((r) => computeValue(r, "balance") > 0);
    if (startDate) xs = xs.filter((r) => String(r.entry_date ?? "").slice(0, 10) >= startDate);
    if (endDate) xs = xs.filter((r) => String(r.entry_date ?? "").slice(0, 10) <= endDate);
    const q = search.trim().toLowerCase();
    if (q) {
      xs = xs.filter((r) =>
        Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q))
      );
    }
    return xs;
  }, [rows, search, statusFilter, fieldFilters, dueOnly, startDate, endDate, computeValue]);

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
    setEditing(null);
    const f = emptyForm(mod);
    // Auto-fill "Entry By" with current user's name
    if (mod.fields.some((fld) => fld.name === "entry_by")) {
      f.entry_by = displayName(profile, user);
    }
    setForm(f);
    setOpenForm(true);
  };

  const startEdit = (r: Row) => {
    setEditing(r);
    const f: Record<string, unknown> = {};
    for (const field of mod.fields) f[field.name] = r[field.name] ?? (field.type === "number" ? 0 : "");
    if (mod.fields.some((fld) => fld.name === "entry_by") && (!f.entry_by || f.entry_by === "User")) {
      f.entry_by = displayName(profile, user);
    }
    setForm(f);
    setOpenForm(true);
  };

  const submit = async () => {
    if (saving) return; // Prevent double-submit
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
      const finalId = !isEdit ? await generateNextId(mod) : undefined;
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
        const { offline } = await resilientInsert(mod.table, payload as Record<string, unknown>);
        setOpenForm(false);
        if (!offline) {
          toast.success(`✓ যোগ হয়েছে: ${finalId}`);
          speakModuleEntry(mod.key);
          if (recvAmount > 0) speakReceived(recvAmount);
        }
        clearDraft();
      }
      void load();
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
      const due = computeValue(row, "balance");
      const svc = DUE_SERVICE_KEY[mod.key];
      if (due > 0 && svc) {
        setDuePreselect({ serviceKey: svc, rowId: row.id });
        return;
      }
    }

    const payload: Record<string, unknown> = { status: newStatus, ...extra };

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
      toast.success(`Status: ${newStatus}`);
      if (newStatus === "Delivered") speakDelivery(String(row.passenger_name ?? ""));
      void load(false);
    } catch (e) {
      toast.error("Status আপডেট করা যায়নি: " + errMsg(e));
    }
  }, [mod, computeValue, load]);

  const handleStatusSelect = useCallback((row: Row, newStatus: string) => {
    const hasField = (n: string) => mod.fields.some((f) => f.name === n);
    const meta = RECV_META[mod.table] ?? { recvCol: "received", serviceType: mod.label };
    setStatusChange({
      row,
      newStatus,
      table: mod.table,
      recvCol: meta.recvCol,
      serviceType: meta.serviceType,
      refId: String(row[mod.idColumn] ?? ""),
      hasVendorField: hasField("vendor_bought"),
      hasVendorSentDate: hasField("vendor_sent_date"),
      hasReceivedDate: hasField("received_date"),
      hasDeliveryDate: hasField("delivery_date"),
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
    const subLine = (label: string, val: React.ReactNode) => (
      <div className="text-xs text-muted-foreground leading-tight">
        <span className="opacity-60">{label}:</span> {val}
      </div>
    );
    // Single unified badge — interactive dropdown when mod.statuses exists.
    // Click → choose new status → triggers automation (vendor prompt, dates, due modal).
    const statusOrDeliveryBadge = (r: Row, due?: number) => {
      const status = String(r.status ?? "");
      if (!status) return null;
      const isServiceMod = ["tickets", "bmet", "saudi-visa", "kuwait-visa"].includes(mod.key);
      const computedDue = typeof due === "number" ? due : computeValue(r, "balance");

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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="inline-flex items-center" title="Status পরিবর্তন করুন">
                {badgeNode}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="text-xs">Status পরিবর্তন</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {mod.statuses.map((s) => (
                <DropdownMenuItem
                  key={s}
                  disabled={s === status}
                  onClick={() => handleStatusSelect(r, s)}
                  className="flex items-center gap-2"
                >
                  <Badge variant="outline" className={`${statusBadgeClass(s)} pointer-events-none`}>{s}</Badge>
                  {s === status && <span className="ml-auto text-[10px] text-muted-foreground">current</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
            className="inline-flex items-center gap-1 text-rose-500 hover:underline font-semibold"
            title="Due Receive"
          >
            Due: {fmt(due)} <Wallet className="h-3 w-3" />
          </button>
        );
      }
      return <span className={due > 0 ? "text-rose-500 font-semibold" : "text-emerald-600"}>Due: {fmt(due)}</span>;
    };

    switch (mod.key) {
      case "tickets":
        return [
          { key: "ref", header: "Date / ID", render: (r) => (
            <div>
              <div className="font-medium whitespace-nowrap">{formatDate(r.entry_date as string)}</div>
              <div className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">{String(r[mod.idColumn] ?? "")}</div>
              {statusOrDeliveryBadge(r)}
              {r.entry_by ? <div className="text-[10px] text-muted-foreground whitespace-nowrap">by {String(r.entry_by)}</div> : null}
            </div>
          )},
          { key: "passenger", header: "Passenger", render: (r) => (
            <div className="min-w-[140px]">
              <div className="font-medium">{String(r.passenger_name ?? "—")}</div>
              {r.passport ? subLine("PP", String(r.passport)) : null}
              {r.mobile ? subLine("📱", String(r.mobile)) : null}
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
              {r.vendor_bought ? <div className="text-xs text-muted-foreground">V: {String(r.vendor_bought)}{r.cost_price ? <span className="text-[10px] ml-1">(৳{fmt(Number(r.cost_price))})</span> : null}</div> : null}
              {r.status ? <div className="mt-1"><Badge variant="outline" className={statusBadgeClass(String(r.status))}>{String(r.status)}</Badge></div> : null}
              {r.notes ? <div className="text-sm font-bold text-red-500 mt-1 max-w-[220px] whitespace-pre-wrap"><span>Note:</span> {String(r.notes)}</div> : null}
            </div>
          )},
          { key: "amount", header: "Amount", align: "right", render: (r) => {
            const sold = Number(r.sold_price ?? 0);
            const recv = Number(r.received ?? 0);
            const cost = Number(r.cost_price ?? 0);
            const due = sold - recv;
            const profit = sold - cost;
            return (
              <div className="text-right tabular-nums whitespace-nowrap">
                <div className="font-semibold">৳ {fmt(sold)}</div>
                <div className="text-xs text-emerald-600">Recv: {fmt(recv)}</div>
                <div className="text-xs">{dueBtn(r, due)}</div>
                <div className={`text-xs ${profit < 0 ? "text-rose-500" : "text-muted-foreground"}`}>Profit: {fmt(profit)}</div>
              </div>
            );
          }},
        ];
      case "bmet":
        return [
          { key: "ref", header: "Date / ID", render: (r) => (
            <div>
              <div className="font-medium whitespace-nowrap">{formatDate(r.entry_date as string)}</div>
              <div className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">{String(r[mod.idColumn] ?? "")}</div>
              {statusOrDeliveryBadge(r)}
              {r.entry_by ? <div className="text-[10px] text-muted-foreground whitespace-nowrap mt-1">by {String(r.entry_by)}</div> : null}
            </div>
          )},
          { key: "passenger", header: "Passenger", render: (r) => (
            <div className="min-w-[150px]">
              <div className="font-medium">{String(r.passenger_name ?? "—")}</div>
              {r.passport ? subLine("PP", String(r.passport)) : null}
              {r.mobile ? subLine("📱", String(r.mobile)) : null}
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
              {r.vendor_bought ? <div className="text-xs text-muted-foreground">V: {String(r.vendor_bought)}{r.cost_price ? <span className="text-[10px] ml-1">(৳{fmt(Number(r.cost_price))})</span> : null}</div> : null}
              {r.notes ? <div className="text-sm font-bold text-red-500 mt-1 max-w-[220px] whitespace-pre-wrap"><span>Note:</span> {String(r.notes)}</div> : null}
            </div>
          )},
          { key: "amount", header: "Amount", align: "right", render: (r) => {
            const sold = Number(r.sold_price ?? 0);
            const recv = Number(r.received_amount ?? 0);
            const cost = Number(r.cost_price ?? 0);
            const due = sold - recv;
            const profit = sold - cost;
            return (
              <div className="text-right tabular-nums whitespace-nowrap">
                <div className="font-semibold">৳ {fmt(sold)}</div>
                <div className="text-xs text-emerald-600">Recv: {fmt(recv)}</div>
                <div className="text-xs">{dueBtn(r, due)}</div>
                <div className={`text-xs ${profit < 0 ? "text-rose-500" : "text-muted-foreground"}`}>Profit: {fmt(profit)}</div>
              </div>
            );
          }},
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
              {r.entry_by ? <div className="text-[10px] text-muted-foreground whitespace-nowrap mt-1">by {String(r.entry_by)}</div> : null}
            </div>
          )},
          { key: "passenger", header: "Passenger", render: (r) => (
            <div className="min-w-[150px]">
              <div className="font-medium">{String(r.passenger_name ?? "—")}</div>
              {r.passport ? subLine("PP", String(r.passport)) : null}
              {r.mobile ? subLine("📱", String(r.mobile)) : null}
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
              {r.vendor_bought ? <div className="text-xs text-muted-foreground">V: {String(r.vendor_bought)}{r.cost_price ? <span className="text-[10px] ml-1">(৳{fmt(Number(r.cost_price))})</span> : null}</div> : null}
              {r.delivery_date ? subLine("Delivered", formatDate(r.delivery_date as string)) : null}
              {r.notes ? <div className="text-sm font-bold text-red-500 mt-1 max-w-[220px] whitespace-pre-wrap"><span>Note:</span> {String(r.notes)}</div> : null}
            </div>
          )},
          { key: "amount", header: "Amount", align: "right", render: (r) => {
            const sold = Number(r.sold_price ?? 0);
            const recv = Number(r[recvField] ?? 0);
            const cost = Number(r.cost_price ?? 0);
            const due = sold - recv;
            const profit = sold - cost;
            return (
              <div className="text-right tabular-nums whitespace-nowrap">
                <div className="font-semibold">৳ {fmt(sold)}</div>
                <div className="text-xs text-emerald-600">Recv: {fmt(recv)}</div>
                <div className="text-xs">{dueBtn(r, due)}</div>
                <div className={`text-xs ${profit < 0 ? "text-rose-500" : "text-muted-foreground"}`}>Profit: {fmt(profit)}</div>
              </div>
            );
          }},
        ];
      }
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
              {r.phone ? <div className="text-sm">📱 {String(r.phone)}</div> : <div className="text-xs text-muted-foreground">— no phone —</div>}
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
  }, [mod, computeValue, handleStatusSelect]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{mod.label}</h1>
          <p className="text-sm text-muted-foreground">মোট {rows.length} এন্ট্রি</p>
        </div>
        <Dialog open={openForm} onOpenChange={setOpenForm}>
          <DialogTrigger asChild>
            <Button onClick={startCreate} className="gap-1.5">
              <Plus className="h-4 w-4" /> নতুন এন্ট্রি
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "এডিট করুন" : "নতুন এন্ট্রি"} — {mod.label}</DialogTitle>
            </DialogHeader>
            <FormSections mod={mod} form={form} setForm={setForm} />

            <DialogFooter className="sm:justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const f = emptyForm(mod);
                  if (mod.fields.some((fld) => fld.name === "entry_by")) {
                    f.entry_by = displayName(profile, user);
                  }
                  setForm(f);
                  toast.success("ফর্ম খালি করা হয়েছে");
                }}
                className="gap-1.5"
              >
                <RotateCcw className="h-4 w-4" /> CLEAR
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setOpenForm(false)}>বাতিল</Button>
                <Button onClick={submit} disabled={saving}>{saving ? "সেভ হচ্ছে..." : "সেভ"}</Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 items-end justify-between">
              <div className="flex flex-wrap gap-2 items-end">
                {hasDateFilter && (
                  <>
                    <div className="space-y-1 w-32">
                      <Label className="text-xs font-medium">Start Date</Label>
                      <DateInput value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 px-2 text-sm" />
                    </div>
                    <div className="space-y-1 w-32">
                      <Label className="text-xs font-medium">End Date</Label>
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
                      <Label className="text-xs font-medium">{f.label}</Label>
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
                    <Label className="text-xs font-medium">Status</Label>
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
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="খুঁজুন... (নাম, পাসপোর্ট, ID যেকোনো ফিল্ড)"
                className="pl-9 h-11 text-base"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="grid grid-cols-3 gap-3">
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
                      className={`align-top row-tint-${idx % 6} cursor-pointer`}
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
                                  <span className="tabular-nums">{Number(r[f.name] ?? 0).toLocaleString()}</span>
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
                          <Button variant="ghost" size="icon" onClick={() => setDeleteRow(r)}><Trash2 className="h-3.5 w-3.5 text-rose-500" /></Button>
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
      />
    </div>
  );
}

export const SECTION_LABELS: Record<Section, string> = {
  passenger: "১. Passenger Details",
  agency: "২. Sub Agency / Reference",
  vendor: "৩. Vendor Information",
};

export function FormSections({ mod, form, setForm }: {
  mod: ModuleSchema;
  form: Record<string, unknown>;
  setForm: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
}) {
  const visibleFields = mod.fields.filter((f) => !f.hideInForm);
  const sections: Section[] = ["passenger", "agency", "vendor"];
  const grouped = sections
    .map((s) => ({ section: s, fields: visibleFields.filter((f) => (f.section ?? "passenger") === s) }))
    .filter((g) => g.fields.length > 0);
  // If no field uses sections at all, render as one block (e.g. agents/vendors/ledgers).
  const usesSections = visibleFields.some((f) => f.section);
  const hasPassportFields = mod.fields.some((f) => f.name === "passenger_name") && mod.fields.some((f) => f.name === "passport");
  const applyOcr = (fields: PassportFields) => {
    setForm((s) => {
      const next = { ...s };
      // Only apply name + passport — nothing else.
      if (fields.passenger_name) next.passenger_name = fields.passenger_name;
      if (fields.passport) next.passport = fields.passport.toUpperCase();
      return next;
    });
  };
  return (
    <div className="space-y-5 py-2">
      {hasPassportFields && (
        <PassportScanner onResult={applyOcr} />
      )}
      {(usesSections ? grouped : [{ section: "passenger" as Section, fields: visibleFields }]).map((g) => (
        <div key={g.section}>
          {usesSections && (
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 pb-1 border-b">
              {SECTION_LABELS[g.section]}
            </h3>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {g.fields.map((field) => (
              <FormField
                key={field.name}
                field={field}
                value={form[field.name]}
                onChange={(v) => setForm((s) => ({ ...s, [field.name]: v }))}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FormField({ field, value, onChange }: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const span = field.type === "textarea" ? "sm:col-span-2" : "";
  const strVal = (value as string) ?? "";
  const isEntryBy = field.name === "entry_by";
  return (
    <div className={`space-y-1.5 ${span}`}>
      <Label>{field.label}{field.required && <span className="text-rose-500"> *</span>}</Label>
      {field.lookup ? (
        <LookupSelect kind={field.lookup} value={strVal} onChange={(v) => onChange(v)} defaults={field.lookupDefaults} />
      ) : field.type === "textarea" ? (
        <Textarea value={strVal} onChange={(e) => onChange(e.target.value)} rows={2} />
      ) : field.type === "select" ? (
        <Select value={strVal} onValueChange={onChange}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {field.options?.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : field.type === "boolean" ? (
        <div className="flex items-center h-10">
          <Checkbox checked={Boolean(value)} onCheckedChange={(v) => onChange(Boolean(v))} />
          <span className="ml-2 text-sm text-muted-foreground">Yes</span>
        </div>
      ) : (
        <Input
          type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
          inputMode={field.type === "number" ? "decimal" : undefined}
          value={
            field.type === "number"
              ? (value === 0 || value === null || value === undefined || value === "" ? "" : String(value))
              : strVal
          }
          placeholder={field.type === "number" ? "0" : undefined}
          onChange={(e) => {
            if (field.type === "number") {
              const v = e.target.value;
              onChange(v === "" ? 0 : Number(v));
            } else {
              onChange(field.format ? applyFormat(field.format, e.target.value) : e.target.value);
            }
          }}
          onFocus={(e) => { if (field.type === "number" && e.target.value === "0") e.target.select(); }}
          onBlur={(e) => {
            if (field.format === "name") onChange(capitalizeWords(e.target.value));
          }}
          required={field.required}
          readOnly={isEntryBy}
          className={isEntryBy ? "bg-muted text-muted-foreground" : undefined}
        />
      )}
    </div>
  );
}

