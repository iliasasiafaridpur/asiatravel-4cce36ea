import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

const MONTHS_BN = [
  "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
  "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
];

/** Best-effort date for a row: prefers created_at, falls back to common date columns. */
function rowDate(r: Row): Date | null {
  const v = pick(r, ["created_at", "issue_date", "trip_date", "flight_date", "travel_date", "date"]);
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function SmartSearchPanel({ open, onClose, rows, idColumn, moduleLabel, onPick }: Props) {
  const [q, setQ] = useState("");
  const [year, setYear] = useState("all");
  const [month, setMonth] = useState("all");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setYear("all");
      setMonth("all");
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
    return rows.map((r) => {
      const d = rowDate(r);
      return {
        row: r,
        id: String(r[idColumn] ?? ""),
        passenger: pick(r, ["passenger_name"]),
        country: pick(r, ["country_name", "country_route", "trip_road"]),
        agency: pick(r, ["agency_sold"]),
        year: d ? d.getFullYear() : null,
        month: d ? d.getMonth() : null,
        // Full searchable text across every field so even one letter finds matches.
        blob: Object.values(r).map((v) => String(v ?? "")).join(" ").toLowerCase(),
      };
    });
  }, [rows, idColumn]);

  const years = useMemo(() => {
    const set = new Set<number>();
    items.forEach((it) => it.year != null && set.add(it.year));
    return Array.from(set).sort((a, b) => b - a);
  }, [items]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((it) => {
      if (term && !it.blob.includes(term)) return false;
      if (year !== "all" && it.year !== Number(year)) return false;
      if (month !== "all" && it.month !== Number(month)) return false;
      return true;
    });
  }, [items, q, year, month]);

  return (
    <>
      {/* Transparent layer — keeps the page visible behind, closes on outside click */}
      {open && <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />}

      <aside
        className={`fixed right-0 top-12 z-50 flex h-[calc(100%-3rem)] w-[min(88vw,380px)] flex-col border-l bg-background shadow-2xl transition-transform duration-300 ease-out ${
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

        <div className="space-y-2 border-b p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="নাম / আইডি / দেশ / এজেন্সি..."
              className="h-7 pl-7 text-xs"
            />
          </div>
          <div className="flex gap-2">
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="h-7 flex-1 text-xs">
                <SelectValue placeholder="বছর" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">সব বছর</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="h-7 flex-1 text-xs">
                <SelectValue placeholder="মাস" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">সব মাস</SelectItem>
                {MONTHS_BN.map((m, i) => (
                  <SelectItem key={i} value={String(i)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-primary/15 dark:hover:bg-primary/25"
                  >
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{shortId(it.id)}</span>
                    <span className="shrink-0 truncate text-xs font-semibold leading-tight">{it.passenger || "—"}</span>
                    <span className="ml-auto truncate text-[11px] text-muted-foreground leading-tight">
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
