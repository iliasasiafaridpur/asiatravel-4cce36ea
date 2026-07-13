import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Pencil, Plus, Settings2, Trash2, Check, X, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { cn } from "@/lib/utils";
import { partyCodePrefix, partySerialCode } from "@/lib/format";

export type LookupKind = string;

const PARTY_LOOKUP_KIND: Record<string, "customer" | "vendor"> = {
  sub_agency: "customer",
  vendor: "vendor",
};

// Lookup kinds backed by a পরিচিতি বোর্ড table that carries a serial / ID.
// Their dropdowns show "AGT-001 · Name" / "VEN-003 · Name" and are searchable
// by either the ID number or the name. (Agency "Self" has no ID.)
const PARTY_SERIAL_KIND: Record<string, "agent" | "vendor"> = {
  sub_agency: "agent",
  vendor: "vendor",
};

const normName = (s: string) => s.trim().replace(/[\s\-_,.]+/g, " ").toLowerCase();

// name(normalized) → serial_no, per party table. Loaded once, cached, and
// shared across every party select on the page.
const partyCache: Record<string, Record<string, number>> = {};
const partyListeners: Record<string, Set<() => void>> = {};

async function loadParty(pk: "agent" | "vendor"): Promise<void> {
  const table = pk === "agent" ? "agents" : "vendors";
  const { data } = await supabase.from(table).select("name,serial_no").limit(5000);
  const map: Record<string, number> = {};
  (((data as { name?: string | null; serial_no?: number | null }[] | null) ?? [])).forEach((r) => {
    const n = String(r.name ?? "").trim();
    if (n && r.serial_no != null) map[normName(n)] = Number(r.serial_no);
  });
  partyCache[pk] = map;
  partyListeners[pk]?.forEach((fn) => fn());
}

function partyTable(pk: "agent" | "vendor"): "agents" | "vendors" {
  return pk === "agent" ? "agents" : "vendors";
}

function partyPrefix(pk: "agent" | "vendor"): string {
  return partyCodePrefix(pk);
}

// "A-001" style ID for a party name (or "" when not found).
function partyId(pk: "agent" | "vendor", name: string): string {
  const serial = partyCache[pk]?.[normName(name)];
  if (serial == null) return "";
  return partySerialCode(pk, serial);
}

// Display label "AGT-001 · Name" (plain name when no ID / for "Self").
function partyDisplay(pk: "agent" | "vendor", name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return name;
  if (pk === "agent" && trimmed.toLowerCase() === "self") return name;
  const id = partyId(pk, trimmed);
  return id ? `${id} · ${trimmed}` : trimmed;
}

const LABELS: Record<string, string> = {
  country: "দেশ",
  airline: "এয়ারলাইন্স",
  sub_agency: "Sub Agency / Reference",
  vendor: "Vendor",
  route: "Route / Airport",
  service_item: "Service Item",
  extra_service: "Extra Service",
  other_service: "Service Name",
  visa_type: "Visa Type",
  medical_status: "Medical Status",
  rl_no: "RL No",
  bmet_status: "BMET Status",
  status_visa: "Status",
  status_bmet: "Status",
  status_delivery: "Status",
  status_other: "Status",
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
  const partyKind = PARTY_SERIAL_KIND[kind];
  if (partyKind) {
    const { data, error } = await supabase
      .from(partyTable(partyKind))
      .select("name")
      .order("name")
      .limit(5000);
    if (error) {
      toast.error("লোড করতে সমস্যা: " + error.message);
      return [];
    }
    const vs = ((data as { name?: string | null }[] | null) ?? [])
      .map((r) => String(r.name ?? "").trim())
      .filter((v) => v && !(partyKind === "agent" && v.toLowerCase() === "self"));
    cache[kind] = vs;
    return vs;
  }
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
  const { profile } = useCurrentUser();
  const [options, setOptions] = useState<string[]>(cache[kind] ?? []);
  const [openAdd, setOpenAdd] = useState(false);
  const [openManage, setOpenManage] = useState(false);
  const [newVal, setNewVal] = useState("");
  const [renamingOrig, setRenamingOrig] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const label = LABELS[kind] ?? kind;
  const partyKind = PARTY_SERIAL_KIND[kind];
  // re-render tick: bumped when the party serial cache loads
  const [, setPartyTick] = useState(0);

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

  // Load + subscribe to the party serial map so labels show "ID · Name".
  useEffect(() => {
    if (!partyKind) return;
    let alive = true;
    if (partyCache[partyKind] === undefined) void loadParty(partyKind);
    if (!partyListeners[partyKind]) partyListeners[partyKind] = new Set();
    const fn = () => { if (alive) setPartyTick((t) => t + 1); };
    partyListeners[partyKind].add(fn);
    return () => { alive = false; partyListeners[partyKind]?.delete(fn); };
  }, [partyKind]);


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
    if (partyKind) {
      void supabase
        .from(partyTable(partyKind))
        .insert({ name: v } as never)
        .select("name,serial_no")
        .single()
        .then(async ({ error }) => {
          if (error) {
            if (error.code === "23505") {
              toast.info(`${label} আগে থেকেই আছে`);
              await loadParty(partyKind);
              return;
            }
            cache[kind] = (cache[kind] ?? []).filter((x) => x !== v);
            notify(kind);
            toast.error(error.message);
            return;
          }
          await loadParty(partyKind);
          cache[kind] = await loadKind(kind);
          notify(kind);
          toast.success(`${label} যোগ হয়েছে`);
        });
      return;
    }
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
    const partyKind = PARTY_LOOKUP_KIND[kind];
    if (partyKind) {
      const { error } = await supabase.rpc("rename_party", {
        p_kind: partyKind,
        p_old_name: oldVal,
        p_new_name: nv,
      });
      if (error) { toast.error(error.message); return; }
      const current = cache[kind] ?? [];
      cache[kind] = (current.includes(oldVal)
        ? current.map((x) => x === oldVal ? nv : x)
        : [...current, nv]
      ).sort((a, b) => a.localeCompare(b));
    } else {
      // Non-party dropdowns (country, airline, route/trip road, visa type, …):
      // cascade the rename to EVERY booking/ledger row that stores the old
      // text so nothing is left pointing at the previous name.
      const { error } = await supabase.rpc("rename_lookup", {
        p_kind: kind,
        p_old_value: oldVal,
        p_new_value: nv,
      });
      if (error) { toast.error(error.message); return; }
      if (wasDefault) {
        // A built-in default has no lookups row until now; hide the old default
        // so it no longer reappears alongside the new value.
        const key = `lookup_hidden_defaults:${kind}`;
        try {
          const cur: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
          if (!cur.includes(oldVal)) localStorage.setItem(key, JSON.stringify([...cur, oldVal]));
        } catch { /* ignore */ }
        cache[kind] = [...(cache[kind] ?? []).filter((x) => x !== oldVal), nv].sort((a, b) => a.localeCompare(b));
      } else {
        cache[kind] = (cache[kind] ?? []).map((x) => x === oldVal ? nv : x).sort((a, b) => a.localeCompare(b));
      }
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
      <div className="flex gap-1.5 min-w-0">
        {partyKind ? (
          <PartyCombobox
            pk={partyKind}
            label={label}
            value={value}
            options={merged}
            onChange={onChange}
          />
        ) : (
          <Select value={value || ""} onValueChange={onChange}>
            <SelectTrigger className="flex-1 min-w-0"><SelectValue placeholder={`-- ${label} --`} /></SelectTrigger>
            <SelectContent>
              {merged.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">কোনো অপশন নেই</div>
              ) : (
                merged.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)
              )}
            </SelectContent>
          </Select>
        )}

        {!compact && (
          <>
            <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => setOpenAdd(true)} title={`নতুন ${label} যোগ`}>
              <Plus className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => setOpenManage(true)} title={`${label} ম্যানেজ`}>
              <Settings2 className="h-4 w-4" />
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
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                        if (profile?.role !== "admin") {
                          toast.error("আপনার ডিলিট করার অনুমতি নেই। Admin-এর সাথে যোগাযোগ করুন।");
                          return;
                        }
                        void removeOne(o);
                      }} title="ডিলিট">
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

// Searchable agency/vendor picker. Shows "AGT-001 · Name" and filters by either
// the ID number or the name (any substring). Stores the plain name as value so
// no other code / data changes are needed.
function PartyCombobox({ pk, label, value, options, onChange }: {
  pk: "agent" | "vendor";
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex-1 min-w-0 justify-between font-normal",
            !value && "text-muted-foreground",
          )}
        >
          <span className="truncate">
            {value ? partyDisplay(pk, value) : `-- ${label} --`}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[min(22rem,90vw)]" align="start">
        <Command
          filter={(itemValue, search) => {
            // itemValue already contains both the ID and the name (see below).
            return itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="ID বা নাম দিয়ে খুঁজুন…" />
          <CommandList
            className="max-h-[280px] overflow-y-auto overscroll-contain"
            onWheel={(e) => e.stopPropagation()}
          >
            <CommandEmpty>কিছু পাওয়া যায়নি</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const id = partyId(pk, o);
                const selected = o === value;
                return (
                  <CommandItem
                    key={o}
                    value={`${id} ${o}`}
                    onSelect={() => { onChange(o); setOpen(false); }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", selected ? "opacity-100" : "opacity-0")} />
                    <span className="flex items-center gap-1.5 truncate">
                      {id && (
                        <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[11px] font-bold text-amber-600 dark:text-amber-400">
                          {id}
                        </span>
                      )}
                      <span className="truncate">{o}</span>
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

