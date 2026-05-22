// Background operational-alert scanner.
//
// Periodically scans BMET / Saudi Visa / Kuwait Visa tables for two
// classes of operational risk:
//
//   1. Financial alert — file has reached "Card Ready" or "Pending Delivery"
//      status while Outstanding Due (sold_price − received_amount) > 0.
//   2. Aging alert    — file has been sitting in "Card Ready" for more than
//      3 days without delivery.
//
// Each alert is pushed into the central notification store with structured
// passenger / service / country meta so the bell dropdown can render it on
// clean separate rows. A stable dedupeKey prevents repeat pushes for the
// same row across scan cycles (state changes naturally produce a new key).

import { supabase } from "@/integrations/supabase/client";
import { pushNotification } from "./notification-store";

type Row = {
  id?: string;
  passenger_name?: string | null;
  country_name?: string | null;
  country_route?: string | null;
  status?: string | null;
  sold_price?: number | null;
  received_amount?: number | null;
  delivery_date?: string | null;
  updated_at?: string | null;
  entry_date?: string | null;
  vendor_bought?: string | null;
  // table-specific IDs (only one will be present per row)
  bmet_id?: string | null;
  saudi_id?: string | null;
  kuwait_id?: string | null;
};

type Target = {
  table: "bmet_cards" | "saudi_visas" | "kuwait_visas";
  serviceLabel: string;        // human-readable module name
  idField: "bmet_id" | "saudi_id" | "kuwait_id";
  countryFallback?: string;
};

const TARGETS: Target[] = [
  { table: "bmet_cards",  serviceLabel: "BMET Card",  idField: "bmet_id" },
  { table: "saudi_visas", serviceLabel: "Saudi Visa", idField: "saudi_id",  countryFallback: "Saudi Arabia" },
  { table: "kuwait_visas", serviceLabel: "Kuwait Visa", idField: "kuwait_id", countryFallback: "Kuwait" },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const AGING_DAYS = 3;

function due(r: Row): number {
  return Number(r.sold_price ?? 0) - Number(r.received_amount ?? 0);
}

function countryOf(r: Row, t: Target): string | undefined {
  return (
    (r.country_name && String(r.country_name)) ||
    (r.country_route && String(r.country_route)) ||
    t.countryFallback
  );
}

function ageDays(r: Row): number {
  const ref = r.updated_at || r.entry_date;
  if (!ref) return 0;
  const ts = new Date(ref).getTime();
  if (Number.isNaN(ts)) return 0;
  return Math.floor((Date.now() - ts) / DAY_MS);
}

async function scanTarget(t: Target) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = supabase.from(t.table as any);
  const { data, error } = await q
    .select(
      "id, passenger_name, country_name, country_route, status, sold_price, received_amount, delivery_date, updated_at, entry_date",
    )
    .in("status", ["Card Ready", "Pending Delivery"])
    .is("delivery_date", null)
    .limit(500);
  if (error || !data) return;

  for (const r of data as Row[]) {
    const passenger = r.passenger_name || "(নাম নেই)";
    const country = countryOf(r, t);
    const meta = { passenger, service: t.serviceLabel, country };
    const outstanding = due(r);

    // 1) Financial alert
    if (outstanding > 0) {
      pushNotification(
        "warning",
        "বকেয়া সতর্কতা: পেমেন্ট সম্পন্ন নয়",
        `${t.serviceLabel} — অবস্থা: ${r.status} • বকেয়া ৳${outstanding.toLocaleString()}`,
        {
          meta: { ...meta, amount: outstanding },
          dedupeKey: `due:${t.table}:${r.id}:${r.status}:${outstanding}`,
        },
      );
    }

    // 2) Aging alert — Card Ready > 3 days without delivery
    if (r.status === "Card Ready") {
      const days = ageDays(r);
      if (days >= AGING_DAYS) {
        pushNotification(
          "warning",
          "ডেলিভারি বিলম্ব: Card Ready ৩+ দিন",
          `${t.serviceLabel} — ${days} দিন ধরে Card Ready, এখনো ডেলিভারি হয়নি`,
          {
            meta,
            // bucket by day so we re-notify once per day at most
            dedupeKey: `aging:${t.table}:${r.id}:${Math.floor(Date.now() / DAY_MS)}`,
          },
        );
      }
    }
  }
}

let started = false;
let timer: number | null = null;

export async function runAlertScanOnce(): Promise<void> {
  if (typeof window === "undefined") return;
  if (navigator.onLine === false) return;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return; // not logged in
  try {
    await Promise.all(TARGETS.map((t) => scanTarget(t)));
  } catch { /* swallow — scan is best-effort */ }
}

export function startAlertScanner(intervalMs = 5 * 60 * 1000) {
  if (started || typeof window === "undefined") return;
  started = true;
  // First scan shortly after login so the bell populates quickly.
  window.setTimeout(() => { void runAlertScanOnce(); }, 4000);
  timer = window.setInterval(() => { void runAlertScanOnce(); }, intervalMs);
  window.addEventListener("focus", () => { void runAlertScanOnce(); });
}

export function stopAlertScanner() {
  if (timer != null) { window.clearInterval(timer); timer = null; }
  started = false;
}
