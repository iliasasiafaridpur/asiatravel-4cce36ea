// Offline write behavior — DISABLED by user request.
//
// The app previously queued failed inserts/updates in localStorage, downloaded
// a JSON backup for each queued item, and installed a global fetch interceptor
// that captured every failed Supabase write. In practice this caused per-second
// JSON file downloads while offline (every background poll / realtime probe /
// alert-scanner request landed in the queue) and made "offline entries" that
// often failed to sync properly later.
//
// New rule: when the browser is offline, writes are blocked with a clear
// message. Only the read-cache (offline-prefetch / offline-cache) remains, so
// staff can still BROWSE data offline but cannot enter new records or receive
// payments until the internet is back.
//
// The `resilientInsert` / `resilientUpdate` / `enqueueRaw` / `drainQueue`
// entry points are preserved as no-ops or thin wrappers so existing call
// sites keep compiling. Any legacy items already sitting in localStorage
// from an earlier version are drained on next online start-up, then the
// queue stays empty.

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const STORAGE_KEY = "offline_queue_v1";
const EVT = "offline-queue:updated";

export type QueueOp = "insert" | "update" | "raw";

export type QueueItem = {
  id: string;
  op?: QueueOp;
  table: string;
  payload: Record<string, unknown>;
  match?: Record<string, unknown>;
  raw?: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | null;
  };
  created_at: string;
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
  try {
    if (items.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch { /* quota */ }
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

export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (e instanceof TypeError) return true;
  const msg = (e as { message?: string } | null)?.message?.toLowerCase() ?? "";
  return msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("load failed") || msg.includes("timeout");
}

// ---------- User-facing offline block ----------

const OFFLINE_MSG = "ইন্টারনেট নেই — নতুন এন্ট্রি বা পেমেন্ট গ্রহণ করা যাবে না। শুধুমাত্র পুরনো তথ্য দেখা যাবে।";

let lastToastAt = 0;
function offlineBlockToast() {
  const now = Date.now();
  if (now - lastToastAt < 1500) return;
  lastToastAt = now;
  try { toast.error(OFFLINE_MSG, { duration: 4000 }); } catch { /* ignore */ }
}

class OfflineWriteBlockedError extends Error {
  constructor() {
    super(OFFLINE_MSG);
    this.name = "OfflineWriteBlockedError";
  }
}

function blockedIfOffline(): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    offlineBlockToast();
    return true;
  }
  return false;
}

/** Insert. Blocks with an error toast when offline (no queueing). */
export async function resilientInsert(
  table: string,
  payload: Record<string, unknown>,
): Promise<{ offline: boolean }> {
  if (blockedIfOffline()) throw new OfflineWriteBlockedError();
  const clean: Record<string, unknown> = { ...payload };
  delete clean["__offline_id_meta__"]; // legacy marker safety
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from(table as any) as any).insert(clean);
  if (error) {
    if (isNetworkError(error)) {
      offlineBlockToast();
      throw new OfflineWriteBlockedError();
    }
    throw error;
  }
  return { offline: false };
}

/** Update. Blocks with an error toast when offline (no queueing). */
export async function resilientUpdate(
  table: string,
  match: Record<string, unknown>,
  patch: Record<string, unknown>,
): Promise<{ offline: boolean }> {
  if (blockedIfOffline()) throw new OfflineWriteBlockedError();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = (supabase.from(table as any) as any).update(patch);
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const { error } = await q;
  if (error) {
    if (isNetworkError(error)) {
      offlineBlockToast();
      throw new OfflineWriteBlockedError();
    }
    throw error;
  }
  return { offline: false };
}

/** No-op: global fetch interceptor is disabled; nothing enqueues raw writes. */
export function enqueueRaw(
  _table: string,
  _payload: Record<string, unknown>,
  _raw: NonNullable<QueueItem["raw"]>,
) {
  /* offline write queue is disabled */
}

// ---------- Legacy queue drain (best-effort, one shot) ----------

let draining = false;

async function refreshAuthHeaders(headers: Record<string, string>): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const out: Record<string, string> = { ...headers };
    for (const k of Object.keys(out)) {
      const lk = k.toLowerCase();
      if (lk === "authorization" || lk === "apikey") delete out[k];
    }
    const apikey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? "";
    if (token) out["Authorization"] = `Bearer ${token}`;
    if (apikey) out["apikey"] = apikey;
    return out;
  } catch { return headers; }
}

async function runItem(item: QueueItem) {
  if (item.op === "raw" && item.raw) {
    const headers = await refreshAuthHeaders(item.raw.headers);
    const res = await fetch(item.raw.url, { method: item.raw.method, headers, body: item.raw.body });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { error: { message: `HTTP ${res.status}: ${text || res.statusText}`, status: res.status } };
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
  const payload = { ...item.payload };
  delete payload["__offline_id_meta__"];
  return t.insert(payload);
}

/**
 * Drain any legacy queued items left over from the previous "offline write"
 * system. New code never enqueues, so once these are flushed the queue stays
 * empty forever.
 */
export async function drainQueue(): Promise<{ ok: number; failed: number }> {
  if (draining) return { ok: 0, failed: 0 };
  draining = true;
  let ok = 0; let failed = 0;
  const MAX_ATTEMPTS = 3;
  try {
    let q = read().slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
    while (q.length > 0) {
      const item = q[0];
      try {
        const { error } = await runItem(item);
        if (error) {
          if (isNetworkError(error)) break;
          const all = read();
          const idx = all.findIndex((x) => x.id === item.id);
          if (idx >= 0) {
            all[idx].attempts = (all[idx].attempts ?? 0) + 1;
            all[idx].last_error = (error as { message?: string }).message ?? String(error);
            if (all[idx].attempts >= MAX_ATTEMPTS) {
              failed += 1;
              all.splice(idx, 1);
            }
            write(all);
          }
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
    }
  } finally {
    draining = false;
  }
  return { ok, failed };
}

export function clearQueue() { write([]); }
