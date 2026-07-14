// Global fetch interceptor — DISABLED.
//
// Previously this captured every failed Supabase write while offline and
// pushed it into the offline queue. In practice it also captured background
// polling / realtime probes / alert-scanner requests, which caused the app to
// download a JSON backup file every second while offline. Offline writes are
// no longer supported (see src/lib/offline-queue.ts), so this interceptor is
// intentionally a no-op. Kept as an export so existing call sites compile.

export function installGlobalFetchInterceptor(): void {
  /* offline write queue is disabled */
}
