import { supabase } from "@/integrations/supabase/client";
import type { ModuleSchema } from "./modules";

// Marker key placed on offline-queued inserts so the drainer can regenerate a
// proper sequential ID via the DB RPC before actually inserting online.
// Without this, offline entries would keep their random local ID forever.
export const OFFLINE_ID_META = "__offline_id_meta__";

export type OfflineIdMeta = {
  fn: "next_yearly_id" | "next_module_id" | "next_simple_id";
  params: Record<string, unknown>;
  column: string; // e.g. "bmet_id" — the field on the row that should be replaced
};

// Local fallback only — uses a 3-digit random suffix to keep the ID short
// (e.g. TKT-2605-417). The DB RPC is the canonical source for sequential IDs.
// When an entryDate is provided, the monthly segment (YYMM) is derived from
// that date's month instead of the current month.
function localId(mod: ModuleSchema, entryDate?: string) {
  const base = entryDate ? new Date(entryDate) : new Date();
  const d = isNaN(base.getTime()) ? new Date() : base;
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 900 + 100));
  if (mod.yearlyId) return `${mod.idPrefix}-${yy}-${rand}`;
  return mod.monthlyId
    ? `${mod.idPrefix}-${yy}${mm}-${rand}`
    : `${mod.idPrefix}-${rand}`;
}

// Race an RPC call against a hard timeout so an offline / hung network doesn't
// leave the save spinning forever (SW may hold the request for 5s before
// giving up; we want a faster fallback for a snappy UX).
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("idgen-timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// Build the RPC params exactly like generateNextId — kept in one place so the
// online path and the offline replay path stay in sync.
function buildRpcSpec(mod: ModuleSchema, entryDate?: string): OfflineIdMeta {
  const fn = mod.yearlyId ? "next_yearly_id" : mod.monthlyId ? "next_module_id" : "next_simple_id";
  const params: Record<string, unknown> = {
    _prefix: mod.idPrefix,
    _table: mod.table,
    _column: mod.idColumn,
  };
  if ((mod.yearlyId || mod.monthlyId) && entryDate) params._entry_date = entryDate;
  return { fn, params, column: mod.idColumn };
}

// Calls the appropriate Postgres RPC to generate the next human-readable ID
// for a module (e.g. TKT-2605-001 or AGT-001). Falls back to a short local ID
// if the RPC is unreachable.
// `entryDate` (YYYY-MM-DD) drives the monthly serial: the serial number is
// generated within the month of the selected entry date (e.g. a back-dated
// entry gets a serial in that earlier month).
export async function generateNextId(mod: ModuleSchema, entryDate?: string): Promise<string> {
  // Fast-path: if the browser reports offline, skip the RPC entirely so the
  // save is instant instead of stalling on a hung fetch. The offline queue
  // drainer will regenerate a proper sequential ID before inserting online.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return localId(mod, entryDate);
  }
  try {
    const spec = buildRpcSpec(mod, entryDate);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await withTimeout(
      supabase.rpc(spec.fn as never, spec.params as never) as unknown as Promise<{ data: unknown; error: unknown }>,
      4000,
    );
    if (error || !data) return localId(mod, entryDate);
    return data as string;
  } catch {
    return localId(mod, entryDate);
  }
}

// Public helper: what to attach to an offline-queued insert payload so it can
// be regenerated at drain time. Callers do:
//   payload[OFFLINE_ID_META] = buildOfflineIdMeta(mod, entryDate);
// The queue drainer strips the meta and calls the RPC before inserting.
export function buildOfflineIdMeta(mod: ModuleSchema, entryDate?: string): OfflineIdMeta {
  return buildRpcSpec(mod, entryDate);
}
