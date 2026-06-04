import { QueryClient } from "@tanstack/react-query";
import { createRouter, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { routeTree } from "./routeTree.gen";
import {
  installStaleAssetRecoveryListeners,
  isRecoverableAssetError,
  tryRecoverFromStaleAssets,
} from "./lib/stale-asset-recovery";

function clearBrokenClientCaches() {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem("rq_cache_v1"); } catch { /* ignore */ }
  try { window.localStorage.removeItem("rq_cache_v2"); } catch { /* ignore */ }
  try { window.localStorage.removeItem("rq_cache_v3"); } catch { /* ignore */ }
  if (typeof caches !== "undefined") void caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))));
  if (navigator.serviceWorker?.getRegistrations) {
    void navigator.serviceWorker.getRegistrations().then((regs) => Promise.all(regs.map((reg) => reg.unregister())));
  }
}

function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);

  useEffect(() => {
    try {
      const key = "asia-travel:error-cache-recovered:v1";
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
      clearBrokenClientCaches();
      window.setTimeout(() => window.location.reload(), 250);
    } catch { /* ignore */ }
  }, []);

  if (isRecoverableAssetError(error) && tryRecoverFromStaleAssets()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-muted-foreground">
        অ্যাপ আপডেট হচ্ছে…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">Please refresh once or go back home.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              clearBrokenClientCaches();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const getRouter = () => {
  installStaleAssetRecoveryListeners();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Stale-While-Revalidate: serve cache instantly, refetch in background
        staleTime: 30_000,
        gcTime: 24 * 60 * 60 * 1000, // keep cache for 24h
        refetchOnMount: "always",
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: 1,
      },
    },
  });

  // Persist react-query cache to localStorage so navigation between pages
  // renders instantly from cache on next visit. Keep this BOUNDED — a huge
  // cache freezes the main thread on first paint.
  if (typeof window !== "undefined") {
    void import("@tanstack/query-sync-storage-persister").then(({ createSyncStoragePersister }) => {
      void import("@tanstack/react-query-persist-client").then(({ persistQueryClient }) => {
        try {
          // Hard-cap stored cache to ~1.5 MB; drop if exceeded to avoid jank.
          // v3 intentionally drops the old cache because a previous mobile-color
          // query stored a non-serializable Map and could crash every data page
          // after rehydration.
          const MAX_BYTES = 1_500_000;
          const persister = createSyncStoragePersister({
            storage: window.localStorage,
            key: "rq_cache_v3",
            serialize: (data) => {
              const s = JSON.stringify(data);
              return s.length > MAX_BYTES ? "" : s;
            },
            deserialize: (s) => (s ? JSON.parse(s) : undefined),
          });
          // One-time cleanup of older / known-bad cache keys
          try { window.localStorage.removeItem("rq_cache_v1"); } catch { /* ignore */ }
          try { window.localStorage.removeItem("rq_cache_v2"); } catch { /* ignore */ }
          persistQueryClient({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            queryClient: queryClient as any,
            persister,
            maxAge: 6 * 60 * 60 * 1000, // 6h is plenty; was 24h
            buster: "v3-mobile-color-cache-fix",
          });
        } catch { /* persistence is best-effort */ }
      });
    });
  }

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultPreloadDelay: 50,
    defaultPendingMinMs: 0,
    defaultErrorComponent: DefaultErrorComponent,
  });

  return router;
};
