import { useEffect, useState } from "react";
const ORBITRON_LINK = { rel: "preconnect", href: "https://fonts.googleapis.com" };
const ORBITRON_LINK2 = { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" };
const ORBITRON_CSS = { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700;800;900&display=swap" };
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";
import { AuthGate, LogoutButton } from "@/components/AuthGate";
import { OfflineSyncManager } from "@/components/OfflineSyncManager";
import { ScrollToTopButton } from "@/components/ScrollToTopButton";
import { NotificationBell } from "@/components/NotificationBell";
import { HandoverHeaderButton } from "@/components/HandoverHeaderButton";
import { MasterSearchHeaderButton } from "@/components/MasterSearchHeaderButton";
import { installToastInterceptor } from "@/lib/toast-interceptor";
import {
  clearStaleAssetRecoveryFlag,
  isRecoverableAssetError,
  tryRecoverFromStaleAssets,
} from "@/lib/stale-asset-recovery";

import appCss from "../styles.css?url";

function clearBrokenClientCaches() {
  if (typeof window === "undefined") return;
  // NEVER wipe caches / unregister the service worker while offline. Offline
  // route errors (failed network fetch) are expected — clearing here would
  // destroy the saved offline data and kill the SW, forcing the browser's
  // native "no internet" page on every navigation.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  try { window.localStorage.removeItem("rq_cache_v1"); } catch { /* ignore */ }
  try { window.localStorage.removeItem("rq_cache_v2"); } catch { /* ignore */ }
  try { window.localStorage.removeItem("rq_cache_v3"); } catch { /* ignore */ }
  if (typeof caches !== "undefined") void caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))));
  if (navigator.serviceWorker?.getRegistrations) {
    void navigator.serviceWorker.getRegistrations().then((regs) => Promise.all(regs.map((reg) => reg.unregister())));
  }
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  useEffect(() => {
    // Offline: do NOT clear caches or reload — that wipes the offline data and
    // shows the browser's "no internet" page. Let cached content render instead.
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    try {
      const key = "asia-travel:root-error-cache-recovered:v1";
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

  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            আপনি এখন অফলাইনে আছেন
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            এই পেজের নতুন ডাটা ইন্টারনেট ছাড়া আনা যাচ্ছে না। আগে "অফলাইনে সেভ"
            করা থাকলে অন্য পেজগুলো খুলে দেখা যাবে। ইন্টারনেট ফিরে এলে আবার চেষ্টা করুন।
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button
              onClick={() => { router.invalidate(); reset(); }}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              আবার চেষ্টা করুন
            </button>
            <Link
              to="/"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              হোমে যান
            </Link>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              clearBrokenClientCaches();
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#0f172a" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "AsiaTravel" },
      { title: "ASIA TOURS AND TRAVEL" },
      { name: "description", content: "Travels Management is a travel agency management application for tracking passenger information and travel statuses." },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "ASIA TOURS AND TRAVEL" },
      { property: "og:description", content: "Travels Management is a travel agency management application for tracking passenger information and travel statuses." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "ASIA TOURS AND TRAVEL" },
      { name: "twitter:description", content: "Travels Management is a travel agency management application for tracking passenger information and travel statuses." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/qOyCu4HoHOUZ6podTkawyCuD4wB3/social-images/social-1778501361157-Blue___White_Simple_Travel_Agency_Logo.webp" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/qOyCu4HoHOUZ6podTkawyCuD4wB3/social-images/social-1778501361157-Blue___White_Simple_Travel_Agency_Logo.webp" },
    ],
      links: [
        { rel: "stylesheet", href: appCss },
        ORBITRON_LINK,
        ORBITRON_LINK2,
        ORBITRON_CSS,
        { rel: "apple-touch-icon", href: "/icon-512.png" },
        // Browser-tab favicon: simplified airplane mark — readable at tiny sizes
        // (the full emblem's text/globe is illegible as a favicon).
        { rel: "icon", href: "/favicon.png", type: "image/png" },
      ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Critical inline CSS — keeps the SSR page readable before Tailwind CSS loads */}
        <style dangerouslySetInnerHTML={{ __html: `
          html,body{margin:0;background:#0f172a;color:#e5e7eb;font-family:system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
        ` }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const [dark, setDark] = useState(true);
  useEffect(() => {
    clearStaleAssetRecoveryFlag();
    installToastInterceptor();
    void import("@/lib/register-sw").then(({ registerOfflineSW }) => registerOfflineSW());
    void import("@/lib/global-fetch-interceptor").then(({ installGlobalFetchInterceptor }) =>
      installGlobalFetchInterceptor(),
    );
    // Power-cut recovery: detect pre-existing queued items from previous session
    void import("@/lib/offline-queue").then(({ getQueueCount }) => {
      const pending = getQueueCount();
      if (pending > 0) {
        void import("@/lib/notification-store").then(({ pushNotification }) => {
          pushNotification(
            "info",
            "পূর্বের সেশনের অফলাইন এন্ট্রি পাওয়া গেছে",
            `${pending} টি অসিঙ্ক এন্ট্রি লোকাল স্টোরেজে সংরক্ষিত আছে — ইন্টারনেট এলেই অটো-সিঙ্ক হবে।`,
          );
        });
      }
    });
    // Background operational alerts (financial / aging)
    void import("@/lib/alert-scanner").then(({ startAlertScanner }) => startAlertScanner());
  }, []);

  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);

  // GLOBAL "last-clicked row" highlight — works on every page (all module data
  // pages, customer/vendor ledgers, my accounts, etc.). Whenever any tinted row
  // is clicked, mark it active and clear the previous one. Persists until
  // another row is clicked (or the list re-renders).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const row = target.closest('[class*="row-tint-"]');
      document.querySelectorAll(".row-active").forEach((el) => {
        if (el !== row) el.classList.remove("row-active");
      });
      if (row) row.classList.add("row-active");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <SidebarProvider>
          <div className="min-h-screen flex w-full bg-background">
            <AppSidebar />
            <div className="flex-1 flex flex-col min-w-0">
              <header className="h-12 flex items-center justify-between border-b border-border px-2 sticky top-0 z-30 bg-background/85 backdrop-blur">
                <SidebarTrigger />
                <div className="flex items-center gap-1.5">
                  <MasterSearchHeaderButton />
                  <HandoverHeaderButton />
                  <NotificationBell />
                  <Button variant="ghost" size="icon" onClick={() => setDark((d) => !d)} aria-label="Toggle theme">
                    {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  </Button>
                  <LogoutButton />
                </div>
              </header>
              <main className="flex-1 p-3 sm:p-5 max-w-full overflow-x-hidden">
                <Outlet />
              </main>
            </div>
          </div>
        </SidebarProvider>
      </AuthGate>
      <ScrollToTopButton />
      <OfflineSyncManager />
      <Toaster richColors position="top-center" />
    </QueryClientProvider>
  );
}
