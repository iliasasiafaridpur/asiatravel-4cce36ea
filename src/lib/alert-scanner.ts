// Background operational-alert scanner.
//
// Both alert classes are currently DISABLED per user request:
//   1. Financial alert (বকেয়া সতর্কতা) — outstanding-due notifications.
//   2. Aging alert (ডেলিভারি বিলম্ব) — Card Ready 3+ days without delivery.
//
// The scanner is kept as a no-op so the scheduler and all existing callers
// stay intact. Re-enable by restoring the per-table scan logic if needed.

export async function runAlertScanOnce(): Promise<void> {
  // No-op: all operational alerts are turned off.
  return;
}

let started = false;
let timer: number | null = null;

export function startAlertScanner(intervalMs = 5 * 60 * 1000) {
  if (started || typeof window === "undefined") return;
  started = true;
  // Scheduler kept intact for future re-enable; scan itself is a no-op.
  void intervalMs;
}

export function stopAlertScanner() {
  if (timer != null) { window.clearInterval(timer); timer = null; }
  started = false;
}
