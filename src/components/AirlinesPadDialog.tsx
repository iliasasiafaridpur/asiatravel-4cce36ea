import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Printer, Plane, X, ChevronLeft, Search } from "lucide-react";
import { printDocHtml, buildFileTitle } from "@/lib/print-export";
import { formatDate } from "@/lib/modules";
import { toast } from "sonner";

/**
 * Airlines that operate to/from Bangladesh. Each entry carries the bits needed
 * to render an "official pad" letterhead: brand name, IATA code, a short tagline,
 * a brand accent colour, the airline website and the country of the head office.
 * This is a self-contained reference list — it does not read from the database.
 */
type Airline = {
  name: string;
  code: string;
  tagline: string;
  color: string;
  website: string;
  country: string;
};

const AIRLINES: Airline[] = [
  { name: "Biman Bangladesh Airlines", code: "BG", tagline: "Your Home in the Air", color: "#0a7a3b", website: "www.biman-airlines.com", country: "Bangladesh" },
  { name: "US-Bangla Airlines", code: "BS", tagline: "Fly Fast · Fly Safe", color: "#e01a2b", website: "www.usbair.com", country: "Bangladesh" },
  { name: "NOVOAIR", code: "VQ", tagline: "Come Fly With Us", color: "#00539b", website: "www.flynovoair.com", country: "Bangladesh" },
  { name: "Air Astra", code: "2A", tagline: "Fly For All", color: "#7a1fa2", website: "www.airastra.com", country: "Bangladesh" },
  { name: "Emirates", code: "EK", tagline: "Fly Better", color: "#d71921", website: "www.emirates.com", country: "United Arab Emirates" },
  { name: "Qatar Airways", code: "QR", tagline: "Going Places Together", color: "#5c0632", website: "www.qatarairways.com", country: "Qatar" },
  { name: "Saudia", code: "SV", tagline: "Going Beyond Generosity", color: "#00733b", website: "www.saudia.com", country: "Saudi Arabia" },
  { name: "Etihad Airways", code: "EY", tagline: "Choose Well", color: "#bd8b13", website: "www.etihad.com", country: "United Arab Emirates" },
  { name: "flydubai", code: "FZ", tagline: "Get Going", color: "#f57c00", website: "www.flydubai.com", country: "United Arab Emirates" },
  { name: "Air Arabia", code: "G9", tagline: "Fly More · Pay Less", color: "#e2001a", website: "www.airarabia.com", country: "United Arab Emirates" },
  { name: "Salam Air", code: "OV", tagline: "Fly Smart", color: "#00a0a0", website: "www.salamair.com", country: "Oman" },
  { name: "Oman Air", code: "WY", tagline: "Traditional Hospitality", color: "#6b1f3a", website: "www.omanair.com", country: "Oman" },
  { name: "Gulf Air", code: "GF", tagline: "The Airline of Bahrain", color: "#c8a24a", website: "www.gulfair.com", country: "Bahrain" },
  { name: "Kuwait Airways", code: "KU", tagline: "New Horizons", color: "#0060a9", website: "www.kuwaitairways.com", country: "Kuwait" },
  { name: "Jazeera Airways", code: "J9", tagline: "Made for You", color: "#7ab800", website: "www.jazeeraairways.com", country: "Kuwait" },
  { name: "Turkish Airlines", code: "TK", tagline: "Widen Your World", color: "#c8102e", website: "www.turkishairlines.com", country: "Türkiye" },
  { name: "Malaysia Airlines", code: "MH", tagline: "Journeys Are Made By The People You Travel With", color: "#00539b", website: "www.malaysiaairlines.com", country: "Malaysia" },
  { name: "Batik Air Malaysia", code: "OD", tagline: "Fly Beyond", color: "#e2231a", website: "www.batikair.com", country: "Malaysia" },
  { name: "Singapore Airlines", code: "SQ", tagline: "A Great Way to Fly", color: "#f9a01b", website: "www.singaporeair.com", country: "Singapore" },
  { name: "Thai Airways", code: "TG", tagline: "Smooth As Silk", color: "#4b2e83", website: "www.thaiairways.com", country: "Thailand" },
  { name: "IndiGo", code: "6E", tagline: "On-Time. Courteous. Hassle-Free", color: "#0f0f6b", website: "www.goindigo.in", country: "India" },
  { name: "Air India", code: "AI", tagline: "The New Air India", color: "#c8102e", website: "www.airindia.com", country: "India" },
  { name: "SriLankan Airlines", code: "UL", tagline: "The Journey Begins", color: "#00534c", website: "www.srilankan.com", country: "Sri Lanka" },
  { name: "Cathay Pacific", code: "CX", tagline: "Move Beyond", color: "#006564", website: "www.cathaypacific.com", country: "Hong Kong" },
  { name: "China Eastern Airlines", code: "MU", tagline: "Fly Your Way", color: "#c8102e", website: "www.ceair.com", country: "China" },
  { name: "China Southern Airlines", code: "CZ", tagline: "Fly Into Your Dreams", color: "#003da5", website: "www.csair.com", country: "China" },
  { name: "EgyptAir", code: "MS", tagline: "Enjoy the Sky", color: "#003876", website: "www.egyptair.com", country: "Egypt" },
];

const DARK = "#0b2545";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function AirlinesPadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [selected, setSelected] = useState<Airline | null>(null);
  const [q, setQ] = useState("");

  const [refVal, setRefVal] = useState("");
  const [dateVal, setDateVal] = useState<string>(new Date().toISOString().slice(0, 10));
  const [toVal, setToVal] = useState("");
  const [subjectVal, setSubjectVal] = useState("");
  const [bodyVal, setBodyVal] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return AIRLINES;
    return AIRLINES.filter(
      (a) => a.name.toLowerCase().includes(term) || a.code.toLowerCase().includes(term) || a.country.toLowerCase().includes(term),
    );
  }, [q]);

  const resetBody = () => {
    setRefVal("");
    setDateVal(new Date().toISOString().slice(0, 10));
    setToVal("");
    setSubjectVal("");
    setBodyVal("");
  };

  const openAirline = (a: Airline) => {
    resetBody();
    setSelected(a);
  };

  const buildHtml = (a: Airline) => {
    const initials = a.name
      .replace(/[^A-Za-z0-9 ]/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");

    const metaRows: string[] = [];
    if (refVal) metaRows.push(`<div class="metarow"><span class="ml">Ref</span><span class="mv">${esc(refVal)}</span></div>`);
    metaRows.push(`<div class="metarow"><span class="ml">Date</span><span class="mv">${dateVal ? esc(formatDate(dateVal)) : "&nbsp;"}</span></div>`);

    const toBlock = toVal
      ? `<div class="toblock"><span class="tol">To</span><div class="tov">${esc(toVal).replace(/\n/g, "<br/>")}</div></div>`
      : "";
    const subjectBlock = subjectVal
      ? `<div class="subject"><span class="subl">Subject:</span><span class="subv">${esc(subjectVal)}</span></div>`
      : "";
    const bodyHtml = bodyVal ? esc(bodyVal).replace(/\n/g, "<br/>") : "";

    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(a.name)} Pad</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  html, body { margin: 0; padding: 0; background: #f1f3f7; font-family: ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif; color: #0f172a; }
  .page { position: relative; width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; display: flex; flex-direction: column; overflow: hidden; }
  .wm { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; }
  .wm span { font-size: 150px; font-weight: 900; letter-spacing: 4px; color: ${a.color}; opacity: 0.05; }
  .inner { position: relative; z-index: 1; display: flex; flex-direction: column; flex: 1; }

  .head { border-bottom: 3px solid ${a.color}; padding: 14mm 14mm 6mm; }
  .head-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .brand .logo { height: 74px; width: 74px; border-radius: 14px; background: ${a.color}; color: #fff; display: flex; align-items: center; justify-content: center; overflow: hidden; flex: none; font-size: 28px; font-weight: 800; letter-spacing: 1px; }
  .brand .name { font-size: 27px; font-weight: 800; letter-spacing: -0.4px; color: ${DARK}; line-height: 1.1; }
  .brand .slogan { font-size: 12.5px; font-style: italic; color: ${a.color}; font-weight: 700; margin-top: 5px; }
  .meta { text-align: right; min-width: 130px; }
  .metarow { display: flex; justify-content: flex-end; gap: 8px; font-size: 11.5px; margin-bottom: 4px; }
  .metarow .ml { color: #94a3b8; text-transform: uppercase; letter-spacing: .08em; font-size: 9px; padding-top: 3px; }
  .metarow .mv { min-width: 80px; border-bottom: 1px solid #cbd5e1; font-weight: 600; color: #334155; text-align: left; padding: 0 4px 2px; }
  .head-contact { display: flex; flex-wrap: nowrap; gap: 12px; margin-top: 12px; padding-top: 9px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #475569; white-space: nowrap; justify-content: space-between; }
  .head-contact b { color: ${a.color}; font-weight: 700; }

  .reci { padding: 8mm 14mm 0; }
  .toblock { display: flex; gap: 10px; margin-bottom: 8px; }
  .toblock .tol { font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: #94a3b8; padding-top: 3px; }
  .toblock .tov { flex: 1; min-height: 20px; border-bottom: 1px dashed #cbd5e1; font-weight: 600; color: #1e293b; font-size: 13px; }
  .subject { display: flex; gap: 8px; align-items: baseline; margin-top: 4px; }
  .subject .subl { font-size: 12px; font-weight: 700; color: ${DARK}; white-space: nowrap; }
  .subject .subv { flex: 1; border-bottom: 1px dashed #cbd5e1; font-weight: 600; color: #1e293b; font-size: 13px; min-height: 18px; }

  .body { flex: 1; margin: 6mm 14mm; font-size: 14px; line-height: 2; color: #1e293b; white-space: pre-wrap; word-break: break-word; min-height: 120mm; }

  .foot { margin-top: auto; padding: 6mm 14mm 12mm; }
  .sign { display: flex; justify-content: flex-end; }
  .sign .box { width: 210px; text-align: center; border-top: 1px solid #94a3b8; padding-top: 4px; font-size: 11px; color: #64748b; }
  .strip { margin-top: 8mm; border-top: 3px solid ${a.color}; padding-top: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #94a3b8; }
  .strip b { color: ${a.color}; }
</style></head>
<body>
  <div class="page">
    <div class="wm"><span>${esc(initials)}</span></div>
    <div class="inner">
      <div class="head">
        <div class="head-top">
          <div class="brand">
            <div class="logo">${esc(initials)}</div>
            <div>
              <div class="name">${esc(a.name)}</div>
              <div class="slogan">"${esc(a.tagline)}"</div>
            </div>
          </div>
          <div class="meta">${metaRows.join("")}</div>
        </div>
        <div class="head-contact">
          <span>✈️ IATA <b>${esc(a.code)}</b></span>
          <span>🌐 <b>${esc(a.website)}</b></span>
          <span>📍 ${esc(a.country)}</span>
        </div>
      </div>

      ${toBlock || subjectBlock ? `<div class="reci">${toBlock}${subjectBlock}</div>` : ""}

      <div class="body">${bodyHtml}</div>

      <div class="foot">
        <div class="sign"><div class="box">Authorized Signature</div></div>
        <div class="strip">
          <span>${esc(a.name)}</span>
          <span>IATA <b>${esc(a.code)}</b> · ${esc(a.country)}</span>
        </div>
      </div>
    </div>
  </div>
</body></html>`;
  };

  const handlePrint = () => {
    if (!selected) return;
    try {
      const docTitle = buildFileTitle("Airline_Pad", selected.name, subjectVal || toVal || "", dateVal);
      printDocHtml(buildHtml(selected), docTitle);
    } catch {
      toast.error("পপ-আপ ব্লক হয়েছে — অনুমতি দিন");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setSelected(null); } }}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Plane className="h-4 w-4" />
            {selected ? selected.name : "Airlines Pad — এয়ারলাইন্স লেটারহেড"}
          </DialogTitle>
        </DialogHeader>

        {!selected ? (
          <div className="max-h-[78vh] overflow-y-auto px-5 pb-5">
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="এয়ারলাইন্স খুঁজুন — নাম / কোড / দেশ…"
                className="pl-8"
              />
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              বাংলাদেশে চলাচলকারী এয়ারলাইন্স — নামে ক্লিক করলে তার অফিসিয়াল প্যাড খুলবে।
            </p>
            {filtered.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">কিছু পাওয়া যায়নি</p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {filtered.map((a) => (
                  <li key={a.code + a.name}>
                    <button
                      type="button"
                      onClick={() => openAirline(a)}
                      className="flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors hover:bg-primary/10"
                    >
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
                        style={{ backgroundColor: a.color }}
                      >
                        {a.code}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold leading-tight">{a.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground leading-tight">{a.country}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="grid max-h-[78vh] grid-cols-1 gap-4 overflow-y-auto px-5 pb-4 md:grid-cols-[300px_1fr]">
            {/* controls */}
            <div className="space-y-3">
              <Button variant="ghost" size="sm" className="gap-1 px-2" onClick={() => setSelected(null)}>
                <ChevronLeft className="h-4 w-4" /> এয়ারলাইন্স তালিকা
              </Button>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Ref No</Label>
                  <Input value={refVal} onChange={(e) => setRefVal(e.target.value)} placeholder="যেমন: REF/001" className="h-8" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">তারিখ</Label>
                  <Input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)} className="h-8" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">প্রাপক (To)</Label>
                <Input value={toVal} onChange={(e) => setToVal(e.target.value)} placeholder="প্রাপকের নাম / ঠিকানা" className="h-8" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">বিষয় (Subject)</Label>
                <Input value={subjectVal} onChange={(e) => setSubjectVal(e.target.value)} placeholder="বিষয় লিখুন" className="h-8" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">লেখা (Body)</Label>
                <Textarea
                  value={bodyVal}
                  onChange={(e) => setBodyVal(e.target.value)}
                  placeholder="এখানে চিঠি / আবেদন লিখুন…"
                  className="min-h-[180px]"
                />
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { onClose(); setSelected(null); }}>
                  <X className="h-4 w-4" /> বন্ধ
                </Button>
                <Button className="flex-1" onClick={handlePrint}>
                  <Printer className="h-4 w-4" /> Print / PDF
                </Button>
              </div>
            </div>

            {/* live preview */}
            <div className="min-w-0 rounded-lg border bg-muted/30 p-3">
              <div className="mb-2 text-[11px] text-muted-foreground">প্রিভিউ (প্রিন্টে হুবহু এমন আসবে)</div>
              <div className="overflow-hidden rounded border bg-white">
                <iframe
                  title="airline-pad-preview"
                  className="h-[60vh] w-full border-0 bg-white"
                  srcDoc={buildHtml(selected)}
                />
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
