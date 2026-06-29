export const STALE_ASSET_RECOVERY_KEY = "asia-travel:stale-asset-reload:v2";

const MODULE_LOAD_ERROR_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i;

export function isRecoverableAssetError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String((error as { message?: unknown } | null)?.message ?? error ?? "");
  return MODULE_LOAD_ERROR_RE.test(message);
}

export function tryRecoverFromStaleAssets() {
  if (typeof window === "undefined") return false;
  // A dynamic import can fail simply because the device is offline. In that
  // case clearing caches/unregistering the service worker makes offline mode
  // worse by deleting the very shell needed to keep the app open.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try {
    if (window.sessionStorage.getItem(STALE_ASSET_RECOVERY_KEY)) return false;
    window.sessionStorage.setItem(STALE_ASSET_RECOVERY_KEY, String(Date.now()));
  } catch {
    return false;
  }

  void Promise.allSettled([
    typeof caches !== "undefined" ? caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))) : Promise.resolve(),
    navigator.serviceWorker?.getRegistrations
      ? navigator.serviceWorker.getRegistrations().then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
      : Promise.resolve(),
  ]).finally(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("app_refresh", String(Date.now()));
    window.location.replace(url.toString());
  });

  return true;
}

export function clearStaleAssetRecoveryFlag() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STALE_ASSET_RECOVERY_KEY);
  } catch {
    // Ignore storage access restrictions.
  }
}

export function installStaleAssetRecoveryListeners() {
  if (typeof window === "undefined") return;
  const w = window as Window & { __asiaTravelAssetRecoveryInstalled?: boolean };
  if (w.__asiaTravelAssetRecoveryInstalled) return;
  w.__asiaTravelAssetRecoveryInstalled = true;

  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    tryRecoverFromStaleAssets();
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (isRecoverableAssetError(event.reason)) {
      event.preventDefault();
      tryRecoverFromStaleAssets();
    }
  });
}