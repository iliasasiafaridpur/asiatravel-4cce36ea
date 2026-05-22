import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pencil, Plus, Settings2, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";

export type LookupKind = string;

const LABELS: Record<string, string> = {
  country: "দেশ",
  airline: "এয়ারলাইন্স",
  sub_agency: "Sub Agency / Reference",
  vendor: "Vendor",
  route: "Route / Airport",
  service_item: "Service Item",
  visa_type: "Visa Type",
  medical_status: "Medical Status",
  rl_no: "RL No",
  bmet_status: "BMET Status",
  status_visa: "Status",
  status_bmet: "Status",
  status_delivery: "Status",
  status: "Status",
  ledger_service_type: "Service Type",
  payment_method: "মাধ্যম",
  expense_category: "ক্যাটাগরি",
};

interface Props {
  kind: LookupKind;
  value: string;
  onChange: (v: string) => void;
  /** Built-in seed values that always appear (cannot be deleted from DB). */
  defaults?: string[];
  /** Hide the Add (+) and Manage (gear) buttons; render only the Select. */
  compact?: boolean;
}

// Module-level cache shared across selects
const cache: Record<string, string[]> = {};
const listeners: Record<string, Set<() => void>> = {};

function notify(kind: string) {
  listeners[kind]?.forEach((fn) => fn());
}

async function loadKind(kind: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("lookups")
    .select("value")
    .eq("kind", kind)
    .order("value");
  if (error) {
    toast.error("লোড করতে সমস্যা: " + error.message);
    return [];
  }
  const vs = (data ?? []).map((r) => String(r.value));
  cache[kind] = vs;
  return vs;
}

export function LookupSelect({ kind, value, onChange, defaults, compact }: Props) {
  const [options, setOptions] = useState<string[]>(cache[kind] ?? []);
  const [openAdd, setOpenAdd] = useState(false);
  const [openManage, setOpenManage] = useState(false);
  const [newVal, setNewVal] = useState("");
  const [renamingOrig, setRenamingOrig] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const label = LABELS[kind] ?? kind;

  useEffect(() => {
    let alive = true;
    if (cache[kind] === undefined) {
      void loadKind(kind).then((vs) => { if (alive) setOptions(vs); });
    }
    if (!listeners[kind]) listeners[kind] = new Set();
    const fn = () => setOptions(cache[kind] ?? []);
    listeners[kind].add(fn);
    return () => { alive = false; listeners[kind]?.delete(fn); };
  }, [kind]);

  const addNew = () => {
    const v = newVal.trim();
    if (!v) return;
    if (!(cache[kind] ?? []).includes(v)) {
      cache[kind] = [...(cache[kind] ?? []), v].sort((a, b) => a.localeCompare(b));
      notify(kind);
    }
    onChange(v);
    setNewVal("");
    setOpenAdd(false);
    void supabase.from("lookups").insert({ kind, value: v }).then(({ error }) => {
      if (error) {
        cache[kind] = (cache[kind] ?? []).filter((x) => x !== v);
        notify(kind);
        toast.error(error.message);
      } else {
        toast.success(`${label} যোগ হয়েছে`);
      }
    });
  };

  const removeOne = async (v: string) => {
    if (!confirm(`"${v}" ডিলিট করবেন?`)) return;
    const { error } = await supabase.from("lookups").delete().eq("kind", kind).eq("value", v);
    if (error) { toast.error(error.message); return; }
    cache[kind] = (cache[kind] ?? []).filter((x) => x !== v);
    // also track deletion of defaults so they don't reappear after reload
    if ((defaults ?? []).includes(v)) {
      const key = `lookup_hidden_defaults:${kind}`;
      try {
        const cur: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
        if (!cur.includes(v)) localStorage.setItem(key, JSON.stringify([...cur, v]));
      } catch { /* ignore */ }
    }
    notify(kind);
    if (value === v) onChange("");
    toast.success("ডিলিট হয়েছে");
  };

  const renameOne = async (oldVal: string, rawNew: string) => {
    const nv = rawNew.trim();
    if (!nv || nv === oldVal) { setRenamingOrig(null); return; }
    const existing = [...(cache[kind] ?? []), ...(defaults ?? [])];
    if (existing.includes(nv)) { toast.error("এই নামটি ইতিমধ্যে আছে"); return; }
    const wasDefault = (defaults ?? []).includes(oldVal);
    if (wasDefault) {
      const { error } = await supabase.from("lookups").insert({ kind, value: nv });
      if (error) { toast.error(error.message); return; }
      const key = `lookup_hidden_defaults:${kind}`;
      try {
        const cur: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
        if (!cur.includes(oldVal)) localStorage.setItem(key, JSON.stringify([...cur, oldVal]));
      } catch { /* ignore */ }
      cache[kind] = [...(cache[kind] ?? []), nv].sort((a, b) => a.localeCompare(b));
    } else {
      const { error } = await supabase.from("lookups").update({ value: nv }).eq("kind", kind).eq("value", oldVal);
      if (error) { toast.error(error.message); return; }
      cache[kind] = (cache[kind] ?? []).map((x) => x === oldVal ? nv : x).sort((a, b) => a.localeCompare(b));
    }
    notify(kind);
    if (value === oldVal) onChange(nv);
    setRenamingOrig(null);
    setRenameVal("");
    toast.success("রিনেম হয়েছে");
  };

  // Filter out defaults the user has previously deleted
  let effectiveDefaults = defaults ?? [];
  try {
    const hidden: string[] = JSON.parse(
      (typeof window !== "undefined" ? localStorage.getItem(`lookup_hidden_defaults:${kind}`) : null) ?? "[]"
    );
    if (hidden.length) effectiveDefaults = effectiveDefaults.filter((d) => !hidden.includes(d));
  } catch { /* ignore */ }

  // Always-present built-ins per kind (cannot be hidden/removed)
  const alwaysOn: string[] = kind === "sub_agency" ? ["Self"] : [];

  // Merge always-on + effective defaults + DB options + current value (de-duped, always-on first)
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const v of alwaysOn) { if (!seen.has(v)) { merged.push(v); seen.add(v); } }
  for (const v of effectiveDefaults) { if (!seen.has(v)) { merged.push(v); seen.add(v); } }
  for (const v of options) { if (!seen.has(v)) { merged.push(v); seen.add(v); } }
  if (value && !seen.has(value)) merged.unshift(value);

  // For Manage dialog: show every visible option (both defaults and DB-added) with delete
  const manageList = merged.filter((o) => o !== value || true); // all
  const isDefault = (o: string) => effectiveDefaults.includes(o);

  return (
    <>
      <div className="flex gap-1.5">
        <Select value={value || ""} onValueChange={onChange}>
          <SelectTrigger className="flex-1"><SelectValue placeholder={`-- ${label} --`} /></SelectTrigger>
          <SelectContent>
            {merged.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">কোনো অপশন নেই</div>
            ) : (
              merged.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)
            )}
          </SelectContent>
        </Select>
        {!compact && (
          <>
            <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => setOpenAdd(true)} title={`নতুন ${label} যোগ`}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => setOpenManage(true)} title={`${label} ম্যানেজ`}>
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>

      <Dialog open={openAdd} onOpenChange={setOpenAdd}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>নতুন {label} যোগ করুন</DialogTitle>
          </DialogHeader>
          <Input
            value={newVal}
            onChange={(e) => setNewVal(e.target.value)}
            placeholder={label}
            onKeyDown={(e) => { if (e.key === "Enter") void addNew(); }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenAdd(false)}>বাতিল</Button>
            <Button onClick={addNew} disabled={!newVal.trim()}>যোগ করুন</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openManage} onOpenChange={setOpenManage}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{label} ম্যানেজ করুন</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto divide-y">
            {manageList.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">কোনো অপশন নেই</div>
            ) : manageList.map((o) => (
              <div key={o} className="flex items-center justify-between py-2 gap-2">
                {renamingOrig === o ? (
                  <>
                    <Input
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void renameOne(o, renameVal);
                        if (e.key === "Escape") { setRenamingOrig(null); setRenameVal(""); }
                      }}
                      autoFocus
                      className="h-8 text-sm"
                    />
                    <div className="flex gap-1 shrink-0">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => void renameOne(o, renameVal)} title="সেভ">
                        <Check className="h-4 w-4 text-emerald-600" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setRenamingOrig(null); setRenameVal(""); }} title="বাতিল">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-sm truncate">
                      {o}
                      {isDefault(o) && <span className="ml-2 text-xs text-muted-foreground">(ডিফল্ট)</span>}
                    </span>
                    <div className="flex gap-1 shrink-0">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setRenamingOrig(o); setRenameVal(o); }} title="রিনেম">
                        <Pencil className="h-4 w-4 text-blue-600" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => void removeOne(o)} title="ডিলিট">
                        <Trash2 className="h-4 w-4 text-rose-500" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenManage(false)}>বন্ধ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
