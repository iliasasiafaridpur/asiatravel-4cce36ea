// Registers the offline service worker. Preview/iframe auto-registration stays
// disabled to avoid stale editor builds, but the explicit "অফলাইনে সেভ" action
// may force registration because offline browsing needs an active SW shell.

const OFFLINE_SW_ENABLED_KEY = "asia-travel:offline-sw-enabled:v1";

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

function isPreviewHost(host: string) {
  return (
    host.includes("id-preview--") ||
    host.includes("lovableproject.com") ||
    host === "localhost" ||
    host === "127.0.0.1"
  );
}

function offlineSwWasExplicitlyEnabled() {
  try {
    return window.localStorage.getItem(OFFLINE_SW_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function registerOfflineSW(options: { force?: boolean } = {}): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!("serviceWorker" in navigator)) return Promise.resolve(null);

  const host = window.location.hostname;
  const previewHost = isPreviewHost(host);

  let isInIframe = false;
  try { isInIframe = window.self !== window.top; } catch { isInIframe = true; }

  const forced = options.force === true;
  if (forced) {
    try { window.localStorage.setItem(OFFLINE_SW_ENABLED_KEY, "1"); } catch { /* ignore */ }
  }

  // In preview / iframe / localhost: do not auto-register unless the user
  // explicitly clicked "অফলাইনে সেভ". Do not unregister while offline.
  if ((previewHost || isInIframe) && !forced && !offlineSwWasExplicitlyEnabled()) {
    if (typeof navigator !== "undefined" && navigator.onLine !== false) {
      void navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister().catch(() => {}));
      });
    }
    return Promise.resolve(null);
  }

  if (registrationPromise) return registrationPromise;

  // Production / published / custom domain: register.
  const register = async () => {
    try {
      const reg = await navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      // Check for updates periodically
      setInterval(() => { reg.update().catch(() => {}); }, 60 * 60 * 1000);
      try { await navigator.serviceWorker.ready; } catch { /* ignore */ }
      return reg;
    } catch (err) {
      // Non-fatal
      console.warn("[sw] registration failed", err);
      return null;
    }
  };

  registrationPromise = document.readyState === "complete"
    ? register()
    : new Promise((resolve) => window.addEventListener("load", () => resolve(register()), { once: true }));

  return registrationPromise;
}
