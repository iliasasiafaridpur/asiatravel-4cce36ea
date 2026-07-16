// Asia Travel — Offline Service Worker
// Strategy:
//   • Navigations (HTML): NetworkFirst with cache fallback → offline page navigation works.
//   • Static assets (JS/CSS/fonts/images): StaleWhileRevalidate → instant + fresh.
//   • Supabase / API: NetworkFirst with short timeout, fall back to cache when offline.

const VERSION = "v10-nav-timeout";
const HTML_CACHE = `html-${VERSION}`;
const ASSET_CACHE = `assets-${VERSION}`;
const API_CACHE = `api-${VERSION}`;
const APP_SHELL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(HTML_CACHE);
    try { await cache.add(new Request(APP_SHELL, { cache: "reload" })); } catch { /* ignore */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => ![HTML_CACHE, ASSET_CACHE, API_CACHE].includes(k))
          .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

async function networkFirst(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await Promise.race([fetch(request), timeout(timeoutMs)]);
    if (fresh && fresh.ok) {
      try { cache.put(request, fresh.clone()); } catch { /* opaque or non-cacheable */ }
    }
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Last resort: fall back to app shell for navigations.
    if (request.mode === "navigate") {
      const shell = await cache.match(APP_SHELL);
      if (shell) return shell;
    }
    throw new Error("offline-no-cache");
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((resp) => {
    if (resp && resp.ok) {
      try { cache.put(request, resp.clone()); } catch { /* ignore */ }
    }
    return resp;
  }).catch(() => cached);
  return cached || fetchPromise;
}

// Cache-first: serve instantly from cache, only hit the network on a miss.
// Safe ONLY for immutable, content-hashed files (the filename changes on every
// build), so there is no risk of serving stale app code after a new release.
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const resp = await fetch(request);
  if (resp && resp.ok) {
    try { cache.put(request, resp.clone()); } catch { /* ignore */ }
  }
  return resp;
}

function isAppBuildAsset(url) {
  return url.pathname.startsWith("/assets/") || url.pathname.includes("/@fs/") || url.pathname.includes("/src/");
}

// Vite production output: /assets/<name>-<hash>.<ext>. The hash makes each file
// immutable, so it can be served cache-first for instant loads even on slow nets.
function isImmutableHashedAsset(url) {
  return (
    url.pathname.startsWith("/assets/") &&
    /-[A-Za-z0-9_]{8,}\.[a-z0-9]+$/i.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Skip non-http(s) (chrome-extension://, data:, etc.)
  if (!url.protocol.startsWith("http")) return;

  // Skip cross-origin third-party trackers; allow same-origin + Supabase.
  const isSameOrigin = url.origin === self.location.origin;
  const isSupabase = url.hostname.endsWith(".supabase.co");

  // 1) Navigations → Network-first (HTML)
  //    Always try the latest app shell first so published UI updates appear
  //    after refresh instead of being hidden by an old offline cache.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(HTML_CACHE);
      // Give the network a bounded window (6s). If it stalls, fall back to
      // cached shell/page instead of hanging the tab indefinitely.
      const fresh = await Promise.race([
        fetch(req).then((resp) => {
          if (resp && resp.ok) {
            try { cache.put(req, resp.clone()); } catch { /* ignore */ }
            try { cache.put(APP_SHELL, resp.clone()); } catch { /* ignore */ }
          }
          return resp;
        }).catch(() => null),
        new Promise((resolve) => setTimeout(() => resolve(null), 6000)),
      ]);

      if (fresh) return fresh;
      const cachedPage = await cache.match(req);
      if (cachedPage) return cachedPage;
      const cachedShell = await cache.match(APP_SHELL);
      if (cachedShell) return cachedShell;
      return new Response(
        "<!doctype html><meta charset='utf-8'><title>Offline</title><body style='font-family:system-ui;background:#0f172a;color:#e5e7eb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:1rem'><div><h1>আপনি অফলাইনে আছেন</h1><p>ইন্টারনেট সংযোগ ফিরে এলে স্বয়ংক্রিয়ভাবে আপডেট হবে।</p></div></body>",
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
      );
    })());
    return;
  }

  // 2) Static same-origin assets.
  // 2a) Immutable hashed build files (/assets/<name>-<hash>.<ext>) → CACHE-FIRST.
  //     Instant from cache; no network wait even on slow connections. A new
  //     release ships new filenames, so this can never serve stale app code.
  if (isSameOrigin && isImmutableHashedAsset(url)) {
    event.respondWith(cacheFirst(req, ASSET_CACHE));
    return;
  }
  // 2b) Non-hashed app JS/CSS (dev /src/, /@fs/, root scripts) → Network-first,
  //     so a fixed bug can't keep crashing published pages from a stale cache.
  if (isSameOrigin) {
    const dest = req.destination;
    if (isAppBuildAsset(url) || ["script", "style", "worker"].includes(dest) || /\.(?:js|mjs|css)$/i.test(url.pathname)) {
      event.respondWith(networkFirst(req, ASSET_CACHE, 3000));
      return;
    }
    if (["script", "style", "font", "image", "worker"].includes(dest) ||
        /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|webp|svg|gif|ico)$/i.test(url.pathname)) {
      event.respondWith(staleWhileRevalidate(req, ASSET_CACHE));
      return;
    }
  }

  // 3) Supabase reads → NetworkFirst (cache GETs so data shows offline)
  if (isSupabase) {
    event.respondWith(networkFirst(req, API_CACHE, 5000).catch(() => {
      return new Response(JSON.stringify({ offline: true, data: null }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }));
    return;
  }
});

// Allow client to trigger update
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
