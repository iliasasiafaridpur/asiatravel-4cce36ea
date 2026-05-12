import { supabase } from "@/integrations/supabase/client";
import type { ModuleSchema } from "./modules";

function localId(mod: ModuleSchema) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 900 + 100);
  return mod.monthlyId
    ? `${mod.idPrefix}-${yy}${mm}-${dd}${hh}${mi}${ss}${rand}`
    : `${mod.idPrefix}-${yy}${mm}${dd}${hh}${mi}${ss}${rand}`;
}

// Calls the appropriate Postgres RPC to generate the next human-readable ID
// for a module (e.g. TKT-2605-001 or AGT-001).
export async function generateNextId(mod: ModuleSchema): Promise<string> {
  // Fast path: generate locally so saving needs only one database request.
  // The timestamp + random suffix keeps IDs unique across users without waiting
  // for a max-id scan RPC before every insert.
  if (typeof window !== "undefined") return localId(mod);

  const fn = mod.monthlyId ? "next_module_id" : "next_simple_id";
  const { data, error } = await supabase.rpc(fn as never, {
    _prefix: mod.idPrefix,
    _table: mod.table,
    _column: mod.idColumn,
  } as never);
  if (error) return localId(mod);
  return (data as unknown as string) || localId(mod);
}
