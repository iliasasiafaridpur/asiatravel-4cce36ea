// Offline-resilient insert queue. Stored in localStorage so it survives
// PC shutdown / browser restart. Source of truth for auto-sync. A JSON
// backup file is also downloaded to the user's Downloads folder as a
// human-readable safety net (browsers cannot read it back automatically).

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const STORAGE_KEY = "offline_queue_v1";
const EVT = "offline-queue:updated";

export type QueueItem = {
  id: string;
  table: string;
  payload: Record<string, unknown>;
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

function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (e instanceof TypeError) return true; // fetch failed
  const msg = (e as { message?: string } | null)?.message?.toLowerCase() ?? "";
  return msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("load failed") || msg.includes("timeout");
}

function uid() {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from(table as any) as any).insert(payload);
    if (error) {
      if (isNetworkError(error)) {
        enqueue(table, payload);
        return { offline: true };
      }
      throw error;
    }
    return { offline: false };
  } catch (e) {
    if (isNetworkError(e)) {
      enqueue(table, payload);
      return { offline: true };
    }
    throw e;
  }
}

function enqueue(table: string, payload: Record<string, unknown>) {
  const item: QueueItem = {
    id: uid(),
    table,
    payload,
    created_at: new Date().toISOString(),
    attempts: 0,
  };
  const q = read();
  q.push(item);
  write(q);
  downloadBackup(item);
  toast.success("ইন্টারনেট নেই! ডাটাটি কম্পিউটারে সুরক্ষিতভাবে অটো-সেভ করা হয়েছে।", { duration: 4000 });
}

let draining = false;

export async function drainQueue(
  onProgress?: (remaining: number, total: number) => void,
): Promise<{ ok: number; failed: number }> {
  if (draining) return { ok: 0, failed: 0 };
  draining = true;
  let ok = 0; let failed = 0;
  try {
    let q = read().slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
    const total = q.length;
    while (q.length > 0) {
      const item = q[0];
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.from(item.table as any) as any).insert(item.payload);
        if (error) {
          if (isNetworkError(error)) throw error; // stop draining; retry later
          // Real DB error — drop after marking. Keep going.
          item.attempts += 1;
          item.last_error = (error as { message?: string }).message ?? String(error);
          failed += 1;
          // Remove poisoned record so it doesn't block sync forever
          const all = read().filter((x) => x.id !== item.id);
          write(all);
        } else {
          ok += 1;
          const all = read().filter((x) => x.id !== item.id);
          write(all);
        }
      } catch (e) {
        if (isNetworkError(e)) {
          // Network died mid-drain — bail; will retry on next online event.
          break;
        }
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
