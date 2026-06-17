// Mirror every sonner `toast.*` call into the notification center so the
// user has a permanent history even though toasts auto-dismiss. Sonner
// option objects may carry our extension fields `meta` / `dedupeKey` which
// are forwarded to the notification store but stripped from sonner itself.
import { toast } from "sonner";
import {
  pushNotification,
  type NotificationType,
  type NotificationMeta,
} from "./notification-store";

let installed = false;

function titleOf(arg: unknown): string {
  if (typeof arg === "string" || typeof arg === "number") return String(arg);
  if (arg && typeof arg === "object") {
    const t = (arg as { title?: unknown }).title;
    if (typeof t === "string") return t;
  }
  return "(notification)";
}

function wrap(
  orig: (...args: unknown[]) => unknown,
  type: NotificationType,
  /** When false, the toast still shows but is NOT stored in the bell history. */
  record: boolean,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    if (record) {
      try {
        const title = titleOf(args[0]);
        const opts = args[1] as
          | { description?: unknown; meta?: NotificationMeta; dedupeKey?: string }
          | undefined;
        const desc = typeof opts?.description === "string" ? opts.description : undefined;
        pushNotification(type, title, desc, {
          meta: opts?.meta,
          dedupeKey: opts?.dedupeKey,
        });
      } catch { /* never block toast */ }
    }
    return orig(...args);
  };
}

export function installToastInterceptor() {
  if (installed) return;
  installed = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = toast as any;
  // Only ERRORS and WARNINGS are kept in the bell history — routine success /
  // info toasts (saved, updated, deleted, synced …) are too noisy and no longer
  // recorded. They still flash as transient toasts.
  if (typeof t.success === "function") t.success = wrap(t.success.bind(toast), "success", false);
  if (typeof t.error   === "function") t.error   = wrap(t.error.bind(toast),   "error",   true);
  if (typeof t.info    === "function") t.info    = wrap(t.info.bind(toast),    "info",    false);
  if (typeof t.warning === "function") t.warning = wrap(t.warning.bind(toast), "warning", true);
}
