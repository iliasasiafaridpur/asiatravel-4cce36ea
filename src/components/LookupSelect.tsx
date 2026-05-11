import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";

export type LookupKind = "country" | "airline" | "sub_agency" | "vendor";

const LABELS: Record<LookupKind, string> = {
  country: "দেশ",
  airline: "এয়ারলাইন্স",
  sub_agency: "Sub Agency / Reference",
  vendor: "Vendor",
};

interface Props {
  kind: LookupKind;
  value: string;
  onChange: (v: string) => void;
}

// Module-level cache so multiple selects share data.
const cache: Partial<Record<LookupKind, string[]>> = {};
const listeners: Partial<Record<LookupKind, Set<() => void>>> = {};

function notify(kind: LookupKind) {
  listeners[kind]?.forEach((fn) => fn());
}

async function loadKind(kind: LookupKind): Promise<string[]> {
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

export function LookupSelect({ kind, value, onChange }: Props) {
  const [options, setOptions] = useState<string[]>(cache[kind] ?? []);
  const [openAdd, setOpenAdd] = useState(false);
  const [openManage, setOpenManage] = useState(false);
  const [newVal, setNewVal] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!cache[kind]) {
      void loadKind(kind).then((vs) => {
        if (alive) setOptions(vs);
      });
    }
    if (!listeners[kind]) listeners[kind] = new Set();
    const fn = () => setOptions(cache[kind] ?? []);
    listeners[kind]!.add(fn);
    return () => {
      alive = false;
      listeners[kind]?.delete(fn);
    };
  }, [kind]);

  const addNew = async () => {
    const v = newVal.trim();
    if (!v) return;
    setSaving(true);
    const { error } = await supabase.from("lookups").insert({ kind, value: v });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    cache[kind] = [...(cache[kind] ?? []), v].sort((a, b) => a.localeCompare(b));
    notify(kind);
    onChange(v);
    setNewVal("");
    setOpenAdd(false);
    toast.success(`${LABELS[kind]} যোগ হয়েছে`);
  };

  // Ensure current value (even if not in cache yet) is selectable.
  const allOpts = value && !options.includes(value) ? [value, ...options] : options;

  return (
    <>
      <div className="flex gap-1.5">
        <Select value={value || ""} onValueChange={onChange}>
          <SelectTrigger className="flex-1"><SelectValue placeholder={`-- ${LABELS[kind]} --`} /></SelectTrigger>
          <SelectContent>
            {allOpts.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">কোনো অপশন নেই</div>
            ) : (
              allOpts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)
            )}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" size="icon" onClick={() => setOpenAdd(true)} title={`নতুন ${LABELS[kind]} যোগ`}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={openAdd} onOpenChange={setOpenAdd}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>নতুন {LABELS[kind]} যোগ করুন</DialogTitle>
          </DialogHeader>
          <Input
            value={newVal}
            onChange={(e) => setNewVal(e.target.value)}
            placeholder={LABELS[kind]}
            onKeyDown={(e) => { if (e.key === "Enter") void addNew(); }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenAdd(false)}>বাতিল</Button>
            <Button onClick={addNew} disabled={saving || !newVal.trim()}>{saving ? "সেভ..." : "যোগ করুন"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
