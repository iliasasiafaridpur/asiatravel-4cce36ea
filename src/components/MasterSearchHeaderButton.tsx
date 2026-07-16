import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Search, Loader2, X } from "lucide-react";

type ModuleCfg = {
  key: string;
  label: string;
  table: string;
  idCol: string;
  path: string;
  cols: string;
  searchCols: string[];
  subExtraCol?: string;
  color: string;
};

const MODULE_CFG: ModuleCfg[] = [
  { key: "tickets", label: "Ticket", table: "tickets", idCol: "ticket_id", path: "/tickets",
    cols: "ticket_id,passenger_name,passport,mobile,airline,trip_road,agency_sold,vendor_bought,status",
    searchCols: ["ticket_id","passenger_name","passport","mobile","airline","trip_road","agency_sold","vendor_bought"],
    subExtraCol: "trip_road",
    color: "text-cyan-600 dark:text-cyan-400" },
  { key: "bmet", label: "BMET", table: "bmet_cards", idCol: "bmet_id", path: "/bmet",
    cols: "bmet_id,passenger_name,passport,mobile,country_name,agency_sold,vendor_bought,status",
    searchCols: ["bmet_id","passenger_name","passport","mobile","country_name","agency_sold","vendor_bought"],
    subExtraCol: "country_name",
    color: "text-emerald-600 dark:text-emerald-400" },
  { key: "saudi-visa", label: "Saudi", table: "saudi_visas", idCol: "saudi_id", path: "/saudi-visa",
    cols: "saudi_id,passenger_name,passport,mobile,visa_type,agency_sold,vendor_bought,status",
    searchCols: ["saudi_id","passenger_name","passport","mobile","visa_type","agency_sold","vendor_bought"],
    subExtraCol: "visa_type",
    color: "text-orange-600 dark:text-orange-400" },
  { key: "kuwait-visa", label: "Kuwait", table: "kuwait_visas", idCol: "kuwait_id", path: "/kuwait-visa",
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

const escOr = (s: string) => s.replace(/([\\%,()"])/g, "\\$1");

export function MasterSearchHeaderButton() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 200);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const term = debounced;
    if (!term) { setItems([]); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const collected: Item[] = [];
      await Promise.all(
        MODULE_CFG.map(async (m) => {
          const pattern = `%${escOr(term)}%`;
          const orExpr = m.searchCols.map((c) => `${c}.ilike.${pattern}`).join(",");
          const { data, error } = await supabase
            .from(m.table as never)
            .select(m.cols)
            .or(orExpr)
            .limit(20);
          if (error) return;
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
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [debounced]);

  // Close dropdown on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const shown = useMemo(() => items.slice(0, 60), [items]);

  const pick = (it: Item) => {
    try {
      sessionStorage.setItem("master_focus", JSON.stringify({ module: it.key, id: it.id }));
    } catch { /* ignore */ }
    setOpen(false);
    setQ("");
    navigate({ to: it.path });
    // Also fire an event so ModulePage focuses even when already on the same route.
    window.setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent("master:focus", { detail: { module: it.key, id: it.id } }));
      } catch { /* ignore */ }
    }, 50);
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative w-[180px] sm:w-[240px]">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="সব খুঁজুন…"
          className="h-8 pl-7 pr-7 text-xs"
        />
        {loading ? (
          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : q ? (
          <button
            type="button"
            onClick={() => { setQ(""); setItems([]); }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted"
            aria-label="Clear"
          >
            <X className="h-3 w-3 text-muted-foreground" />
          </button>
        ) : null}
      </div>

      {open && debounced && (
        <div className="absolute right-0 mt-1 w-[min(92vw,380px)] max-h-[70vh] overflow-y-auto rounded-md border border-border bg-popover shadow-xl z-50">
          {loading && items.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">লোড হচ্ছে…</p>
          ) : shown.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">কিছু পাওয়া যায়নি</p>
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((it, i) => (
                <li key={`${it.key}-${it.id}-${i}`}>
                  <button
                    type="button"
                    onClick={() => pick(it)}
                    className="flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-primary/10"
                  >
                    <span className={`shrink-0 text-[10px] font-semibold mt-0.5 ${it.color}`}>{it.label}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold leading-tight">{it.title}</span>
                      {it.sub && (
                        <span className="block truncate text-[10px] text-muted-foreground leading-tight">{it.sub}</span>
                      )}
                    </span>
                    <span className="shrink-0 font-mono text-[9px] text-muted-foreground mt-0.5">{it.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
