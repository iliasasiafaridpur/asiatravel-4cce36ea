// Registers the offline service worker — but ONLY in safe contexts.
// In Lovable preview / iframe we MUST NOT register, otherwise the SW will
// cache stale builds and break the editor preview.

export function registerOfflineSW() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const host = window.location.hostname;
  const isPreviewHost =
    host.includes("id-preview--") ||
    host.includes("lovableproject.com") ||
    host === "localhost" ||
    host === "127.0.0.1";

  let isInIframe = false;
  try { isInIframe = window.self !== window.top; } catch { isInIframe = true; }

  // In preview / iframe / localhost: actively UNREGISTER any existing SW.
  if (isPreviewHost || isInIframe) {
    void navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister().catch(() => {}));
    });
    return;
  }

  // Production / published / custom domain: register.
  const register = () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        // Check for updates periodically
        setInterval(() => { reg.update().catch(() => {}); }, 60 * 60 * 1000);
      })
      .catch((err) => {
        // Non-fatal
        console.warn("[sw] registration failed", err);
      });
  };

  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
