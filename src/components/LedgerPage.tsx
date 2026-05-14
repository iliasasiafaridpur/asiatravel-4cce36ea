import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { generateNextId } from "@/lib/idgen";
import { formatDate, type ModuleSchema, type Field } from "@/lib/modules";
import { LookupSelect } from "@/components/LookupSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  Plus, Pencil, Trash2, Search, Wallet, RotateCcw, Eye, CreditCard,
  CalendarRange, ChevronsUpDown, Check, FileSpreadsheet, Printer,
  TrendingUp, TrendingDown, Receipt,
} from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { FormSections } from "@/components/ModulePage";
import { cn } from "@/lib/utils";

type Row = Record<string, unknown> & { id: string };

interface Props { module: ModuleSchema }

const todayIso = () => new Date().toISOString().slice(0, 10);

function emptyForm(mod: ModuleSchema): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  for (const field of mod.fields) {
    if (field.type === "number") f[field.name] = 0;
    else if (field.type === "boolean") f[field.name] = false;
    else if (field.type === "date" && field.name === "entry_date") f[field.name] = todayIso();
    else f[field.name] = "";
  }
  return f;
}

function selectColumns(mod: ModuleSchema): string {
  const cols = new Set(["id", mod.idColumn, "created_at", "created_by"]);
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

export function LedgerPage({ module: mod }: Props) {
  const { user, profile } = useCurrentUser();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [dueOnly, setDueOnly] = useState(false);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>(() => emptyForm(mod));
  const [saving, setSaving] = useState(false);
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);
  const [viewRow, setViewRow] = useState<Row | null>(null);
  const [datePopover, setDatePopover] = useState(false);
  const [agentPopover, setAgentPopover] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<string>("");
  const [payDue, setPayDue] = useState<number>(0);
  const [payDate, setPayDate] = useState<string>(todayIso());
  const [payAmount, setPayAmount] = useState<string>("");
  const [payRemarks, setPayRemarks] = useState<string>("");
  const [paySaving, setPaySaving] = useState(false);
  const loadingRef = useRef(false);
  const cacheKey = `cache_v2_${mod.table}`;
  const columns = useMemo(() => selectColumns(mod), [mod]);

  const groupField = mod.groupBy?.field ?? "agent_name";
  const groupLabel = mod.groupBy?.label ?? "Agent";
  const isAgency = mod.key === "agency-ledger";
  const billCol = isAgency ? "total_bill" : "total_payable";
  const paidCol = isAgency ? "received_amount" : "paid_amount";
  const billLabel = isAgency ? "Total Bill" : "Total Payable";
  const paidLabel = isAgency ? "Total Received" : "Total Paid";
  const payTitle = isAgency ? "পেমেন্ট গ্রহণ এন্ট্রি" : "পেমেন্ট পরিশোধ এন্ট্রি";
  const payAmountLabel = isAgency ? "Received Amount" : "Paid Amount";
  const groupFieldLabel = isAgency ? "Agent Name" : "Vendor Name";

  // Form schema with country_route lookup switching based on selected service_type.
  const formMod = useMemo<ModuleSchema>(() => {
    const svc = String(form.service_type ?? "").toUpperCase();
    const isBmet = svc.includes("BMET");
    const lookupKind = isBmet ? "country" : "route";
    const newLabel = isBmet ? "Country" : svc.includes("VISA") ? "Country" : "Route";
    const fields: Field[] = mod.fields.map((f) =>
      f.name === "country_route"
        ? { ...f, label: newLabel, lookup: lookupKind }
        : f,
    );
    return { ...mod, fields };
  }, [mod, form.service_type]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const cached = JSON.parse(raw) as Row[];
        if (Array.isArray(cached)) { setRows(cached); setLoading(false); }
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mod.table]);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const { data, error } = await supabase
        .from(mod.table as never)
        .select(columns)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const list = ((data as unknown) as Row[]) ?? [];
      setRows(list);
      try { localStorage.setItem(cacheKey, JSON.stringify(list)); } catch { /* ignore */ }
    } catch (e) {
      toast.error("লোড সমস্যা: " + errMsg(e));
    }
    loadingRef.current = false;
    setLoading(false);
  }, [mod.table, columns, cacheKey]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel(`rt_${mod.table}`)
      .on("postgres_changes", { event: "*", schema: "public", table: mod.table }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [mod.table, load]);

  const balanceOf = (r: Row) => Number(r[billCol] ?? 0) - Number(r[paidCol] ?? 0);

  const filtered = useMemo(() => {
    let xs = rows;
    if (groupFilter !== "all") xs = xs.filter((r) => String(r[groupField] ?? "") === groupFilter);
    if (dueOnly) xs = xs.filter((r) => balanceOf(r) > 0);
    if (startDate) xs = xs.filter((r) => String(r.entry_date ?? "").slice(0, 10) >= startDate);
    if (endDate) xs = xs.filter((r) => String(r.entry_date ?? "").slice(0, 10) <= endDate);
    const q = search.trim().toLowerCase();
    if (q) xs = xs.filter((r) => Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q)));
    return xs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, groupFilter, dueOnly, startDate, endDate, search]);

  const totals = useMemo(() => {
    let bill = 0, paid = 0;
    for (const r of filtered) {
      bill += Number(r[billCol] ?? 0);
      paid += Number(r[paidCol] ?? 0);
    }
    return { bill, paid, due: bill - paid };
  }, [filtered, billCol, paidCol]);

  const groupSummary = useMemo(() => {
    const map = new Map<string, { bill: number; paid: number }>();
    for (const r of filtered) {
      const k = String(r[groupField] ?? "—") || "—";
      const cur = map.get(k) ?? { bill: 0, paid: 0 };
      cur.bill += Number(r[billCol] ?? 0);
      cur.paid += Number(r[paidCol] ?? 0);
      map.set(k, cur);
    }
    return Array.from(map.entries())
      .map(([key, v]) => ({ key, bill: v.bill, paid: v.paid, due: v.bill - v.paid }))
      .sort((a, b) => b.due - a.due);
  }, [filtered, groupField, billCol, paidCol]);

  const groupOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => { const v = String(r[groupField] ?? ""); if (v) set.add(v); });
    return Array.from(set).sort();
  }, [rows, groupField]);

  // ---- form actions ----
  const startCreate = () => {
    setEditing(null);
    const f = emptyForm(mod);
    if (mod.fields.some((fld) => fld.name === "entry_by")) f.entry_by = displayName(profile, user);
    setForm(f);
    setOpenForm(true);
  };

  const startEdit = (r: Row) => {
    setEditing(r);
    const f: Record<string, unknown> = {};
    for (const field of mod.fields) f[field.name] = r[field.name] ?? (field.type === "number" ? 0 : "");
    setForm(f);
    setOpenForm(true);
  };

  const openPayment = (groupKey: string, dueAmount: number) => {
    setPayTarget(groupKey);
    setPayDue(dueAmount);
    setPayAmount(String(dueAmount > 0 ? dueAmount : ""));
    setPayDate(todayIso());
    setPayRemarks("");
    setPayOpen(true);
  };

  const submitPayment = async () => {
    const amt = Number(payAmount);
    if (!payTarget) return toast.error(`${groupFieldLabel} নির্বাচন করুন`);
    if (!amt || amt <= 0) return toast.error("সঠিক টাকার পরিমাণ দিন");
    setPaySaving(true);
    try {
      const me = displayName(profile, user);
      const finalId = await generateNextId(mod);
      const payload: Record<string, unknown> = {
        [mod.idColumn]: finalId,
        entry_date: payDate,
        [groupField]: payTarget,
        passenger_name: isAgency ? "পেমেন্ট গ্রহণ" : "পেমেন্ট পরিশোধ",
        service_type: "PAYMENT",
        country_route: "",
        [billCol]: 0,
        [paidCol]: amt,
        remarks: `${payRemarks ? payRemarks + " · " : ""}Entry by: ${me}`,
      };
      if (user?.id) payload.created_by = user.id;
      const { error } = await supabase.from(mod.table as never).insert(payload as never);
      if (error) throw error;
      toast.success(`✓ ${payTitle} সংরক্ষিত: ${amt.toLocaleString()}`);
      setPayOpen(false);
      void load();
    } catch (e) {
      toast.error("সমস্যা: " + errMsg(e));
    } finally {
      setPaySaving(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    const payload: Record<string, unknown> = {};
    for (const field of mod.fields) {
      const v = form[field.name];
      if (field.type === "number") payload[field.name] = Number(v) || 0;
      else if (field.type === "boolean") payload[field.name] = Boolean(v);
      else if (field.type === "date") payload[field.name] = v ? v : null;
      else payload[field.name] = v ?? null;
    }
    if (user?.id && !editing) (payload as Record<string, unknown>).created_by = user.id;

    const isEdit = !!editing;
    const editId = editing?.id;
    const finalId = !isEdit ? await generateNextId(mod) : undefined;
    if (finalId) (payload as Record<string, unknown>)[mod.idColumn] = finalId;

    setOpenForm(false);
    setSaving(false);

    try {
      if (isEdit && editId) {
        const { error } = await supabase.from(mod.table as never).update(payload as never).eq("id", editId);
        if (error) throw error;
        toast.success("আপডেট হয়েছে");
      } else {
        const { error } = await supabase.from(mod.table as never).insert(payload as never);
        if (error) throw error;
        toast.success(`✓ যোগ হয়েছে: ${finalId}`);
      }
      void load();
    } catch (e) {
      toast.error("সমস্যা: " + errMsg(e));
    }
  };

  const confirmDelete = async () => {
    if (!deleteRow) return;
    const { error } = await supabase.from(mod.table as never).delete().eq("id", deleteRow.id);
    if (error) toast.error("ডিলিট সমস্যা: " + error.message);
    else { toast.success("ডিলিট হয়েছে"); await load(); }
    setDeleteRow(null);
  };

  // ---- export ----
  const exportCsv = () => {
    const headers = [mod.idColumn, "entry_date", groupField, "passenger_name", "service_type", "country_route", billCol, paidCol, "balance_due", "remarks"];
    const lines = [headers.join(",")];
    for (const r of filtered) {
      const bal = balanceOf(r);
      const vals = [
        r[mod.idColumn], r.entry_date, r[groupField], r.passenger_name,
        r.service_type, r.country_route, r[billCol], r[paidCol], bal, r.remarks,
      ].map((v) => {
        const s = String(v ?? "");
        return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
      });
      lines.push(vals.join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${mod.key}-${todayIso()}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const printPage = () => window.print();

  const resetFilters = () => {
    setSearch(""); setGroupFilter("all"); setDueOnly(false); setStartDate(""); setEndDate("");
  };

  const dateLabel = startDate || endDate
    ? `${startDate || "শুরু"} → ${endDate || "শেষ"}`
    : "Date Range";

  return (
    <div className="space-y-4 print:space-y-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-start sm:justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{mod.label}</h1>
          <p className="text-sm text-muted-foreground">মোট {rows.length} এন্ট্রি · দেখানো হচ্ছে {filtered.length}</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button onClick={startCreate} className="gap-1.5">
            <Plus className="h-4 w-4" /> নতুন এন্ট্রি
          </Button>
          <Button onClick={() => openPayment("", 0)} variant="secondary" className="gap-1.5">
            <Receipt className="h-4 w-4" /> {payTitle}
          </Button>
        </div>
      </div>

      {/* Print header */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">Asia Travel — {mod.label}</h1>
        <p className="text-xs text-muted-foreground">
          {startDate || endDate ? `${startDate || "—"} to ${endDate || "—"}` : "All dates"} · {filtered.length} entries
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 print:grid-cols-3">
        <Card className="border-border/60">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">{billLabel}</span>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">৳ {totals.bill.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-emerald-600 dark:text-emerald-400 font-semibold">{paidLabel}</span>
              <TrendingDown className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">৳ {totals.paid.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card className={cn("border-rose-500/50", totals.due > 0 ? "bg-rose-500/10" : "bg-muted/20")}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-rose-600 dark:text-rose-400 font-semibold">Total Due</span>
              <Wallet className="h-4 w-4 text-rose-600 dark:text-rose-400" />
            </div>
            <div className={cn("mt-2 text-3xl font-extrabold tabular-nums", totals.due > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
              ৳ {totals.due.toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter bar */}
      <Card className="print:hidden">
        <CardContent className="p-3">
          <div className="flex flex-col lg:flex-row gap-2 lg:items-center">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="খুঁজুন..."
                className="pl-9 h-10"
              />
            </div>

            {/* Date range popover */}
            <Popover open={datePopover} onOpenChange={setDatePopover}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="h-10 gap-1.5 justify-start lg:w-auto w-full font-normal">
                  <CalendarRange className="h-4 w-4" />
                  <span className="truncate">{dateLabel}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3" align="start">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Start Date</Label>
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">End Date</Label>
                    <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9" />
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Button size="sm" variant="secondary" onClick={() => {
                      const d = new Date(); d.setDate(d.getDate() - 6);
                      setStartDate(d.toISOString().slice(0, 10)); setEndDate(todayIso());
                    }}>7 দিন</Button>
                    <Button size="sm" variant="secondary" onClick={() => {
                      const d = new Date(); setStartDate(new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)); setEndDate(todayIso());
                    }}>এই মাস</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setStartDate(""); setEndDate(""); }}>Clear</Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {/* Searchable group dropdown */}
            <Popover open={agentPopover} onOpenChange={setAgentPopover}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="h-10 gap-1.5 justify-between lg:w-56 w-full font-normal">
                  <span className="truncate">{groupFilter === "all" ? `সব ${groupLabel}` : groupFilter}</span>
                  <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <Command>
                  <CommandInput placeholder={`${groupLabel} খুঁজুন...`} />
                  <CommandList>
                    <CommandEmpty>পাওয়া যায়নি</CommandEmpty>
                    <CommandGroup>
                      <CommandItem onSelect={() => { setGroupFilter("all"); setAgentPopover(false); }}>
                        <Check className={cn("mr-2 h-4 w-4", groupFilter === "all" ? "opacity-100" : "opacity-0")} />
                        সব {groupLabel}
                      </CommandItem>
                      {groupOptions.map((o) => (
                        <CommandItem key={o} value={o} onSelect={() => { setGroupFilter(o); setAgentPopover(false); }}>
                          <Check className={cn("mr-2 h-4 w-4", groupFilter === o ? "opacity-100" : "opacity-0")} />
                          {o}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            <div className="flex gap-1.5">
              <Button variant={dueOnly ? "default" : "outline"} onClick={() => setDueOnly((v) => !v)} className="h-10 gap-1.5">
                <Wallet className="h-4 w-4" /> শুধু Due
              </Button>
              <Button variant="outline" size="icon" onClick={resetFilters} className="h-10 w-10" title="Reset">
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Group summary */}
      {groupSummary.length > 0 && (
        <Card className="print:hidden">
          <CardContent className="p-3 sm:p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{groupLabel} অনুযায়ী Due সারাংশ ({groupSummary.length})</h3>
            </div>
            <div className="overflow-x-auto rounded-md border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{groupLabel}</TableHead>
                    <TableHead className="text-right">{billLabel}</TableHead>
                    <TableHead className="text-right">{paidLabel}</TableHead>
                    <TableHead className="text-right">Due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupSummary.map((g) => (
                    <TableRow key={g.key}>
                      <TableCell className="font-medium py-3">{g.key}</TableCell>
                      <TableCell className="text-right tabular-nums">{g.bill.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{g.paid.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        {g.due > 0 ? (
                          <button
                            type="button"
                            onClick={() => openPayment(g.key, g.due)}
                            className="inline-flex items-center gap-1 text-rose-500 hover:underline font-semibold tabular-nums"
                            title="পেমেন্ট পরিশোধ"
                          >
                            {g.due.toLocaleString()} <Wallet className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <Badge variant="outline" className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400">Paid</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main ledger table */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center justify-between mb-3 print:hidden">
            <h3 className="text-sm font-semibold">{mod.label} এন্ট্রি ({filtered.length})</h3>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5 h-8" title="Export CSV">
                <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
              </Button>
              <Button variant="outline" size="sm" onClick={printPage} className="gap-1.5 h-8" title="Print / Save PDF">
                <Printer className="h-3.5 w-3.5" /> Print
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-md border border-border/60">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">ID</TableHead>
                  <TableHead className="whitespace-nowrap">Date</TableHead>
                  <TableHead className="whitespace-nowrap">{groupLabel}</TableHead>
                  <TableHead className="whitespace-nowrap">Passenger / Service</TableHead>
                  <TableHead className="text-right whitespace-nowrap">{billLabel}</TableHead>
                  <TableHead className="text-right whitespace-nowrap">{paidLabel}</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Balance Due</TableHead>
                  <TableHead className="text-right whitespace-nowrap print:hidden">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">লোড হচ্ছে...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">কোনো এন্ট্রি পাওয়া যায়নি</TableCell></TableRow>
                ) : filtered.map((r) => {
                  const bal = balanceOf(r);
                  const passenger = String(r.passenger_name ?? "");
                  const service = String(r.service_type ?? "");
                  const cr = String(r.country_route ?? "");
                  const svcUpper = service.toUpperCase();
                  const crLabel = svcUpper.includes("BMET") || svcUpper.includes("VISA")
                    ? "Country" : svcUpper.includes("TICKET") ? "Route" : "";
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap py-3.5">{String(r[mod.idColumn] ?? "")}</TableCell>
                      <TableCell className="whitespace-nowrap py-3.5">{formatDate(r.entry_date as string | null)}</TableCell>
                      <TableCell className="whitespace-nowrap py-3.5 font-medium">{String(r[groupField] ?? "")}</TableCell>
                      <TableCell className="py-3.5 min-w-[180px]">
                        <div className="font-medium leading-tight">{passenger || "—"}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          {service && <span>{service}</span>}
                          {service && cr && <span className="opacity-50">·</span>}
                          {cr && <span>{crLabel ? `${crLabel}: ` : ""}{cr}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums py-3.5">{Number(r[billCol] ?? 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums py-3.5 text-emerald-600 dark:text-emerald-400">{Number(r[paidCol] ?? 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right py-3.5">
                        {bal > 0 ? (
                          <span className="font-semibold tabular-nums text-rose-400">{bal.toLocaleString()}</span>
                        ) : bal === 0 ? (
                          <Badge variant="outline" className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400">Paid</Badge>
                        ) : (
                          <span className="tabular-nums text-amber-500">{bal.toLocaleString()}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right py-3.5 print:hidden">
                        <div className="flex justify-end gap-0.5">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setViewRow(r)} title="View">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {bal > 0 && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600" onClick={() => openPayment(String(r[groupField] ?? ""), bal)} title="Quick Pay">
                              <CreditCard className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(r)} title="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDeleteRow(r)} title="Delete">
                            <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Form dialog */}
      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "এডিট করুন" : "নতুন এন্ট্রি"} — {mod.label}</DialogTitle>
          </DialogHeader>
          <FormSections mod={mod} form={form} setForm={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)}>বাতিল</Button>
            <Button onClick={submit} disabled={saving}>{saving ? "সেভ হচ্ছে..." : "সেভ"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View dialog */}
      <Dialog open={!!viewRow} onOpenChange={(o) => !o && setViewRow(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>এন্ট্রি বিস্তারিত — {String(viewRow?.[mod.idColumn] ?? "")}</DialogTitle>
          </DialogHeader>
          {viewRow && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              {mod.fields.map((f) => {
                const v = viewRow[f.name];
                const display = f.type === "date" ? formatDate(v as string | null) : f.type === "number" ? Number(v ?? 0).toLocaleString() : String(v ?? "—");
                return (
                  <div key={f.name} className="space-y-0.5">
                    <div className="text-xs text-muted-foreground">{f.label}</div>
                    <div className="font-medium break-words">{display || "—"}</div>
                  </div>
                );
              })}
              <div className="space-y-0.5 col-span-2 pt-2 border-t border-border/60">
                <div className="text-xs text-muted-foreground">Balance Due</div>
                <div className={cn("text-lg font-bold tabular-nums", balanceOf(viewRow) > 0 ? "text-rose-500" : "text-emerald-600")}>
                  ৳ {balanceOf(viewRow).toLocaleString()}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewRow(null)}>বন্ধ করুন</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
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
    </div>
  );
}
