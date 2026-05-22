// Typed wrapper around sonner toast that allows attaching `meta` / `dedupeKey`
// for the notification center (see toast-interceptor.ts). Sonner's
// ExternalToast type rejects unknown keys, so we widen here in one place.
import { toast } from "sonner";
import type { NotificationMeta } from "@/lib/notification-store";

type Opts = { meta?: NotificationMeta; dedupeKey?: string; description?: string };

function call(fn: (msg: string, o?: unknown) => unknown, msg: string, opts?: Opts) {
  fn(msg, opts as unknown);
}

export const notify = {
  success: (msg: string, opts?: Opts) => call(toast.success.bind(toast), msg, opts),
  error:   (msg: string, opts?: Opts) => call(toast.error.bind(toast),   msg, opts),
  info:    (msg: string, opts?: Opts) => call(toast.info.bind(toast),    msg, opts),
  warning: (msg: string, opts?: Opts) => call(toast.warning.bind(toast), msg, opts),
};
