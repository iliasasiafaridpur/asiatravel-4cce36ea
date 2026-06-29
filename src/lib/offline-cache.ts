// Shared offline read-cache.
//
// The "অফলাইনে সেভ" button (offline-prefetch.ts) writes full snapshots of the
// support tables (ledgers, accounts, balances, contacts) under the `off_` prefix.
// Pages read those snapshots when the device is offline (or a live query fails)
// so the WHOLE app — modules, ledgers, accounts, balances — can be browsed
// without a connection.

const PREFIX = "off_";

export function cacheWrite(key: string, data: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(data));
  } catch {
    /* quota exceeded — skip this slice */
  }
}

export function cacheRead<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** True when the browser reports no network connection. */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Read a ModulePage snapshot (Air Ticket/BMET/visa/others) written as `cache_v2_<table>`. */
export function readModuleCache<T = Record<string, unknown>>(table: string): T[] {
  try {
    const raw = localStorage.getItem(`cache_v2_${table}`);
    return raw ? ((JSON.parse(raw) as T[]) ?? []) : [];
  } catch {
    return [];
  }
}
