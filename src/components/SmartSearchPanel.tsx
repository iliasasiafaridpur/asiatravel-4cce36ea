import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Row = Record<string, unknown> & { id: string };

interface Props {
  open: boolean;
  onClose: () => void;
  rows: Row[];
  idColumn: string;
  moduleLabel: string;
  /** Called with a row when its entry is clicked — should scroll the main page to it. */
  onPick: (row: Row) => void;
}

/** Short ID — strips the alpha prefix and keeps the last 6 chars, e.g. TKT-2606-001 → 06-001 */
function shortId(full: string): string {
  const stripped = full.replace(/^[A-Za-z]+-/, "");
  return stripped.length > 6 ? stripped.slice(-6) : stripped;
}

function pick(r: Row, keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (v != null && String(v).trim() !== "") return String(v);
  }
  return "";
}

export function SmartSearchPanel({ open, onClose, rows, idColumn, moduleLabel, onPick }: Props) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const items = useMemo(() => {
    return rows.map((r) => ({
      row: r,
      id: String(r[idColumn] ?? ""),
      passenger: pick(r, ["passenger_name"]),
      country: pick(r, ["country_name", "country_route", "trip_road"]),
      agency: pick(r, ["agency_sold"]),
    }));
  }, [rows, idColumn]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    return items.filter((it) =>
      `${it.id} ${it.passenger} ${it.country} ${it.agency}`.toLowerCase().includes(term),
    );
  }, [items, q]);

  return (
    <>
      {/* Transparent layer — keeps the page visible behind, closes on outside click */}
      {open && <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />}

      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-[min(88vw,380px)] flex-col border-l bg-background shadow-2xl transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-label="Smart Search"
      >
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-base font-semibold">
              <Search className="h-4 w-4 text-primary" /> Smart Search
            </h2>
            <p className="truncate text-xs text-muted-foreground">{moduleLabel} — {filtered.length} জন</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0" title="বন্ধ করুন">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="border-b p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="নাম / আইডি / দেশ / এজেন্সি..."
              className="pl-8"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">কিছু পাওয়া যায়নি</p>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((it) => (
                <li key={it.row.id}>
                  <button
                    type="button"
                    onClick={() => onPick(it.row)}
                    className="flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left transition-colors hover:bg-accent"
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">{shortId(it.id)}</span>
                    <span className="text-sm font-semibold leading-tight">{it.passenger || "—"}</span>
                    <span className="text-xs text-muted-foreground leading-tight">
                      {it.country || "—"}
                      {it.agency ? ` · ${it.agency}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
