import { supabase } from "@/integrations/supabase/client";
import type { ModuleSchema } from "./modules";

// Local fallback only — uses a 3-digit random suffix to keep the ID short
// (e.g. TKT-2605-417). The DB RPC is the canonical source for sequential IDs.
function localId(mod: ModuleSchema) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 900 + 100));
  return mod.monthlyId
    ? `${mod.idPrefix}-${yy}${mm}-${rand}`
    : `${mod.idPrefix}-${rand}`;
}

// Calls the appropriate Postgres RPC to generate the next human-readable ID
// for a module (e.g. TKT-2605-001 or AGT-001). Falls back to a short local ID
// if the RPC is unreachable.
export async function generateNextId(mod: ModuleSchema): Promise<string> {
  try {
    const fn = mod.monthlyId ? "next_module_id" : "next_simple_id";
    const { data, error } = await supabase.rpc(fn as never, {
      _prefix: mod.idPrefix,
      _table: mod.table,
      _column: mod.idColumn,
    } as never);
    if (error || !data) return localId(mod);
    return data as unknown as string;
  } catch {
    return localId(mod);
  }
}
