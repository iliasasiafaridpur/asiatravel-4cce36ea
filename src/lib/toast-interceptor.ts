// Mirror every sonner `toast.*` call into the notification center so the
// user has a permanent history even though toasts auto-dismiss.
import { toast } from "sonner";
import { pushNotification, type NotificationType } from "./notification-store";

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
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    try {
      const title = titleOf(args[0]);
      const opts = args[1] as { description?: unknown } | undefined;
      const desc = typeof opts?.description === "string" ? opts.description : undefined;
      pushNotification(type, title, desc);
    } catch { /* never block toast */ }
    return orig(...args);
  };
}

export function installToastInterceptor() {
  if (installed) return;
  installed = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = toast as any;
  if (typeof t.success === "function") t.success = wrap(t.success.bind(toast), "success");
  if (typeof t.error   === "function") t.error   = wrap(t.error.bind(toast),   "error");
  if (typeof t.info    === "function") t.info    = wrap(t.info.bind(toast),    "info");
  if (typeof t.warning === "function") t.warning = wrap(t.warning.bind(toast), "warning");
}
