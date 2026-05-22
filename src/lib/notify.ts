// Typed wrapper around sonner toast that allows attaching `meta` / `dedupeKey`
// for the notification center (see toast-interceptor.ts). Sonner's
// ExternalToast type rejects unknown keys, so we widen here in one place.
import { toast } from "sonner";
import type { NotificationMeta } from "@/lib/notification-store";

type Opts = { meta?: NotificationMeta; dedupeKey?: string; description?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const t = toast as any;

export const notify = {
  success: (msg: string, opts?: Opts) => t.success(msg, opts),
  error:   (msg: string, opts?: Opts) => t.error(msg, opts),
  info:    (msg: string, opts?: Opts) => t.info(msg, opts),
  warning: (msg: string, opts?: Opts) => t.warning(msg, opts),
};
