import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, Loader2 } from "lucide-react";

/** One searchable module: table + id column + the columns we pull + how it looks in the route. */
type ModuleCfg = {
  key: string;
  label: string;
  table: string;
  idCol: string;
  path: string;
  /** Columns to select — MUST all exist on the table (kuwait_visas has no visa_type, etc.) */
  cols: string;
  /** Columns to run ilike against. */
  searchCols: string[];
  /** Secondary sub-line fields (first non-empty wins). */
  subExtraCol?: string;
  color: string;
};

const MODULE_CFG: ModuleCfg[] = [
  { key: "tickets", label: "Air Ticket", table: "tickets", idCol: "ticket_id", path: "/tickets",
    cols: "ticket_id,passenger_name,passport,mobile,airline,trip_road,agency_sold,vendor_bought,status",
    searchCols: ["ticket_id","passenger_name","passport","mobile","airline","trip_road","agency_sold","vendor_bought"],
    subExtraCol: "trip_road",
    color: "text-cyan-600 dark:text-cyan-400" },
  { key: "bmet", label: "BMET Card", table: "bmet_cards", idCol: "bmet_id", path: "/bmet",
    cols: "bmet_id,passenger_name,passport,mobile,country_name,agency_sold,vendor_bought,status",
    searchCols: ["bmet_id","passenger_name","passport","mobile","country_name","agency_sold","vendor_bought"],
    subExtraCol: "country_name",
    color: "text-emerald-600 dark:text-emerald-400" },
  { key: "saudi-visa", label: "Saudi Visa", table: "saudi_visas", idCol: "saudi_id", path: "/saudi-visa",
    cols: "saudi_id,passenger_name,passport,mobile,visa_type,agency_sold,vendor_bought,status",
    searchCols: ["saudi_id","passenger_name","passport","mobile","visa_type","agency_sold","vendor_bought"],
    subExtraCol: "visa_type",
    color: "text-orange-600 dark:text-orange-400" },
  { key: "kuwait-visa", label: "Kuwait Visa", table: "kuwait_visas", idCol: "kuwait_id", path: "/kuwait-visa",
    cols: "kuwait_id,passenger_name,passport,mobile,agency_sold,vendor_bought,status",
    searchCols: ["kuwait_id","passenger_name","passport","mobile","agency_sold","vendor_bought"],
    color: "text-violet-600 dark:text-violet-400" },
  { key: "other", label: "Other", table: "others", idCol: "other_id", path: "/other",
    cols: "other_id,passenger_name,passport,mobile,service_name,agency_sold,vendor_bought,status",
    searchCols: ["other_id","passenger_name","passport","mobile","service_name","agency_sold","vendor_bought"],
    subExtraCol: "service_name",
    color: "text-fuchsia-600 dark:text-fuchsia-400" },
];

type Item = {
  key: string;
  label: string;
  path: string;
  color: string;
  id: string;
  title: string;
  sub: string;
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Escape PostgREST reserved characters inside ilike patterns (commas, parens, quotes). */
const escOr = (s: string) => s.replace(/([\\%,()"])/g, "\\$1");

export function MasterSearch({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Debounce input by 200ms
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 200);
    return () => window.clearTimeout(t);
  }, [q]);

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setQ("");
      setDebounced("");
      setItems([]);
      setErrMsg(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = debounced;
    if (!term) {
      setItems([]);
      setErrMsg(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrMsg(null);

    (async () => {
      const collected: Item[] = [];
      const errors: string[] = [];

      await Promise.all(
        MODULE_CFG.map(async (m) => {
          const pattern = `%${escOr(term)}%`;
          const orExpr = m.searchCols.map((c) => `${c}.ilike.${pattern}`).join(",");
          const { data, error } = await supabase
            .from(m.table as never)
            .select(m.cols)
            .or(orExpr)
            .limit(30);
          if (error) {
            errors.push(`${m.label}: ${error.message}`);
            return;
          }
          for (const row of (data as unknown as Record<string, unknown>[] | null) ?? []) {
            const val = (k: string) => {
              const v = row[k];
              return v == null ? "" : String(v);
            };
            const id = val(m.idCol);
            const subParts = [
              val("passport"),
              val("mobile"),
              m.subExtraCol ? val(m.subExtraCol) : "",
              val("agency_sold"),
              val("status"),
            ].filter(Boolean);
            collected.push({
              key: m.key,
              label: m.label,
              path: m.path,
              color: m.color,
              id,
              title: val("passenger_name") || id || "—",
              sub: subParts.join(" · "),
            });
          }
        }),
      );

      if (cancelled) return;
      setItems(collected);
      setErrMsg(errors.length ? errors.join(" | ") : null);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [debounced, open]);

  const shown = useMemo(() => items.slice(0, 80), [items]);

  const pick = (it: Item) => {
    try {
      sessionStorage.setItem("master_focus", JSON.stringify({ module: it.key, id: it.id }));
    } catch {
      /* ignore */
    }
    onOpenChange(false);
    setQ("");
    navigate({ to: it.path });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4 text-primary" /> মাস্টার সার্চ
          </DialogTitle>
        </DialogHeader>
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="নাম / আইডি / পাসপোর্ট / মোবাইল / এজেন্সি / ভেন্ডর…"
              className="pl-8"
            />
            {loading && (
              <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto border-t">
          {debounced === "" ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              সার্চ করতে টাইপ করুন — একটি অক্ষরেও ফলাফল আসবে।
            </p>
          ) : loading && items.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">লোড হচ্ছে…</p>
          ) : shown.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              কিছু পাওয়া যায়নি
              {errMsg && <span className="block text-[10px] text-destructive mt-2">{errMsg}</span>}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((it, i) => (
                <li key={`${it.key}-${it.id}-${i}`}>
                  <button
                    type="button"
                    onClick={() => pick(it)}
                    className="flex w-full items-start gap-2 px-4 py-2 text-left transition-colors hover:bg-primary/10"
                  >
                    <span className={`shrink-0 text-[10px] font-semibold mt-0.5 ${it.color}`}>{it.label}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold leading-tight">{it.title}</span>
                      {it.sub && (
                        <span className="block truncate text-[11px] text-muted-foreground leading-tight">{it.sub}</span>
                      )}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground mt-0.5">{it.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
