// One-tap offline pre-loader.
//
// Fetches roughly the last month of data for every main data module and writes
// it into the SAME localStorage cache key each ModulePage reads on mount
// (`cache_v2_<table>`). This means pages the user has NOT opened yet will still
// have data available when the connection drops — they hydrate instantly from
// this cache and skip the (failing) network load while offline.

import { supabase } from "@/integrations/supabase/client";

const DAY = 24 * 60 * 60 * 1000;
const MAX_ROWS = 1500;

// Tables backed by ModulePage (they all read `cache_v2_<table>`).
const PRELOAD_TABLES = [
  "tickets",
  "bmet_cards",
  "saudi_visas",
  "kuwait_visas",
  "others",
] as const;

export type PrefetchResult = { ok: number; failed: number; rows: number };

/**
 * Pre-load ~1 month of data for offline use.
 * @param days how far back to fetch (default 31)
 * @param onProgress called as each module finishes: (done, total)
 */
export async function prefetchMonthData(
  days = 31,
  onProgress?: (done: number, total: number) => void,
): Promise<PrefetchResult> {
  const cutoff = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  let ok = 0;
  let failed = 0;
  let rows = 0;
  const total = PRELOAD_TABLES.length;

  for (let i = 0; i < PRELOAD_TABLES.length; i++) {
    const table = PRELOAD_TABLES[i];
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
      } catch { /* quota — skip this table's cache */ }
      rows += list.length;
      ok += 1;
    } catch {
      failed += 1;
    }
    onProgress?.(i + 1, total);
  }

  return { ok, failed, rows };
}
