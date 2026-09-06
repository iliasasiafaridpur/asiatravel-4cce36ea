// Supabase / PostgREST caps every response at 1000 rows (db-max-rows), even when
// a bigger `.limit()` is requested. Any page that sums or lists a whole table
// (payment receipts, expenses, handovers) silently loses the NEWEST/oldest rows
// past that cap — which shows up as wrong cash balances and missing handover
// details. `fetchAllRows` re-runs the same query in 1000-row windows and
// concatenates the result, keeping the familiar `{ data, error }` shape.

type RangeQuery = {
  range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export async function fetchAllRows<T>(
  build: () => RangeQuery,
  opts?: { chunk?: number; max?: number },
): Promise<{ data: T[]; error: { message: string } | null }> {
  const chunk = opts?.chunk ?? 1000;
  const max = opts?.max ?? 50000;
  const out: T[] = [];
  for (let from = 0; from < max; from += chunk) {
    const { data, error } = await build().range(from, from + chunk - 1);
    if (error) return { data: out, error };
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < chunk) break;
  }
  return { data: out, error: null };
}
