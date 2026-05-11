import { useEffect, useState } from "react";
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

export function useCurrentUser(): CurrentUser {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const loadProfile = async (u: User | null) => {
      if (!u) { setProfile(null); return; }
      const { data } = await supabase
        .from("profiles")
        .select("user_id,full_name,role")
        .eq("user_id", u.id)
        .maybeSingle();
      if (!cancelled) setProfile((data as Profile | null) ?? null);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setUser(s?.user ?? null);
      void loadProfile(s?.user ?? null);
    });

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
      await loadProfile(session?.user ?? null);
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);

  return { user, profile, loading };
}

/** Convenience: get a friendly display name. */
export function displayName(p: Profile | null, u: User | null): string {
  if (p?.full_name) return p.full_name;
  if (u?.email) return u.email.split("@")[0];
  return "User";
}
