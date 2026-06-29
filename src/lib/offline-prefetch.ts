// One-tap offline pre-loader.
//
// Fetches data for every main data module AND the support tables that power
// ledgers, accounts and balances, then writes them into localStorage so the
// WHOLE app can be browsed offline:
//   • module tables  -> `cache_v2_<table>` (read by ModulePage)
//   • support tables -> `off_<key>`        (read by ledgers / accounts / balances)
// Pages the user has NOT opened yet still hydrate instantly when the connection
// drops.

import { supabase } from "@/integrations/supabase/client";
import { cacheWrite } from "@/lib/offline-cache";
import { registerOfflineSW } from "@/lib/register-sw";

const DAY = 24 * 60 * 60 * 1000;
const MAX_ROWS = 1500;
const SUPPORT_MAX_ROWS = 8000;

// Tables backed by ModulePage (they all read `cache_v2_<table>`).
const PRELOAD_TABLES = [
  "tickets",
  "bmet_cards",
  "saudi_visas",
  "kuwait_visas",
  "others",
] as const;

// Support tables read by ledgers / accounts / balances. Cached in FULL (no date
// window) so running balances and bill-by-bill history stay correct offline.
const SUPPORT_TABLES = [
  "vendor_ledger",
  "agency_ledger",
  "payment_receipts",
  "cash_handovers",
  "cash_expenses",
  "extra_services",
  "agents",
  "vendors",
  "passengers",
] as const;

// Routes whose code chunks must be warmed while the internet is still on.
// Data snapshots alone are not enough: if the Agency Ledger page chunk was not
// opened after the latest publish, an offline navigation can fail before it can
// read the saved `off_agency_ledger` data. A hidden iframe loads these read-only
// pages once so the service worker caches the app shell + route assets.
const OFFLINE_ROUTE_WARMUP = [
  "/",
  "/agency-ledger",
  "/vendor-ledger",
  "/accounts",
  "/my-handover",
  "/action-board",
  "/tickets",
  "/bmet",
  "/saudi-visa",
  "/kuwait-visa",
  "/other",
] as const;

async function warmOfflineRoute(route: string): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  await new Promise<void>((resolve) => {
    const iframe = document.createElement("iframe");
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.setTimeout(() => {
        try { iframe.remove(); } catch { /* ignore */ }
        resolve();
      }, 700);
    };
    iframe.style.position = "fixed";
    iframe.style.width = "1px";
    iframe.style.height = "1px";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    iframe.onload = done;
    document.body.appendChild(iframe);
    iframe.src = route;
    window.setTimeout(done, 3500);
  });
}

async function warmOfflineRoutes(onProgress?: (done: number, total: number) => void): Promise<void> {
  for (const route of OFFLINE_ROUTE_WARMUP) {
    try {
      await warmOfflineRoute(route);
    } catch {
      // Warm-up is best-effort; saved data should still complete.
    }
    onProgress?.(1, OFFLINE_ROUTE_WARMUP.length);
  }
}

export type PrefetchResult = { ok: number; failed: number; rows: number };

/**
 * Pre-load data for offline use.
 * @param days how far back to fetch module tables (default 31)
 * @param onProgress called as each step finishes: (done, total)
 */
export async function prefetchMonthData(
  days = 31,
  onProgress?: (done: number, total: number) => void,
): Promise<PrefetchResult> {
  // Make sure the offline app shell is actually installed before saving data.
  // Without an active service worker, localStorage snapshots exist but browser
  // navigation can still fall through to the native "No internet" page.
  await registerOfflineSW({ force: true });

  const cutoff = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  let ok = 0;
  let failed = 0;
  let rows = 0;
  // route warm-up + module tables + support tables + 2 balance RPCs
  const total = OFFLINE_ROUTE_WARMUP.length + PRELOAD_TABLES.length + SUPPORT_TABLES.length + 2;
  let done = 0;
  const step = () => onProgress?.(++done, total);

  // 0) Warm the actual pages first so offline navigations do not fall through
  // to a missing dynamic route chunk (especially Agency Ledger).
  await warmOfflineRoutes(() => step());

  // 1) Module tables (last ~month) -> cache_v2_<table>
  for (const table of PRELOAD_TABLES) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from(table as any) as any)
        .select("*")
        .gte("entry_date", cutoff)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(MAX_ROWS);
      if (error) throw error;
      const list = (data as unknown[]) ?? [];
      try {
        localStorage.setItem(`cache_v2_${table}`, JSON.stringify(list));
      } catch { /* quota */ }
      rows += list.length;
      ok += 1;
    } catch {
      failed += 1;
    }
    step();
  }

  // 2) Support tables (full) -> off_<table>
  for (const table of SUPPORT_TABLES) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from(table as any) as any)
        .select("*")
        .limit(SUPPORT_MAX_ROWS);
      if (error) throw error;
      const list = (data as unknown[]) ?? [];
      cacheWrite(table, list);
      rows += list.length;
      ok += 1;
    } catch {
      failed += 1;
    }
    step();
  }

  // 3) Balance summaries (RPC) -> off_bal_agent / off_bal_vendor
  for (const [rpc, key] of [
    ["get_agent_balances", "bal_agent"],
    ["get_vendor_balances", "bal_vendor"],
  ] as const) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc(rpc as any) as any);
      if (error) throw error;
      const list = (data as unknown[]) ?? [];
      cacheWrite(key, list);
      rows += list.length;
      ok += 1;
    } catch {
      failed += 1;
    }
    step();
  }

  cacheWrite("meta", {
    saved_at: new Date().toISOString(),
    days,
    ok,
    failed,
    rows,
  });

  return { ok, failed, rows };
}
