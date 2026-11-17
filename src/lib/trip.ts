// Encodes a multi-leg air itinerary inside the existing `trip_road` text column
// so no database change is needed and old tickets keep working.
export type TripType = "one_way" | "return" | "multi_city";
export interface Leg { from: string; to: string; date: string }
export interface Trip { type: TripType; legs: Leg[]; returnDate: string }

const ISO = /\d{4}-\d{2}-\d{2}/;

export function parseTrip(raw: string): Trip {
  const s = (raw ?? "").trim();
  if (s.includes("⇄")) {
    const [r, ret] = s.split("|").map((x) => x.trim());
    const [from, to] = r.split("⇄").map((x) => x.trim());
    return { type: "return", legs: [{ from, to, date: "" }], returnDate: (ret?.match(ISO) ?? [""])[0] };
  }
  const parts = s.split("|").map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1) {
    const legs = parts.map((p) => {
      const date = (p.match(ISO) ?? [""])[0];
      const [from, to] = p.replace(ISO, "").split("→").map((x) => (x ?? "").trim());
      return { from, to: to ?? "", date };
    });
    return { type: "multi_city", legs, returnDate: "" };
  }
  if (s.includes("→")) {
    const [from, to] = s.split("→").map((x) => x.trim());
    return { type: "one_way", legs: [{ from, to, date: "" }], returnDate: "" };
  }
  // Legacy free text like "DAC-JED": keep as-is in From.
  return { type: "one_way", legs: [{ from: s, to: "", date: "" }], returnDate: "" };
}

export function encodeTrip(t: Trip): string {
  const l = t.legs;
  if (t.type === "return") {
    const base = `${l[0]?.from ?? ""} ⇄ ${l[0]?.to ?? ""}`;
    return t.returnDate ? `${base} | RET ${t.returnDate}` : base;
  }
  if (t.type === "multi_city") {
    return l.map((x, i) => `${x.from} → ${x.to}${i > 0 && x.date ? ` ${x.date}` : ""}`).join(" | ");
  }
  if (!l[0]?.to) return l[0]?.from ?? "";
  return `${l[0].from} → ${l[0].to}`;
}

export function tripTypeLabel(raw: string): string {
  const t = parseTrip(raw).type;
  return t === "return" ? "Return" : t === "multi_city" ? "Multi-City" : "One Way";
}

/** Human-readable route with dd-MMM dates, for tables/SMS. */
export function prettyTrip(raw: string): string {
  return (raw ?? "").replace(/\d{4}-\d{2}-\d{2}/g, (d) => {
    const dt = new Date(d + "T00:00:00");
    return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  });
}
