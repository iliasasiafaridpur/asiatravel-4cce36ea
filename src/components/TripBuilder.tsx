import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { encodeTrip, parseTrip, type Trip, type TripType } from "@/lib/trip";

type Airport = [string, string, string, string];
let cache: Airport[] | null = null;
let loading: Promise<Airport[]> | null = null;
function loadAirports() {
  if (cache) return Promise.resolve(cache);
  loading ??= fetch("/airports.json").then((r) => r.json()).then((d: Airport[]) => (cache = d));
  return loading;
}
let regionNames: Intl.DisplayNames | null = null;
function country(code: string) {
  try { regionNames ??= new Intl.DisplayNames(["en"], { type: "region" }); return regionNames.of(code) ?? code; } catch { return code; }
}

function recent(key: string): string[] {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
}
function pushRecent(key: string, v: string) {
  if (!v.trim()) return;
  try { localStorage.setItem(key, JSON.stringify([v, ...recent(key).filter((x) => x !== v)].slice(0, 10))); } catch { /* ignore */ }
}
const RA = "recent_airports", RL = "recent_airlines";

function AirportInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Airport[]>(cache ?? []);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setQ(value), [value]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) {
      const r = recent(RA);
      const base = r.length ? r : ["DAC", "CGP", "ZYL", "JED", "RUH", "DMM", "KWI", "DXB", "DOH", "KUL"];
      return base.map((c) => list.find((a) => a[0] === c) ?? ([c, "", "", ""] as Airport));
    }
    const exact: Airport[] = [], starts: Airport[] = [], other: Airport[] = [];
    for (const a of list) {
      const code = a[0].toLowerCase();
      if (code === s) exact.push(a);
      else if (a[2].toLowerCase().startsWith(s) || code.startsWith(s)) starts.push(a);
      else if (s.length >= 3 && (a[1].toLowerCase().includes(s) || country(a[3]).toLowerCase().includes(s))) other.push(a);
      if (exact.length + starts.length + other.length > 60) break;
    }
    return [...exact, ...starts, ...other].slice(0, 12);
  }, [q, list]);
  return (
    <div ref={box} className="relative min-w-0 flex-1">
      <input
        value={q}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); loadAirports().then(setList); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); onChange(e.target.value.toUpperCase()); }}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-64 w-[min(22rem,80vw)] overflow-auto rounded-md border bg-popover text-popover-foreground shadow-lg">
          {results.map((a) => (
            <button
              type="button"
              key={a[0] + a[1]}
              onMouseDown={(e) => { e.preventDefault(); onChange(a[0]); setQ(a[0]); setOpen(false); pushRecent(RA, a[0]); }}
              className="block w-full px-3 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span className="font-bold text-primary">{a[0]}</span> — {a[1]}
              <div className="text-muted-foreground">{[a[2], country(a[3])].filter(Boolean).join(", ")}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const TYPES: { k: TripType; l: string }[] = [
  { k: "one_way", l: "One Way" }, { k: "return", l: "Return" }, { k: "multi_city", l: "Multi-City" },
];

export function TripBuilder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [trip, setTrip] = useState<Trip>(() => parseTrip(value));
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { last.current = value; setTrip(parseTrip(value)); } }, [value]);
  const update = (t: Trip) => { setTrip(t); const s = encodeTrip(t); last.current = s; onChange(s); };
  const setType = (type: TripType) => {
    let legs = trip.legs.length ? trip.legs : [{ from: "", to: "", date: "" }];
    if (type === "multi_city" && legs.length < 2) legs = [legs[0], { from: legs[0].to, to: "", date: "" }];
    if (type !== "multi_city") legs = [legs[0]];
    update({ ...trip, type, legs });
  };
  const setLeg = (i: number, p: Partial<{ from: string; to: string; date: string }>) => {
    const legs = trip.legs.map((l, j) => (j === i ? { ...l, ...p } : l));
    if (trip.type === "multi_city" && p.to !== undefined && legs[i + 1] && !legs[i + 1].from) legs[i + 1] = { ...legs[i + 1], from: p.to };
    update({ ...trip, legs });
  };
  return (
    <div className="space-y-1.5 rounded-md border border-input p-2">
      <div className="flex gap-1">
        {TYPES.map((t) => (
          <Button key={t.k} type="button" size="sm" variant={trip.type === t.k ? "default" : "outline"} className="h-7 flex-1 px-2 text-xs" onClick={() => setType(t.k)}>{t.l}</Button>
        ))}
      </div>
      {trip.legs.map((l, i) => (
        <div key={i} className="space-y-1">
          {trip.type === "multi_city" && <div className="text-[10px] font-semibold text-muted-foreground">Flight {i + 1}{i === 0 ? " (তারিখ: উপরের Flight Date)" : ""}</div>}
          <div className="flex items-center gap-1">
            <AirportInput value={l.from} placeholder="From (DAC)" onChange={(v) => setLeg(i, { from: v })} />
            <span className="text-muted-foreground">{trip.type === "return" ? "⇄" : "→"}</span>
            <AirportInput value={l.to} placeholder="To (JED)" onChange={(v) => setLeg(i, { to: v })} />
            {trip.type === "multi_city" && trip.legs.length > 2 && (
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => update({ ...trip, legs: trip.legs.filter((_, j) => j !== i) })}>✕</Button>
            )}
          </div>
          {trip.type === "multi_city" && i > 0 && (
            <DateInput value={l.date} onChange={(e) => setLeg(i, { date: e.target.value })} />
          )}
        </div>
      ))}
      {trip.type === "return" && (
        <div>
          <div className="text-[10px] font-semibold text-muted-foreground">Return Date</div>
          <DateInput value={trip.returnDate} onChange={(e) => update({ ...trip, returnDate: e.target.value })} />
        </div>
      )}
      {trip.type === "multi_city" && (
        <Button type="button" size="sm" variant="outline" className="h-7 w-full text-xs"
          onClick={() => update({ ...trip, legs: [...trip.legs, { from: trip.legs[trip.legs.length - 1]?.to ?? "", to: "", date: "" }] })}>
          + Add Another Flight
        </Button>
      )}
    </div>
  );
}

const AIRLINES: [string, string][] = [
  ["BG","Biman Bangladesh Airlines"],["BS","US-Bangla Airlines"],["2A","Air Astra"],["VQ","Novoair"],
  ["SV","Saudia"],["XY","flynas"],["F3","flyadeal"],["EK","Emirates"],["FZ","flydubai"],["EY","Etihad Airways"],
  ["G9","Air Arabia"],["QR","Qatar Airways"],["KU","Kuwait Airways"],["J9","Jazeera Airways"],["GF","Gulf Air"],
  ["WY","Oman Air"],["OV","SalamAir"],["TK","Turkish Airlines"],["PC","Pegasus Airlines"],["MS","EgyptAir"],
  ["RJ","Royal Jordanian"],["ME","Middle East Airlines"],["IX","Air India Express"],["AI","Air India"],["6E","IndiGo"],
  ["UK","Vistara"],["SG","SpiceJet"],["UL","SriLankan Airlines"],["PK","Pakistan International Airlines"],
  ["MH","Malaysia Airlines"],["AK","AirAsia"],["D7","AirAsia X"],["OD","Batik Air Malaysia"],["SQ","Singapore Airlines"],
  ["TR","Scoot"],["TG","Thai Airways"],["FD","Thai AirAsia"],["WE","Thai Smile"],["CX","Cathay Pacific"],
  ["CZ","China Southern Airlines"],["MU","China Eastern Airlines"],["CA","Air China"],["GA","Garuda Indonesia"],
  ["PR","Philippine Airlines"],["5J","Cebu Pacific"],["VN","Vietnam Airlines"],["KE","Korean Air"],["OZ","Asiana Airlines"],
  ["JL","Japan Airlines"],["NH","ANA All Nippon Airways"],["BA","British Airways"],["VS","Virgin Atlantic"],
  ["LH","Lufthansa"],["AF","Air France"],["KL","KLM"],["LX","Swiss"],["OS","Austrian Airlines"],["IB","Iberia"],
  ["AZ","ITA Airways"],["SU","Aeroflot"],["AA","American Airlines"],["DL","Delta Air Lines"],["UA","United Airlines"],
  ["AC","Air Canada"],["QF","Qantas"],["NZ","Air New Zealand"],["ET","Ethiopian Airlines"],["KQ","Kenya Airways"],
  ["SA","South African Airways"],["AT","Royal Air Maroc"],["UZ","Buraq Air"],["HY","Uzbekistan Airways"],
  ["KC","Air Astana"],["FJ","Fiji Airways"],["W5","Mahan Air"],["IR","Iran Air"],["IA","Iraqi Airways"],
  ["RB","Syrian Air"],["H9","Himalaya Airlines"],["RA","Nepal Airlines"],["U4","Buddha Air"],["KB","Druk Air"],
  ["8M","Myanmar Airways International"],["MK","Air Mauritius"],["8Q","Maldivian"],["Q2","Maldivian Airlines"],
];

export function AirlineInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const results = useMemo(() => {
    const s = value.trim().toLowerCase();
    if (!s || !open) {
      const r = recent(RL);
      return (r.length ? r : AIRLINES.slice(0, 10).map((a) => a[1])).slice(0, 10);
    }
    return AIRLINES.filter(([c, n]) => c.toLowerCase() === s || n.toLowerCase().includes(s)).map((a) => a[1]).slice(0, 12);
  }, [value, open]);
  const pick = (v: string) => { onChange(v); pushRecent(RL, v); setOpen(false); };
  return (
    <div ref={box} className="relative min-w-0">
      <input
        value={value}
        placeholder="Airline (নাম বা কোড)"
        onFocus={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onBlur={() => { if (value.trim()) pushRecent(RL, value.trim()); }}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-64 w-[min(22rem,80vw)] overflow-auto rounded-md border bg-popover text-popover-foreground shadow-lg">
          {results.map((n) => {
            const code = AIRLINES.find((a) => a[1] === n)?.[0];
            return (
              <button type="button" key={n} onMouseDown={(e) => { e.preventDefault(); pick(n); }} className="block w-full px-3 py-1.5 text-left text-xs hover:bg-accent">
                {code && <span className="font-bold text-primary">{code}</span>} {code ? "— " : ""}{n}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
