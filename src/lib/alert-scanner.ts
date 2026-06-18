// Background operational-alert scanner.
//
// Periodically scans BMET / Saudi Visa / Kuwait Visa tables for two
// classes of operational risk:
//
//   1. Financial alert — file has reached "Card Ready" or "Pending Delivery"
//      status while Outstanding Due (sold_price − received_amount − discount_amount) > 0.
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
  discount_amount?: number | null;
  delivery_date?: string | null;
  updated_at?: string | null;
  entry_date?: string | null;
  vendor_bought?: string | null;
  cancelled?: boolean | null;
  // table-specific IDs (only one will be present per row)
  bmet_id?: string | null;
  saudi_id?: string | null;
  kuwait_id?: string | null;
};

type Target = {
  table: "bmet_cards" | "saudi_visas" | "kuwait_visas";
  serviceLabel: string;        // human-readable module name
  idField: "bmet_id" | "saudi_id" | "kuwait_id";
  /** The "received" column name differs per table (kuwait uses `received`). */
  recvField: "received_amount" | "received";
  /** Only some tables carry a country column; others fall back to a constant. */
  countryField?: "country_name";
  countryFallback?: string;
};

const TARGETS: Target[] = [
  { table: "bmet_cards",  serviceLabel: "BMET Card",  idField: "bmet_id",  recvField: "received_amount", countryField: "country_name" },
  { table: "saudi_visas", serviceLabel: "Saudi Visa", idField: "saudi_id", recvField: "received_amount", countryFallback: "Saudi Arabia" },
  { table: "kuwait_visas", serviceLabel: "Kuwait Visa", idField: "kuwait_id", recvField: "received", countryFallback: "Kuwait" },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const AGING_DAYS = 3;

function due(r: Row): number {
  return Number(r.sold_price ?? 0) - Number(r.received_amount ?? 0) - Number(r.discount_amount ?? 0);
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
  // Build a per-table column list — column names differ between tables
  // (e.g. only bmet_cards has country_name; kuwait_visas uses `received`).
  const cols = [
    "id", t.idField, "passenger_name", "status", "sold_price",
    t.recvField, "discount_amount", "delivery_date", "updated_at",
    "entry_date", "vendor_bought", "cancelled",
  ];
  if (t.countryField) cols.push(t.countryField);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = supabase.from(t.table as any);
  const { data, error } = await q
    .select(cols.join(","))
    .in("status", ["Card Ready", "Pending Delivery"])
    .is("delivery_date", null)
    .neq("cancelled", true)
    .limit(500);
  if (error || !data) return;

  // Normalize the received amount onto received_amount so due() works uniformly.
  for (const r of data as Record<string, unknown>[]) {
    if (t.recvField !== "received_amount") r.received_amount = r[t.recvField];
  }

  // Batch-fetch latest receipt_id per service_row_id for these rows
  const rowIds = (data as Row[]).map((r) => r.id).filter(Boolean) as string[];
  const receiptMap: Record<string, string> = {};
  if (rowIds.length) {
    const { data: rec } = await supabase
      .from("payment_receipts")
      .select("service_row_id, receipt_id, created_at")
      .eq("service_table", t.table)
      .in("service_row_id", rowIds)
      .order("created_at", { ascending: false });
    for (const r of (rec as Array<{ service_row_id: string; receipt_id: string }> | null) ?? []) {
      if (r.service_row_id && !receiptMap[r.service_row_id]) {
        receiptMap[r.service_row_id] = r.receipt_id;
      }
    }
  }

  for (const r of data as Row[]) {
    const passenger = r.passenger_name || "(নাম নেই)";
    const country = countryOf(r, t);
    const refId = (r[t.idField] as string | null | undefined) || undefined;
    const vendor = r.vendor_bought || undefined;
    const receiptId = (r.id && receiptMap[r.id]) || "—";
    const meta = { passenger, service: t.serviceLabel, country, refId, vendor, receiptId };
    const outstanding = due(r);

    // 1) Financial alert (বকেয়া সতর্কতা) — disabled per user request
    // if (outstanding > 0) { ... } removed: no more outstanding/due notifications.
    void outstanding;

    // 2) Aging alert (ডেলিভারি বিলম্ব) — disabled per user request
    // Card Ready 3+ days delivery-delay notifications removed.
  }
}

let started = false;
let timer: number | null = null;

export async function runAlertScanOnce(): Promise<void> {
  // All alert types (বকেয়া সতর্কতা + ডেলিভারি বিলম্ব) are disabled per user request.
  // Scanner is a no-op; keep the export so callers/scheduler stay intact.
  return;
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
