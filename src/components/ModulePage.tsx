import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { Plus, Pencil, Trash2, Search, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { PassportScanner, type PassportFields } from "@/components/PassportScanner";
import { speakModuleEntry, speakReceived, speakDelivery } from "@/lib/voice";
import { DueReceiveDialog, type DueReceivePreselect } from "@/components/DueReceiveDialog";

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

function emptyForm(mod: ModuleSchema): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  for (const field of mod.fields) {
    if (field.type === "number") f[field.name] = 0;
    else if (field.type === "boolean") f[field.name] = false;
    else if (field.type === "date" && field.name === "entry_date") f[field.name] = todayIso();
    else if (field.type === "select") f[field.name] = field.defaultEmpty ? "" : (field.options?.[0] ?? "");
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
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>(() => emptyForm(mod));
  const [saving, setSaving] = useState(false);
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);
  const [duePreselect, setDuePreselect] = useState<DueReceivePreselect | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const reloadQueuedRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const cacheKey = `cache_v2_${mod.table}`;
  const columns = useMemo(() => selectColumns(mod), [mod]);

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

  const filtered = useMemo(() => {
    let xs = rows;
    if (statusFilter !== "all") xs = xs.filter((r) => r.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      xs = xs.filter((r) =>
        Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q))
      );
    }
    return xs;
  }, [rows, search, statusFilter]);

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
    if (mod.fields.some((fld) => fld.name === "entry_by")) {
      f.entry_by = displayName(profile, user);
    }
    setForm(f);
    setOpenForm(true);
  };

  const submit = async () => {
    setSaving(true);
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
      if (!editing) (payload as Record<string, unknown>).created_by = user.id;
      if (recvAmount > 0) (payload as Record<string, unknown>).received_by = user.id;
    }
    if (hasField("entry_by")) (payload as Record<string, unknown>).entry_by = me;

    if (mod.deriveStatus && hasField("status")) {
      const derived = mod.deriveStatus(payload);
      if (derived !== undefined) (payload as Record<string, unknown>).status = derived;
    }

    const isEdit = !!editing;
    const editId = editing?.id;
    const finalId = !isEdit ? await generateNextId(mod) : undefined;
    if (finalId) (payload as Record<string, unknown>)[mod.idColumn] = finalId;

    // Close immediately for snappy UX
    setOpenForm(false);
    setSaving(false);

    // Optimistic local update
    if (isEdit && editId) {
      setRows((prev) => prev.map((r) => (r.id === editId ? { ...r, ...payload } as Row : r)));
    } else {
      const tempId = `tmp-${Date.now()}`;
      setRows((prev) => [{ id: tempId, ...payload } as Row, ...prev]);
    }

    // Persist in background
    void (async () => {
      try {
        if (isEdit && editId) {
          const { error } = await supabase.from(mod.table as never).update(payload as never).eq("id", editId);
          if (error) throw error;
          toast.success("আপডেট হয়েছে");
          // Voice: delivery status transition
          const prevStatus = String(editing?.status ?? "");
          const newStatus = String((payload as Record<string, unknown>).status ?? "");
          if (newStatus && newStatus !== prevStatus && /deliver/i.test(newStatus)) {
            speakDelivery(String((payload as Record<string, unknown>).passenger_name ?? ""));
          }
          if (recvAmount > 0 && Number(editing?.received ?? editing?.received_amount ?? editing?.paid_amount ?? 0) !== recvAmount) {
            speakReceived(recvAmount);
          }
        } else {
          const { error } = await supabase.from(mod.table as never).insert(payload as never);
          if (error) throw error;
          toast.success(`✓ যোগ হয়েছে: ${finalId}`);
          speakModuleEntry(mod.key);
          if (recvAmount > 0) speakReceived(recvAmount);
        }
        void load();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error("সমস্যা: " + msg);
        void load();
      }
    })();
  };

  const confirmDelete = async () => {
    if (!deleteRow) return;
    const { error } = await supabase.from(mod.table as never).delete().eq("id", deleteRow.id);
    if (error) toast.error("ডিলিট করতে সমস্যা: " + error.message);
    else { toast.success("ডিলিট হয়েছে"); await load(); }
    setDeleteRow(null);
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

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpenForm(false)}>বাতিল</Button>
              <Button onClick={submit} disabled={saving}>{saving ? "সেভ হচ্ছে..." : "সেভ"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="খুঁজুন... (নাম, পাসপোর্ট, ID যেকোনো ফিল্ড)"
                className="pl-8"
              />
            </div>
            {mod.statuses && (
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">সব Status</SelectItem>
                  {mod.statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">{mod.idColumn}</TableHead>
                  {listCols.map((c) => (
                    <TableHead
                      key={c.kind === "field" ? c.field.name : c.comp.name}
                      className={`whitespace-nowrap ${c.kind === "computed" ? "text-right" : ""}`}
                    >
                      {c.kind === "field" ? c.field.label : c.comp.label}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={listCols.length + 2} className="text-center text-muted-foreground py-8">লোড হচ্ছে...</TableCell></TableRow>
                ) : loadError ? (
                  <TableRow>
                    <TableCell colSpan={listCols.length + 2} className="text-center py-8">
                      <div className="space-y-2">
                        <p className="text-sm text-destructive">লোড করতে সমস্যা: {loadError}</p>
                        <Button type="button" variant="outline" size="sm" onClick={() => void load(true)}>আবার লোড করুন</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={listCols.length + 2} className="text-center text-muted-foreground py-8">কোনো এন্ট্রি পাওয়া যায়নি</TableCell></TableRow>
                ) : filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{String(r[mod.idColumn] ?? "")}</TableCell>
                    {listCols.map((c) => {
                      if (c.kind === "computed") {
                        const v = c.comp.compute(r);
                        // Due কলাম হলে — ক্লিক করলে Due Receive ডায়লগ খুলবে
                        const isDue = c.comp.name === "due" && v > 0 && DUE_SERVICE_KEY[mod.key];
                        return (
                          <TableCell key={c.comp.name} className="text-right tabular-nums whitespace-nowrap">
                            {isDue ? (
                              <button
                                type="button"
                                onClick={() => setDuePreselect({ serviceKey: DUE_SERVICE_KEY[mod.key], rowId: r.id })}
                                className="inline-flex items-center gap-1 text-rose-500 hover:underline font-semibold"
                                title="Due Receive"
                              >
                                {v.toLocaleString()} <Wallet className="h-3.5 w-3.5" />
                              </button>
                            ) : (
                              <span className={v < 0 ? "text-rose-500" : v > 0 ? "text-emerald-600" : ""}>{v.toLocaleString()}</span>
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
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => startEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteRow(r)}><Trash2 className="h-3.5 w-3.5 text-rose-500" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
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
  const sections: Section[] = ["passenger", "agency", "vendor"];
  const grouped = sections
    .map((s) => ({ section: s, fields: mod.fields.filter((f) => (f.section ?? "passenger") === s) }))
    .filter((g) => g.fields.length > 0);
  // If no field uses sections at all, render as one block (e.g. agents/vendors/ledgers).
  const usesSections = mod.fields.some((f) => f.section);
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
      {(usesSections ? grouped : [{ section: "passenger" as Section, fields: mod.fields }]).map((g) => (
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
        <LookupSelect kind={field.lookup} value={strVal} onChange={(v) => onChange(v)} />
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

