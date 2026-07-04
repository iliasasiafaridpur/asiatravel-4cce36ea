import { supabase } from "@/integrations/supabase/client";
import type { ModuleSchema } from "./modules";

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

// Calls the appropriate Postgres RPC to generate the next human-readable ID
// for a module (e.g. TKT-2605-001 or AGT-001). Falls back to a short local ID
// if the RPC is unreachable.
// `entryDate` (YYYY-MM-DD) drives the monthly serial: the serial number is
// generated within the month of the selected entry date (e.g. a back-dated
// entry gets a serial in that earlier month).
export async function generateNextId(mod: ModuleSchema, entryDate?: string): Promise<string> {
  try {
    const fn = mod.yearlyId ? "next_yearly_id" : mod.monthlyId ? "next_module_id" : "next_simple_id";
    const params: Record<string, unknown> = {
      _prefix: mod.idPrefix,
      _table: mod.table,
      _column: mod.idColumn,
    };
    if ((mod.yearlyId || mod.monthlyId) && entryDate) params._entry_date = entryDate;
    const { data, error } = await supabase.rpc(fn as never, params as never);
    if (error || !data) return localId(mod, entryDate);
    return data as unknown as string;
  } catch {
    return localId(mod, entryDate);
  }
}
