import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export interface Profile {
  user_id: string;
  full_name: string;
  role: string;
}

export interface CurrentUser {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
}

/**
 * Singleton auth user state — subscribes ONCE to supabase auth and shares the
 * user across all hook consumers via a small module-level store. Profile is
 * cached via React Query so multiple components reading it dedupe to a single
 * network request (5 min stale time).
 */
let _user: User | null = null;
let _initialized = false;
let _initPromise: Promise<void> | null = null;
const listeners = new Set<(u: User | null) => void>();

function withTimeout<T>(promise: PromiseLike<T>, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error("auth timeout")), ms);
    promise.then(
      (value) => { globalThis.clearTimeout(timer); resolve(value); },
      (error) => { globalThis.clearTimeout(timer); reject(error); },
    );
  });
}

function setUser(u: User | null) {
  _user = u;
  listeners.forEach((l) => l(u));
}

function ensureInit(): Promise<void> {
  if (_initialized) return Promise.resolve();
  if (_initPromise) return _initPromise;
  _initPromise = new Promise<void>((resolve) => {
    supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    withTimeout(supabase.auth.getSession()).then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      _initialized = true;
      resolve();
    }).catch(() => {
      setUser(null);
      _initialized = true;
      resolve();
    });
  });
  return _initPromise;
}

function useAuthUser(): { user: User | null; loading: boolean } {
  const [user, setLocal] = useState<User | null>(_user);
  const [loading, setLoading] = useState(!_initialized);
  useEffect(() => {
    const cb = (u: User | null) => setLocal(u);
    listeners.add(cb);
    ensureInit().then(() => { setLocal(_user); setLoading(false); });
    return () => { listeners.delete(cb); };
  }, []);
  return { user, loading };
}

export function useCurrentUser(): CurrentUser {
  const { user, loading: authLoading } = useAuthUser();
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async (): Promise<Profile | null> => {
      if (!user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("user_id,full_name,role")
        .eq("user_id", user.id)
        .maybeSingle();
      return (data as Profile | null) ?? null;
    },
    enabled: !!user,
    staleTime: 60 * 1000, // 1 minute
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  // NOTE: We deliberately do NOT subscribe to `profiles` over Realtime.
  // The profiles table is no longer in the Realtime publication, because its
  // SELECT policy is open to all authenticated staff and broadcasting would
  // leak sensitive fields (mobile, notify_email, role, must_reset_password)
  // for every staff member. The own-profile query below refetches on window
  // focus (and AuthGate re-checks is_active / must_reset_password on auth
  // events), so role/active changes are still picked up without a live feed.
  const qc = useQueryClient();
  useEffect(() => {
    if (!user) return;
    // Lightweight periodic refresh of the current user's own profile so an
    // admin's role / deactivation change is reflected without a live channel.
    const t = setInterval(() => {
      void qc.invalidateQueries({ queryKey: ["profile", user.id] });
    }, 60 * 1000);
    return () => clearInterval(t);
  }, [user, qc]);


  return { user, profile: profile ?? null, loading: authLoading || (!!user && profileLoading) };
}

/** Invalidate profile cache (call after profile updates). */
export function useInvalidateProfile() {
  const qc = useQueryClient();
  return (userId?: string) => qc.invalidateQueries({ queryKey: ["profile", userId] });
}

/** Convenience: get a friendly display name. */
export function displayName(p: Profile | null, u: User | null): string {
  if (p?.full_name) return p.full_name;
  const meta = (u?.user_metadata ?? {}) as Record<string, unknown>;
  const metaName = meta.full_name ?? meta.name ?? meta.display_name ?? meta.mobile;
  if (metaName) return String(metaName);
  if (u?.email) return u.email.split("@")[0];
  return "User";
}
