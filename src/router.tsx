import { QueryClient } from "@tanstack/react-query";
import { createRouter, Link } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import {
  installStaleAssetRecoveryListeners,
  isRecoverableAssetError,
  tryRecoverFromStaleAssets,
} from "./lib/stale-asset-recovery";

function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);

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
            onClick={reset}
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
  // renders instantly from cache on next visit.
  if (typeof window !== "undefined") {
    void import("@tanstack/query-sync-storage-persister").then(({ createSyncStoragePersister }) => {
      void import("@tanstack/react-query-persist-client").then(({ persistQueryClient }) => {
        try {
          persistQueryClient({
            queryClient,
            persister: createSyncStoragePersister({ storage: window.localStorage, key: "rq_cache_v1" }),
            maxAge: 24 * 60 * 60 * 1000,
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
