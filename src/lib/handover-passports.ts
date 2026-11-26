/** Read-only identity enrichment; never changes bills, receipts or grouping. */
export type PassportRow = Record<string, unknown>;
export type PassportReader = (table: string, ids: string[], columns: string) => Promise<PassportRow[]>;
const bookingTables = new Set(["tickets", "bmet_cards", "saudi_visas", "kuwait_visas", "others"]);
const linkedTables = new Set(["agency_ledger", "extra_services"]);
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export async function resolveHandoverPassports(keys: string[], read: PassportReader): Promise<Record<string, string>> {
  const rows = new Map<string, PassportRow>();
  const requested = new Set<string>();
  let pending = keys;
  while (pending.length) {
    const groups = new Map<string, Set<string>>();
    for (const key of pending) {
      if (requested.has(key)) continue;
      requested.add(key);
      const [table, id] = key.split(":");
      if (!table || !id || (!bookingTables.has(table) && !linkedTables.has(table))) continue;
      const ids = groups.get(table) ?? new Set<string>();
      ids.add(id);
      groups.set(table, ids);
    }
    const next: string[] = [];
    await Promise.all(Array.from(groups, async ([table, ids]) => {
      const columns = linkedTables.has(table) ? "id,passport,source_table,source_id" : "id,passport";
      for (const row of await read(table, Array.from(ids), columns)) {
        const key = `${table}:${String(row['id'])}`;
        rows.set(key, row);
        if (linkedTables.has(table) && text(row['source_table']) && text(row['source_id'])) {
          next.push(`${text(row['source_table'])}:${text(row['source_id'])}`);
        }
      }
    }));
    pending = next;
  }
  const resolve = (key: string, visited = new Set<string>()): string => {
    if (visited.has(key)) return "";
    visited.add(key);
    const row = rows.get(key);
    if (!row) return "";
    const [table] = key.split(":");
    const own = text(row['passport']);
    if (!table || !linkedTables.has(table)) return own;
    // The booking is authoritative; linked snapshots may be blank or stale.
    const parent = `${text(row['source_table'])}:${text(row['source_id'])}`;
    return resolve(parent, visited) || own;
  };
  return Object.fromEntries(keys.map(key => [key, resolve(key)]));
}