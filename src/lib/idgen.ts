import { supabase } from "@/integrations/supabase/client";
import type { ModuleSchema } from "./modules";

// Calls the appropriate Postgres RPC to generate the next human-readable ID
// for a module (e.g. TKT-2605-001 or AGT-001).
export async function generateNextId(mod: ModuleSchema): Promise<string> {
  const fn = mod.monthlyId ? "next_module_id" : "next_simple_id";
  const { data, error } = await supabase.rpc(fn as never, {
    _prefix: mod.idPrefix,
    _table: mod.table,
    _column: mod.idColumn,
  } as never);
  if (error) throw error;
  return data as unknown as string;
}
