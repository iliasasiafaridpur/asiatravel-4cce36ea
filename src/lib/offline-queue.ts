// Offline-resilient insert/update queue. Stored in localStorage so it
// survives PC shutdown / browser restart. Source of truth for auto-sync.
// A JSON backup file is also downloaded to the user's Downloads folder as
// a human-readable safety net.

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const STORAGE_KEY = "offline_queue_v1";
const EVT = "offline-queue:updated";

export type QueueOp = "insert" | "update" | "raw";

export type QueueItem = {
  id: string;
  op?: QueueOp; // default: insert (back-compat)
  table: string;
  payload: Record<string, unknown>;
  /** For updates: equality filters, e.g. { id: "..." } */
  match?: Record<string, unknown>;
  /** For raw HTTP replay (global fetch interceptor) */
  raw?: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | null;
  };
  created_at: string; // ISO
  attempts: number;
  last_error?: string;
};

function read(): QueueItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueueItem[]) : [];
  } catch { return []; }
}
function write(items: QueueItem[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* quota */ }
  try { window.dispatchEvent(new CustomEvent(EVT)); } catch { /* ignore */ }
}

export function getQueue(): QueueItem[] { return read(); }
export function getQueueCount(): number { return read().length; }
export function subscribeQueue(cb: () => void): () => void {
  const h = () => cb();
  window.addEventListener(EVT, h);
  window.addEventListener("storage", h);
  return () => {
    window.removeEventListener(EVT, h);
    window.removeEventListener("storage", h);
  };
}

function pad(n: number) { return n.toString().padStart(2, "0"); }
function tsForFile(d = new Date()) {
  return `${pad(d.getDate())}_${pad(d.getMonth() + 1)}_${d.getFullYear()}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function downloadBackup(item: QueueItem) {
  try {
    const blob = new Blob([JSON.stringify(item, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `offline_backup_${tsForFile(new Date(item.created_at))}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { /* ignore download failure */ }
}

export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (e instanceof TypeError) return true; // fetch failed
  const msg = (e as { message?: string } | null)?.message?.toLowerCase() ?? "";
  return msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("load failed") || msg.includes("timeout");
}

function uid() {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

let lastToastAt = 0;
function offlineToast() {
  const now = Date.now();
  if (now - lastToastAt < 1500) return; // de-dupe rapid bursts
  lastToastAt = now;
  toast.success("ইন্টারনেট নেই! ডাটাটি কম্পিউটারে সুরক্ষিতভাবে অটো-সেভ করা হয়েছে।", { duration: 4000 });
}

/**
 * Insert that survives network failures. On network error: silently queues +
 * downloads a JSON backup + shows a Bengali toast. Returns { offline: true }
 * in that case. On real (non-network) DB errors, throws normally.
 */
export async function resilientInsert(
  table: string,
  payload: Record<string, unknown>,
): Promise<{ offline: boolean }> {
  // The offline ID-regeneration marker is a client-only field; it must never
  // hit the server (PostgREST would reject the unknown column). Strip it for
  // the online attempt but preserve it on the queued copy so the drainer can
  // regenerate a proper sequential ID before its own insert.
  const META_KEY = "__offline_id_meta__";
  const onlinePayload: Record<string, unknown> = { ...payload };
  delete onlinePayload[META_KEY];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from(table as any) as any).insert(onlinePayload);
    if (error) {
      if (isNetworkError(error)) {
        enqueue({ op: "insert", table, payload });
        return { offline: true };
      }
      throw error;
    }
    return { offline: false };
  } catch (e) {
    if (isNetworkError(e)) {
      enqueue({ op: "insert", table, payload });
      return { offline: true };
    }
    throw e;
  }
}

/**
 * Update that survives network failures. `match` is an equality filter map.
 */
export async function resilientUpdate(
  table: string,
  match: Record<string, unknown>,
  patch: Record<string, unknown>,
): Promise<{ offline: boolean }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = (supabase.from(table as any) as any).update(patch);
    for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
    const { error } = await q;
    if (error) {
      if (isNetworkError(error)) {
        enqueue({ op: "update", table, payload: patch, match });
        return { offline: true };
      }
      throw error;
    }
    return { offline: false };
  } catch (e) {
    if (isNetworkError(e)) {
      enqueue({ op: "update", table, payload: patch, match });
      return { offline: true };
    }
    throw e;
  }
}

function enqueue(
  partial:
    | (Pick<QueueItem, "table" | "payload"> & Partial<Pick<QueueItem, "op" | "match">>)
    | { op: "raw"; table: string; payload: Record<string, unknown>; raw: QueueItem["raw"] },
) {
  const item: QueueItem = {
    id: uid(),
    op: partial.op ?? "insert",
    table: partial.table,
    payload: partial.payload,
    match: (partial as { match?: Record<string, unknown> }).match,
    raw: (partial as { raw?: QueueItem["raw"] }).raw,
    created_at: new Date().toISOString(),
    attempts: 0,
  };
  const q = read();
  q.push(item);
  write(q);
  downloadBackup(item);
  offlineToast();
}

/** Public: enqueue a raw HTTP request (used by global fetch interceptor). */
export function enqueueRaw(
  table: string,
  payload: Record<string, unknown>,
  raw: NonNullable<QueueItem["raw"]>,
) {
  enqueue({ op: "raw", table, payload, raw });
}

let draining = false;

async function refreshAuthHeaders(headers: Record<string, string>): Promise<Record<string, string>> {
  // Critical: the token captured when the request was first attempted may have
  // expired by the time we replay (especially after a PC shutdown overnight).
  // Replace Authorization + apikey with the current session's fresh values so
  // the server doesn't reject the replay with 401 Unauthorized.
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const out: Record<string, string> = { ...headers };
    // Normalize header keys (HTTP headers are case-insensitive but fetch keeps case)
    for (const k of Object.keys(out)) {
      const lk = k.toLowerCase();
      if (lk === "authorization" || lk === "apikey") delete out[k];
    }
    const apikey =
      (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? "";
    if (token) out["Authorization"] = `Bearer ${token}`;
    if (apikey) out["apikey"] = apikey;
    return out;
  } catch {
    return headers;
  }
}

async function runItem(item: QueueItem) {
  if (item.op === "raw" && item.raw) {
    const headers = await refreshAuthHeaders(item.raw.headers);
    const res = await fetch(item.raw.url, {
      method: item.raw.method,
      headers,
      body: item.raw.body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        error: {
          message: `HTTP ${res.status}: ${text || res.statusText}`,
          status: res.status,
        },
      };
    }
    return { error: null };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t: any = supabase.from(item.table as any);
  if ((item.op ?? "insert") === "update") {
    let q = t.update(item.payload);
    for (const [k, v] of Object.entries(item.match ?? {})) q = q.eq(k, v);
    return q;
  }
  // For inserts: if the payload carries an offline ID-regeneration marker,
  // call the DB RPC now (we're online) to get a proper sequential ID and
  // overwrite the temporary random local ID before inserting. Falls back to
  // whatever ID is already in the payload if the RPC fails.
  const payload = { ...item.payload };
  const META_KEY = "__offline_id_meta__";
  const meta = payload[META_KEY] as
    | { fn: string; params: Record<string, unknown>; column: string }
    | undefined;
  if (meta && typeof meta === "object" && meta.fn && meta.column) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.rpc(meta.fn as any, meta.params as any);
      if (!error && data) payload[meta.column] = data as unknown;
    } catch { /* keep existing local ID as fallback */ }
    delete payload[META_KEY];
  }
  return t.insert(payload);
}

export async function drainQueue(
  onProgress?: (remaining: number, total: number) => void,
): Promise<{ ok: number; failed: number }> {
  if (draining) return { ok: 0, failed: 0 };
  draining = true;
  let ok = 0; let failed = 0;
  const MAX_ATTEMPTS = 3;
  try {
    let q = read().slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
    const total = q.length;
    while (q.length > 0) {
      const item = q[0];
      try {
        const { error } = await runItem(item);
        if (error) {
          if (isNetworkError(error)) throw error; // stop draining; retry later
          // Real server error (401, 409, 400, RLS, etc.) — increment attempts,
          // keep the item until MAX_ATTEMPTS so user can see what's happening
          // instead of silently losing the entry.
          const all = read();
          const idx = all.findIndex((x) => x.id === item.id);
          if (idx >= 0) {
            all[idx].attempts = (all[idx].attempts ?? 0) + 1;
            all[idx].last_error = (error as { message?: string }).message ?? String(error);
            if (all[idx].attempts >= MAX_ATTEMPTS) {
              // Give up — show detailed reason so user knows what failed.
              const msg = all[idx].last_error ?? "Unknown error";
              try {
                toast.error(
                  `অফলাইন এন্ট্রি সিঙ্ক ব্যর্থ (${item.table}): ${msg.slice(0, 140)}`,
                  { duration: 10000 },
                );
              } catch { /* ignore */ }
              failed += 1;
              all.splice(idx, 1);
            }
            write(all);
          }
          // If attempts < MAX, leave item in queue and stop this drain pass
          // so we don't hammer the server. Next online/focus event retries.
          break;
        } else {
          ok += 1;
          const all = read().filter((x) => x.id !== item.id);
          write(all);
        }
      } catch (e) {
        if (isNetworkError(e)) break;
        failed += 1;
        const all = read().filter((x) => x.id !== item.id);
        write(all);
      }
      q = read().slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
      onProgress?.(q.length, total);
    }
  } finally {
    draining = false;
  }
  return { ok, failed };
}

/** Public: clear all queued items (e.g., user gave up on retrying). */
export function clearQueue() {
  write([]);
}

