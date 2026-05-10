import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SERVICE_CATEGORIES, moduleByKey } from "@/lib/modules";
import { supabase } from "@/integrations/supabase/client";
import { generateNextId } from "@/lib/idgen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/action-board")({
  head: () => ({ meta: [{ title: "Action Board — নতুন এন্ট্রি" }] }),
  component: ActionBoardPage,
});

const todayIso = () => new Date().toISOString().slice(0, 10);

function ActionBoardPage() {
  const navigate = useNavigate();
  const [category, setCategory] = useState(SERVICE_CATEGORIES[0].key);
  const [form, setForm] = useState<Record<string, unknown>>({ entry_date: todayIso() });
  const [saving, setSaving] = useState(false);

  const mod = moduleByKey(category)!;

  const onCategoryChange = (v: string) => {
    setCategory(v);
    setForm({ entry_date: todayIso() });
  };

  const set = (k: string, v: unknown) => setForm((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const f of mod.fields) {
        const v = form[f.name];
        if (f.type === "number") payload[f.name] = Number(v) || 0;
        else if (f.type === "boolean") payload[f.name] = Boolean(v);
        else if (f.type === "date") payload[f.name] = v ? v : null;
        else payload[f.name] = v ?? null;
        if (f.required && !payload[f.name]) {
          toast.error(`${f.label} দিন`);
          setSaving(false);
          return;
        }
      }
      const newId = await generateNextId(mod);
      payload[mod.idColumn] = newId;
      const { error } = await supabase.from(mod.table as never).insert(payload as never);
      if (error) throw error;
      toast.success(`Saved: ${newId}`);
      setForm({ entry_date: todayIso() });
    } catch (e) {
      toast.error("সমস্যা: " + (e instanceof Error ? e.message : String(e)));
    } finally {
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border">
            {mod.fields.map((f) => (
              <div key={f.name} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
                <Label>{f.label}{f.required && <span className="text-rose-500"> *</span>}</Label>
                <div className="mt-1.5">
                  {f.type === "textarea" ? (
                    <Textarea value={(form[f.name] as string) ?? ""} onChange={(e) => set(f.name, e.target.value)} rows={2} />
                  ) : f.type === "select" ? (
                    <Select value={(form[f.name] as string) ?? f.options?.[0] ?? ""} onValueChange={(v) => set(f.name, v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {f.options?.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : f.type === "boolean" ? (
                    <div className="flex items-center h-10">
                      <Checkbox checked={Boolean(form[f.name])} onCheckedChange={(v) => set(f.name, Boolean(v))} />
                      <span className="ml-2 text-sm text-muted-foreground">Yes</span>
                    </div>
                  ) : (
                    <Input
                      type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                      value={f.type === "number" ? (form[f.name] as number) ?? 0 : (form[f.name] as string) ?? ""}
                      onChange={(e) => set(f.name, f.type === "number" ? Number(e.target.value) : e.target.value)}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
