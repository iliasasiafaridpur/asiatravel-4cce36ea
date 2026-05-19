import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SERVICE_CATEGORIES, moduleByKey } from "@/lib/modules";
import { supabase } from "@/integrations/supabase/client";
import { generateNextId } from "@/lib/idgen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Search } from "lucide-react";
import { toast } from "sonner";
import { FormSections } from "@/components/ModulePage";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { useFormDraft } from "@/hooks/useFormDraft";
import { speakModuleEntry, speakReceived } from "@/lib/voice";

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

  const mod = moduleByKey(category)!;

  // Auto-save draft per category
  const { clear: clearDraft } = useFormDraft(`action-board:${category}`, form, setForm, true);

  // Keep entry_by in sync once the user/profile resolves
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

      // Audit fields
      const me = displayName(profile, user);
      const recvAmount = ["received", "received_amount", "paid_amount"]
        .reduce((s, c) => s + Number((payload as Record<string, unknown>)[c] ?? 0), 0);
      if (user?.id) {
        (payload as Record<string, unknown>).created_by = user.id;
        if (recvAmount > 0) (payload as Record<string, unknown>).received_by = user.id;
      }
      if (hasField("entry_by") && (!payload.entry_by || payload.entry_by === "User")) (payload as Record<string, unknown>).entry_by = me;
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
      setForm(emptyForm(category, me));
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
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Action Board</h1>
        <p className="text-sm text-muted-foreground">যেকোনো সার্ভিসের জন্য দ্রুত এন্ট্রি — নিচে Service Category সিলেক্ট করুন</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="inline-block h-2 w-2 rounded-full bg-primary" /> সার্ভিস ক্যাটাগরি
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <Label>Service Category</Label>
              <Select value={category} onValueChange={onCategoryChange}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SERVICE_CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 flex sm:items-end gap-2">
              <Button onClick={save} disabled={saving} className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700">
                <Save className="h-4 w-4" /> {saving ? "Saving..." : "SAVE DATA"}
              </Button>
              <Button variant="secondary" onClick={() => navigate({ to: `/${mod.key}` as string })} className="gap-2">
                <Search className="h-4 w-4" /> SEARCH
              </Button>
            </div>
          </div>

          {/* Same 3-section form as the edit dialog */}
          <div className="border-t border-border pt-2">
            <FormSections mod={mod} form={form} setForm={setForm} />
          </div>

          <div className="flex justify-end pt-2 border-t border-border">
            <Button onClick={save} disabled={saving} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
              <Save className="h-4 w-4" /> {saving ? "Saving..." : "SAVE DATA"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
