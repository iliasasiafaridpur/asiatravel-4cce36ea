// Global fetch interceptor — catches "TypeError: Failed to fetch" on any
// Supabase REST write (insert/update/upsert/delete) from anywhere in the
// app and routes it to the offline queue. Returns a synthetic success
// Response so callers (supabase-js, custom fetches) don't crash with a
// red banner. Also auto-drains the queue when the browser comes back online.

import { enqueueRaw, drainQueue, isNetworkError } from "./offline-queue";

let installed = false;

function getSupabaseHost(): string | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
  try { return url ? new URL(url).host : null; } catch { return null; }
}

function isWriteMethod(m: string): boolean {
  const u = m.toUpperCase();
  return u === "POST" || u === "PATCH" || u === "PUT" || u === "DELETE";
}

function tableFromRestUrl(u: URL): string | null {
  // Supabase REST: /rest/v1/<table>?...
  const m = u.pathname.match(/\/rest\/v1\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function headersToObject(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) { h.forEach((v, k) => (out[k] = v)); return out; }
  if (Array.isArray(h)) { for (const [k, v] of h) out[k] = v; return out; }
  for (const k of Object.keys(h)) out[k] = (h as Record<string, string>)[k];
  return out;
}

function syntheticOkResponse(): Response {
  // 201 + empty body is widely accepted by supabase-js (and standard fetch
  // callers) as "no rows returned". Mark with custom header for debugging.
  return new Response("[]", {
    status: 201,
    statusText: "Created (offline-queued)",
    headers: {
      "Content-Type": "application/json",
      "X-Offline-Queued": "1",
    },
  });
}

export function installGlobalFetchInterceptor() {
  if (installed) return;
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;

  const supabaseHost = getSupabaseHost();
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Resolve method + url without consuming bodies of Request objects.
    let method = (init?.method ?? "GET").toString();
    let url: string;
    let headers: Record<string, string> = headersToObject(init?.headers);
    let bodyText: string | null = null;

    if (input instanceof Request) {
      url = input.url;
      method = init?.method ?? input.method ?? "GET";
      // merge request headers (init wins)
      const reqHeaders: Record<string, string> = {};
      input.headers.forEach((v, k) => (reqHeaders[k] = v));
      headers = { ...reqHeaders, ...headers };
    } else {
      url = typeof input === "string" ? input : input.toString();
    }

    try {
      return await originalFetch(input, init);
    } catch (err) {
      // Only intercept network failures.
      if (!isNetworkError(err)) throw err;

      // Only handle Supabase REST writes.
      let parsed: URL | null = null;
      try { parsed = new URL(url, window.location.origin); } catch { /* ignore */ }
      const isSupabase = parsed && supabaseHost && parsed.host === supabaseHost;
      const isRest = parsed && parsed.pathname.startsWith("/rest/v1/");
      if (!parsed || !isSupabase || !isRest || !isWriteMethod(method)) {
        throw err; // not something we can safely queue
      }

      // Extract body (only safe for plain RequestInit; Request bodies are
      // single-use and supabase-js always passes init.body as a string).
      try {
        const b = init?.body;
        if (typeof b === "string") bodyText = b;
        else if (b == null) bodyText = null;
        else bodyText = String(b);
      } catch { bodyText = null; }

      let payload: Record<string, unknown> = {};
      try { payload = bodyText ? JSON.parse(bodyText) : {}; } catch { payload = { _raw: bodyText }; }

      const table = tableFromRestUrl(parsed) ?? "unknown";

      enqueueRaw(table, payload, {
        url: parsed.toString(),
        method: method.toUpperCase(),
        headers,
        body: bodyText,
      });

      return syntheticOkResponse();
    }
  };

  // Auto-drain when network/visibility comes back.
  const tryDrain = () => { if (navigator.onLine) void drainQueue(); };
  window.addEventListener("online", tryDrain);
  window.addEventListener("focus", tryDrain);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tryDrain();
  });
}
