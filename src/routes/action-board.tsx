import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SERVICE_CATEGORIES, moduleByKey } from "@/lib/modules";
import { supabase } from "@/integrations/supabase/client";
import { resilientInsert } from "@/lib/offline-queue";
import { generateNextId } from "@/lib/idgen";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Save, Search, RotateCcw, Keyboard, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FormSections, type ExtraServiceRow } from "@/components/ModulePage";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LookupSelect } from "@/components/LookupSelect";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { useFormDraft } from "@/hooks/useFormDraft";
import { speakModuleEntry, speakReceived, speakDelivery } from "@/lib/voice";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/action-board")({
  head: () => ({ meta: [{ title: "Action Board — নতুন এন্ট্রি" }] }),
  component: ActionBoardPage,
});

const todayIso = () => new Date().toISOString().slice(0, 10);
const EXTRA_SERVICE_MODULES = ["tickets", "bmet", "saudi-visa", "kuwait-visa", "other"];
const RECV_META: Record<string, { recvCol: string; serviceType: string }> = {
  tickets: { recvCol: "received", serviceType: "Ticket" },
  bmet_cards: { recvCol: "received_amount", serviceType: "BMET Card" },
  saudi_visas: { recvCol: "received_amount", serviceType: "Saudi Visa" },
  kuwait_visas: { recvCol: "received", serviceType: "Kuwait Visa" },
  others: { recvCol: "received_amount", serviceType: "Other" },
};

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    return String(o.message ?? o.details ?? o.hint ?? JSON.stringify(o));
  }
  return String(e);
}

function emptyForm(modKey: string, entryBy = ""): Record<string, unknown> {
  const mod = moduleByKey(modKey)!;
  const f: Record<string, unknown> = {};
  for (const field of mod.fields) {
    if (field.type === "number") f[field.name] = 0;
    else if (field.type === "boolean") f[field.name] = false;
    else if (field.type === "date" && field.name === "entry_date") f[field.name] = todayIso();
    else if (field.type === "select") f[field.name] = field.defaultEmpty ? "" : (field.options?.[0] ?? "");
    else if (field.lookup === "sub_agency") f[field.name] = "Self";
    else if (field.name === "entry_by") f[field.name] = entryBy;
    else f[field.name] = "";
  }
  return f;
}

function isDeliveryStatus(status: unknown) {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "delivered" || s === "delivery" || s === "delivery but due";
}

function ActionBoardPage() {
  const navigate = useNavigate();
  const { user, profile } = useCurrentUser();
  const me = displayName(profile, user);
  const [category, setCategory] = useState(SERVICE_CATEGORIES[0].key);
  const [form, setForm] = useState<Record<string, unknown>>(() => emptyForm(SERVICE_CATEGORIES[0].key));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const formRef = useRef<HTMLDivElement>(null);
  const [extraServices, setExtraServices] = useState<ExtraServiceRow[]>([]);
  const [showExtra, setShowExtra] = useState(false);

  const mod = moduleByKey(category)!;
  const supportsExtra = EXTRA_SERVICE_MODULES.includes(category);

  const { clear: clearDraft } = useFormDraft(`action-board:${category}`, form, setForm, true);

  useEffect(() => {
    setForm((prev) => (prev.entry_by && prev.entry_by !== "User" ? prev : { ...prev, entry_by: me }));
  }, [me]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const root = formRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>('input:not([readonly]):not([disabled])');
      first?.focus();
    }, 50);
    return () => window.clearTimeout(t);
  }, [category]);

  const onCategoryChange = (v: string) => {
    setCategory(v);
    setForm(emptyForm(v, me));
    setExtraServices([]);
    setShowExtra(false);
  };

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

    for (const ex of extraServices) {
      const name = (ex.service_name || "").trim();
      if (!name) continue;
      await supabase.from("extra_services" as never).insert({
        ...base,
        service_name: name,
        service_price: Number(ex.service_price) || 0,
        received_amount: Number(ex.received_amount) || 0,
        vendor_cost: Number(ex.vendor_cost) || 0,
        notes: (ex.notes || "").trim() || null,
      } as never);
    }
  }, [extraServices, mod.table, supportsExtra, user?.id]);

  const insertReceiptRow = useCallback(async (opts: {
    rowId: string;
    refId: string;
    passengerName: string;
    amount: number;
    entryDate?: string | null;
  }) => {
    const meta = RECV_META[mod.table];
    if (!user?.id || !meta || opts.amount <= 0) return;
    let receiptId: string;
    try {
      receiptId = await generateNextId({
        key: "_rcpt", label: "", short: "", table: "payment_receipts",
        idColumn: "receipt_id", idPrefix: "RCPT", monthlyId: true, fields: [],
      });
    } catch {
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yy = String(d.getFullYear()).slice(-2);
      receiptId = `RCPT-${mm}${yy}-OFFLINE-${Date.now().toString().slice(-6)}`;
    }
    await resilientInsert("payment_receipts", {
      receipt_id: receiptId,
      entry_date: opts.entryDate || todayIso(),
      service_type: meta.serviceType,
      service_table: mod.table,
      service_row_id: opts.rowId,
      ref_id: opts.refId,
      passenger_name: opts.passengerName || "—",
      amount: opts.amount,
      method: "Cash",
      source: "form_receive",
      remarks: "Action Board entry receive",
      received_by: user.id,
      received_by_name: displayName(profile, user),
      created_by: user.id,
    });
  }, [mod.table, profile, user]);

  const insertStatusEventRow = useCallback(async (opts: {
    rowId: string;
    refId: string;
    passengerName: string;
    status: string;
    entryDate?: string | null;
  }) => {
    const meta = RECV_META[mod.table];
    if (!user?.id || !meta || !isDeliveryStatus(opts.status)) return;
    let receiptId: string;
    try {
      receiptId = await generateNextId({
        key: "_rcpt", label: "", short: "", table: "payment_receipts",
        idColumn: "receipt_id", idPrefix: "RCPT", monthlyId: true, fields: [],
      });
    } catch {
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yy = String(d.getFullYear()).slice(-2);
      receiptId = `RCPT-${mm}${yy}-OFFLINE-${Date.now().toString().slice(-6)}`;
    }
    await resilientInsert("payment_receipts", {
      receipt_id: receiptId,
      entry_date: opts.entryDate || todayIso(),
      service_type: meta.serviceType,
      service_table: mod.table,
      service_row_id: opts.rowId,
      ref_id: opts.refId,
      passenger_name: opts.passengerName || "—",
      amount: 0,
      method: "Status",
      source: "status_event",
      remarks: `Status: ${opts.status}`,
      received_by: user.id,
      received_by_name: displayName(profile, user),
      created_by: user.id,
    });
  }, [mod.table, profile, user]);

  const save = useCallback(async () => {
    if (savingRef.current) return toast.info("আগের সেভটি শেষ হচ্ছে, একটু অপেক্ষা করুন");
    savingRef.current = true;
    setSaving(true);
    const timeout = window.setTimeout(() => {
      savingRef.current = false;
      setSaving(false);
      toast.error("সেভ হতে বেশি সময় নিচ্ছে। ইন্টারনেট চেক করে আবার চেষ্টা করুন।");
    }, 12000);
    try {
      const payload: Record<string, unknown> = {};
      const hasField = (n: string) => mod.fields.some((f) => f.name === n);
      for (const f of mod.fields) {
        const v = form[f.name];
        if (f.type === "number") payload[f.name] = Number(v) || 0;
        else if (f.type === "boolean") payload[f.name] = Boolean(v);
        else if (f.type === "date") payload[f.name] = v ? v : null;
        else payload[f.name] = v ?? null;
        if (f.required && !payload[f.name]) {
          toast.error(`${f.label} দিন`);
          window.clearTimeout(timeout);
          savingRef.current = false;
          setSaving(false);
          return;
        }
      }

      const meName = displayName(profile, user);
      const recvCols = ["received", "received_amount", "paid_amount"];
      const recvAmount = recvCols.reduce((s, c) => s + Number((payload as Record<string, unknown>)[c] ?? 0), 0);
      if (user?.id) {
        (payload as Record<string, unknown>).created_by = user.id;
        if (recvAmount > 0) (payload as Record<string, unknown>).received_by = user.id;
      }
      // Auto-capture payment date when money is received but none was entered.
      if (hasField("payment_date") && recvAmount > 0 && !payload.payment_date) {
        (payload as Record<string, unknown>).payment_date =
          (payload.entry_date as string) || todayIso();
      }
      if (hasField("entry_by") && (!payload.entry_by || payload.entry_by === "User")) {
        (payload as Record<string, unknown>).entry_by = meName;
      }
      if (mod.deriveStatus && hasField("status")) {
        const derived = mod.deriveStatus(payload);
        if (derived !== undefined) (payload as Record<string, unknown>).status = derived;
      }

      const entryDateForId = typeof payload.entry_date === "string" ? (payload.entry_date as string) : undefined;
      const newId = await generateNextId(mod, entryDateForId);
      payload[mod.idColumn] = newId;
      await resilientInsert(mod.table, payload);

      const { data: inserted } = await supabase
        .from(mod.table as never)
        .select("id")
        .eq(mod.idColumn, newId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const rowId = (inserted as { id: string } | null)?.id;

      if (rowId) {
        if (supportsExtra && extraServices.some((x) => (x.service_name || "").trim())) {
          try { await syncExtraServices(rowId, payload); } catch { /* best effort */ }
        }
        if (recvAmount > 0) {
          try {
            await insertReceiptRow({
              rowId,
              refId: newId,
              passengerName: String(payload.passenger_name ?? ""),
              amount: recvAmount,
              entryDate: String(payload.payment_date ?? payload.entry_date ?? todayIso()),
            });
          } catch { /* best effort */ }
        }
        if (isDeliveryStatus(payload.status)) {
          try {
            await insertStatusEventRow({
              rowId,
              refId: newId,
              passengerName: String(payload.passenger_name ?? ""),
              status: String(payload.status ?? ""),
              entryDate: String(payload.delivery_date ?? payload.entry_date ?? todayIso()),
            });
          } catch { /* best effort */ }
        }
      }

      window.clearTimeout(timeout);
      toast.success(`Saved: ${newId}`);
      speakModuleEntry(mod.key);
      if (recvAmount > 0) speakReceived(recvAmount);
      if (isDeliveryStatus(payload.status)) speakDelivery(String(payload.passenger_name ?? ""));
      clearDraft();
      setForm(emptyForm(category, meName));
      setExtraServices([]);
      setShowExtra(false);
      window.setTimeout(() => {
        const first = formRef.current?.querySelector<HTMLElement>('input:not([readonly]):not([disabled])');
        first?.focus();
      }, 60);
    } catch (e) {
      window.clearTimeout(timeout);
      toast.error("সমস্যা: " + errMsg(e));
    } finally {
      window.clearTimeout(timeout);
      savingRef.current = false;
      setSaving(false);
    }
  }, [mod, form, profile, user, clearDraft, category, extraServices, supportsExtra, syncExtraServices, insertReceiptRow, insertStatusEventRow]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
        return;
      }
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        navigate({ to: `/${mod.key}` as string });
        return;
      }
      if (e.altKey && !meta && /^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        const c = SERVICE_CATEGORIES[idx];
        if (c) {
          e.preventDefault();
          onCategoryChange(c.key);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save, mod.key]);

  return (
    <div className="max-w-5xl mx-auto space-y-3">
      <div className="sticky top-0 z-20 -mx-2 px-2 pt-2 pb-2 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 border-b">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold leading-tight truncate">Action Board</h1>
            <p className="text-[11px] text-muted-foreground hidden sm:flex items-center gap-1">
              <Keyboard className="h-3 w-3" /> Ctrl+S সেভ · Ctrl+K সার্চ · Alt+1-9 ক্যাটাগরি · Enter পরের ফিল্ড
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                clearDraft();
                setForm(emptyForm(category, me));
                setExtraServices([]);
                setShowExtra(false);
                toast.success("ফর্ম খালি");
              }}
              className="h-8 gap-1 px-2"
              title="Clear"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Clear</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate({ to: `/${mod.key}` as string })}
              className="h-8 gap-1 px-2"
              title="Ctrl+K"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Search</span>
            </Button>
            <Button
              onClick={save}
              disabled={saving}
              size="sm"
              className="h-8 gap-1 px-3 bg-emerald-600 hover:bg-emerald-700"
              title="Ctrl+S"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>

        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5 scrollbar-thin">
          {SERVICE_CATEGORIES.map((c, i) => (
            <button
              key={c.key}
              type="button"
              onClick={() => onCategoryChange(c.key)}
              className={cn(
                "shrink-0 h-7 px-3 rounded-full text-xs font-medium border transition-colors whitespace-nowrap",
                category === c.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-foreground/80 border-border hover:bg-accent",
              )}
              title={`Alt+${i + 1}`}
            >
              <span className="opacity-60 mr-1">{i + 1}</span>{c.label}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-3 sm:p-4">
          <div ref={formRef}>
            <FormSections mod={mod} form={form} setForm={setForm} />
            {supportsExtra && (
              <ExtraServiceSectionLocal
                rows={extraServices}
                setRows={setExtraServices}
                show={showExtra}
                setShow={setShowExtra}
                vendorName={String(form.vendor_bought ?? "")}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ExtraServiceSectionLocal({ rows, setRows, show, setShow, vendorName }: {
  rows: ExtraServiceRow[];
  setRows: React.Dispatch<React.SetStateAction<ExtraServiceRow[]>>;
  show: boolean;
  setShow: React.Dispatch<React.SetStateAction<boolean>>;
  vendorName: string;
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

