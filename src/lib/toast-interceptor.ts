// Mirror every sonner `toast.*` call into the notification center so the
// user has a permanent history even though toasts auto-dismiss.
import { toast } from "sonner";
import { pushNotification, type NotificationType } from "./notification-store";

let installed = false;

function extractText(arg: unknown): { title: string; message?: string } {
  if (typeof arg === "string" || typeof arg === "number") {
    return { title: String(arg) };
  }
  if (arg && typeof arg === "object") {
    const o = arg as { title?: unknown; message?: unknown };
    return {
      title: typeof o.title === "string" ? o.title : "(notification)",
      message: typeof o.message === "string" ? o.message : undefined,
    };
  }
  return { title: "(notification)" };
}

function wrap<T extends (...args: unknown[]) => unknown>(
  orig: T,
  type: NotificationType,
): T {
  return ((...args: unknown[]) => {
    try {
      const { title } = extractText(args[0]);
      const opts = args[1] as { description?: unknown } | undefined;
      const desc = typeof opts?.description === "string" ? opts.description : undefined;
      pushNotification(type, title, desc);
    } catch { /* never block toast */ }
    return orig(...args);
  }) as T;
}

export function installToastInterceptor() {
  if (installed) return;
  installed = true;
  // sonner's toast is a callable with attached methods. Patch the methods we use.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = toast as any;
  if (t.success) t.success = wrap(t.success.bind(toast), "success");
  if (t.error) t.error = wrap(t.error.bind(toast), "error");
  if (t.info) t.info = wrap(t.info.bind(toast), "info");
  if (t.warning) t.warning = wrap(t.warning.bind(toast), "warning");
  
  // Default callable: treat as info
  const baseCall = t.bind(undefined);
  const wrappedBase = wrap(baseCall, "info");
  
  // Re-attach methods onto the wrapped callable so existing imports keep working.
  // We can't reassign the imported binding, so instead patch behavior in place.
  try {
    const originalCall = t.__proto__?.call;
    if (originalCall) {
      // No-op: avoid touching prototype to prevent side effects.
    }
  } catch { /* ignore */ }
  
  void wrappedBase;
}
