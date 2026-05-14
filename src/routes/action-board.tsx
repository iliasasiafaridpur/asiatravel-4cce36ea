import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SERVICE_CATEGORIES, moduleByKey } from "@/lib/modules";
import { supabase } from "@/integrations/supabase/client";
import { generateNextId } from "@/lib/idgen";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, Search, Plane, IdCard, Globe2, ClipboardList, Zap, Layers, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { FormSections } from "@/components/ModulePage";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { speakModuleEntry, speakReceived } from "@/lib/voice";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export const Route = createFileRoute("/action-board")({
  head: () => ({ meta: [{ title: "Action Board — নতুন এন্ট্রি" }] }),
  component: ActionBoardPage,
});

const todayIso = () => new Date().toISOString().slice(0, 10);

const CAT_META: Record<string, { icon: LucideIcon; tint: string }> = {
  tickets:       { icon: Plane,  tint: "from-sky-500 to-blue-600" },
  bmet:          { icon: IdCard, tint: "from-emerald-500 to-teal-600" },
  "saudi-visa":  { icon: Globe2, tint: "from-amber-500 to-orange-600" },
  "kuwait-visa": { icon: Globe2, tint: "from-violet-500 to-purple-600" },
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
  const [savedToday, setSavedToday] = useState(0);

  const savingRef = useRef(false);
  const mod = moduleByKey(category)!;
  const ActiveIcon = CAT_META[category]?.icon ?? ClipboardList;
  const activeTint = CAT_META[category]?.tint ?? "from-primary to-primary/70";

  useEffect(() => {
    setForm((prev) => (prev.entry_by && prev.entry_by !== "User" ? prev : { ...prev, entry_by: me }));
  }, [me]);

  const onCategoryChange = (v: string) => {
    setCategory(v);
    setForm(emptyForm(v, me));
  };

  const save = async () => {
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
      const { error } = await supabase.from(mod.table as never).insert(payload as never);
      if (error) throw error;
      window.clearTimeout(timeout);
      toast.success(`Saved: ${newId}`);
      speakModuleEntry(mod.key);
      if (recvAmount > 0) speakReceived(recvAmount);
      setSavedToday((n) => n + 1);
      setForm(emptyForm(category, meName));
    } catch (e) {
      window.clearTimeout(timeout);
      toast.error("সমস্যা: " + errMsg(e));
    } finally {
      window.clearTimeout(timeout);
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Hero header */}
      <div
        className="rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-primary-foreground"
        style={{ background: "var(--gradient-hero)", boxShadow: "var(--shadow-glow)" }}
      >
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <Zap className="h-6 w-6" /> Action Board
          </h1>
          <p className="text-sm opacity-90 mt-1 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            যেকোনো সার্ভিসের দ্রুত এন্ট্রি — এক ক্লিকে SAVE
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="gap-1 px-3 py-1.5">
            <ClipboardList className="h-3.5 w-3.5" /> আজ সেভ: <b className="tabular-nums">{savedToday}</b>
          </Badge>
          <Badge variant="secondary" className="gap-1 px-3 py-1.5">
            👤 {me}
          </Badge>
        </div>
      </div>

      {/* Category pills */}
      <Card>
        <CardContent className="p-3 sm:p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <Layers className="h-3.5 w-3.5" /> Service Category
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {SERVICE_CATEGORIES.map((c) => {
              const meta = CAT_META[c.key];
              const Icon = meta?.icon ?? ClipboardList;
              const active = c.key === category;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => onCategoryChange(c.key)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-all flex items-center gap-2.5",
                    active
                      ? `bg-gradient-to-br text-white border-transparent shadow-md ${meta?.tint}`
                      : "bg-card hover:border-primary/40 hover:shadow-sm"
                  )}
                >
                  <div className={cn(
                    "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
                    active ? "bg-white/20" : "bg-muted"
                  )}>
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs opacity-80">নতুন এন্ট্রি</p>
                    <p className="font-semibold text-sm truncate">{c.label}</p>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              onClick={save}
              disabled={saving}
              className={cn("flex-1 gap-2 bg-gradient-to-r text-white shadow-md hover:opacity-95", activeTint)}
            >
              <Save className="h-4 w-4" /> {saving ? "Saving..." : `SAVE ${mod.short ?? mod.label}`}
            </Button>
            <Button variant="outline" onClick={() => navigate({ to: `/${mod.key}` as string })} className="gap-2">
              <Search className="h-4 w-4" /> খুঁজুন
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Form */}
      <Card>
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-border">
            <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center text-white bg-gradient-to-br shrink-0", activeTint)}>
              <ActiveIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">এন্ট্রি ফর্ম</p>
              <p className="font-semibold text-sm">{mod.label}</p>
            </div>
            <Badge variant="outline" className="ml-auto text-[10px]">{mod.fields.length} ফিল্ড</Badge>
          </div>

          <FormSections mod={mod} form={form} setForm={setForm} />

          <div className="flex justify-end pt-3 border-t border-border">
            <Button
              onClick={save}
              disabled={saving}
              className={cn("gap-2 bg-gradient-to-r text-white shadow-md hover:opacity-95", activeTint)}
            >
              <Save className="h-4 w-4" /> {saving ? "Saving..." : "SAVE DATA"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Helper Label re-export to keep old import surface
export { Label };
