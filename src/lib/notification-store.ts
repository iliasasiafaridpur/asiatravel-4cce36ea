// Centralized notification history (persisted in localStorage).
// Powers the header bell dropdown. Toast calls are mirrored here via
// `toast-interceptor.ts` so the user has a permanent log of sync/error/success
// events.

const KEY = "notification_center_v1";
const EVT = "notification-center:updated";
const MAX = 100;

export type NotificationType = "success" | "error" | "info" | "warning";

export type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  created_at: string; // ISO
  read: boolean;
};

function read(): NotificationItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as NotificationItem[]) : [];
  } catch { return []; }
}
function write(items: NotificationItem[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX))); } catch { /* quota */ }
  try { window.dispatchEvent(new CustomEvent(EVT)); } catch { /* ignore */ }
}

export function getNotifications(): NotificationItem[] { return read(); }
export function getUnreadCount(): number { return read().filter((n) => !n.read).length; }

export function subscribeNotifications(cb: () => void): () => void {
  const h = () => cb();
  window.addEventListener(EVT, h);
  window.addEventListener("storage", h);
  return () => {
    window.removeEventListener(EVT, h);
    window.removeEventListener("storage", h);
  };
}

export function pushNotification(
  type: NotificationType,
  title: string,
  message?: string,
) {
  if (typeof window === "undefined") return;
  const item: NotificationItem = {
    id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    title,
    message,
    created_at: new Date().toISOString(),
    read: false,
  };
  const list = [item, ...read()];
  write(list);
}

export function markAllRead() {
  write(read().map((n) => ({ ...n, read: true })));
}

export function markRead(id: string) {
  write(read().map((n) => (n.id === id ? { ...n, read: true } : n)));
}

export function clearNotifications() { write([]); }
