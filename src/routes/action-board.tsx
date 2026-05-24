import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SERVICE_CATEGORIES, moduleByKey } from "@/lib/modules";
import { supabase } from "@/integrations/supabase/client";
import { resilientInsert } from "@/lib/offline-queue";
import { generateNextId } from "@/lib/idgen";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Save, Search, RotateCcw, Keyboard } from "lucide-react";
import { toast } from "sonner";
import { FormSections } from "@/components/ModulePage";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { useFormDraft } from "@/hooks/useFormDraft";
import { speakModuleEntry, speakReceived } from "@/lib/voice";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/action-board")({
  head: () => ({ meta: [{ title: "Action Board — নতুন এন্ট্রি" }] }),
  component: ActionBoardPage,
});

const todayIso = () => new Date().toISOString().slice(0, 10);

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

function ActionBoardPage() {
  const navigate = useNavigate();
  const { user, profile } = useCurrentUser();
  const me = displayName(profile, user);
  const [category, setCategory] = useState(SERVICE_CATEGORIES[0].key);
  const [form, setForm] = useState<Record<string, unknown>>(() => emptyForm(SERVICE_CATEGORIES[0].key));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const formRef = useRef<HTMLDivElement>(null);

  const mod = moduleByKey(category)!;

  const { clear: clearDraft } = useFormDraft(`action-board:${category}`, form, setForm, true);

  useEffect(() => {
    setForm((prev) => (prev.entry_by && prev.entry_by !== "User" ? prev : { ...prev, entry_by: me }));
  }, [me]);

  // Auto-focus first real input on category change / mount
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
  };

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
      const recvAmount = ["received", "received_amount", "paid_amount"]
        .reduce((s, c) => s + Number((payload as Record<string, unknown>)[c] ?? 0), 0);
      if (user?.id) {
        (payload as Record<string, unknown>).created_by = user.id;
        if (recvAmount > 0) (payload as Record<string, unknown>).received_by = user.id;
      }
      if (hasField("entry_by") && (!payload.entry_by || payload.entry_by === "User")) (payload as Record<string, unknown>).entry_by = meName;
      if (mod.deriveStatus && hasField("status")) {
        const derived = mod.deriveStatus(payload);
        if (derived !== undefined) (payload as Record<string, unknown>).status = derived;
      }

      const newId = await generateNextId(mod);
      payload[mod.idColumn] = newId;
      const { offline } = await resilientInsert(mod.table, payload);
      window.clearTimeout(timeout);
      if (!offline) {
        toast.success(`Saved: ${newId}`);
        speakModuleEntry(mod.key);
        if (recvAmount > 0) speakReceived(recvAmount);
      }
      clearDraft();
      setForm(emptyForm(category, meName));
      // Re-focus first field for the next quick entry
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
  }, [mod, form, profile, user, clearDraft, category]);

  // Global shortcuts: Ctrl/Cmd+S save, Ctrl/Cmd+K search, Alt+1..9 category
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save, mod.key]);

  return (
    <div className="max-w-5xl mx-auto space-y-3">
      {/* Sticky top action bar */}
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
              onClick={() => { clearDraft(); setForm(emptyForm(category, me)); toast.success("ফর্ম খালি"); }}
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

        {/* Category chip bar */}
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
