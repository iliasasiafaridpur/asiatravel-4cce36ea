import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plane, LogOut, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";

function phoneToEmail(phone: string) {
  const clean = phone.replace(/[^0-9]/g, "");
  return `${clean}@asiatravel.local`;
}

// Best-effort synchronous check: is there ANY supabase auth token in
// localStorage? If yes, we optimistically render children instead of a
// blank "Loading…" screen while supabase.auth.getSession() resolves.
function hasStoredSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("sb-") && k.endsWith("-auth-token")) {
        const v = window.localStorage.getItem(k);
        if (v && v.length > 10) return true;
      }
    }
  } catch { /* ignore */ }
  return false;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  // Optimistic: if a token exists locally, treat as ready immediately.
  const [authReady, setAuthReady] = useState<boolean>(() => hasStoredSession());
  const [optimisticSession] = useState<boolean>(() => hasStoredSession());

  useEffect(() => {
    let active = true;

    const checkActive = async (s: Session | null) => {
      if (!s?.user) return;
      try {
        const { data } = await supabase.from("profiles")
          .select("is_active").eq("user_id", s.user.id).maybeSingle();
        if (!active) return;
        if (data && data.is_active === false) {
          toast.error("আপনার অ্যাকাউন্ট এখনো Admin দ্বারা activate হয়নি");
          await supabase.auth.signOut();
        }
      } catch (err) {
        console.warn("profile check failed (non-blocking)", err);
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      setSession(session);
      setAuthReady(true);
      void checkActive(session);
    }).catch(() => { if (active) { setSession(null); setAuthReady(true); } });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (!active) return;
      setSession(s);
      setAuthReady(true);
      if (event === "SIGNED_IN") void checkActive(s);
    });

    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  // If we have a stored token, render children optimistically — the real
  // session resolves in the background, and any 401s are handled per-query.
  if (!authReady) {
    if (optimisticSession) return <>{children}</>;
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (!session) return <LoginScreen />;
  return <>{children}</>;
}

function LoginScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-2">
          <div
            className="mx-auto h-12 w-12 rounded-lg flex items-center justify-center text-primary-foreground"
            style={{ background: "var(--gradient-hero)", boxShadow: "var(--shadow-glow)" }}
          >
            <Plane className="h-6 w-6" />
          </div>
          <CardTitle>Asia Travel</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            <TabsContent value="login"><LoginForm /></TabsContent>
            <TabsContent value="signup"><SignUpForm /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function LoginForm() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = phone.replace(/[^0-9]/g, "");
    if (clean.length < 6) return toast.error("সঠিক মোবাইল নাম্বার দিন");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: phoneToEmail(clean), password,
    });
    setBusy(false);
    if (error) toast.error("লগইন ব্যর্থ — তথ্য ভুল");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 pt-3">
      <div className="space-y-1">
        <Label htmlFor="ph">মোবাইল নাম্বার</Label>
        <Input id="ph" type="tel" inputMode="numeric" placeholder="01XXXXXXXXX"
          required value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pw">পাসওয়ার্ড</Label>
        <div className="relative">
          <Input id="pw" type={showPw ? "text" : "password"} required value={password}
            className="pr-10"
            onChange={(e) => setPassword(e.target.value)} />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
            aria-label={showPw ? "Hide password" : "Show password"}
            title={showPw ? "Hide password" : "Show password"}
          >
            {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Signing in…" : "Sign In"}
      </Button>
    </form>
  );
}

function SignUpForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [designation, setDesignation] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = phone.replace(/[^0-9]/g, "");
    if (!name.trim()) return toast.error("নাম দিন");
    if (clean.length < 6) return toast.error("সঠিক মোবাইল নাম্বার দিন");
    if (password.length < 6) return toast.error("পাসওয়ার্ড অন্তত ৬ অক্ষর");
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email: phoneToEmail(clean),
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: name.trim(), mobile: clean, designation: designation.trim() },
      },
    });
    setBusy(false);
    if (error) return toast.error("সাইন আপ ব্যর্থ: " + error.message);
    toast.success("সাইন আপ সম্পন্ন। Admin activation এর জন্য অপেক্ষা করুন।");
    await supabase.auth.signOut();
    setName(""); setPhone(""); setDesignation(""); setPassword("");
  };

  return (
    <form onSubmit={submit} className="space-y-3 pt-3">
      <div className="space-y-1">
        <Label>পূর্ণ নাম</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-1">
        <Label>মোবাইল নাম্বার</Label>
        <Input type="tel" inputMode="numeric" value={phone}
          onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" required />
      </div>
      <div className="space-y-1">
        <Label>পদবি (Designation)</Label>
        <Input value={designation} onChange={(e) => setDesignation(e.target.value)}
          placeholder="যেমন: Counter Staff, Manager" />
      </div>
      <div className="space-y-1">
        <Label>পাসওয়ার্ড</Label>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Signing up…" : "Sign Up"}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        সাইন আপের পর Admin আপনার অ্যাকাউন্ট activate করলে লগইন করতে পারবেন।
      </p>
    </form>
  );
}

export function LogoutButton() {
  const { user, profile } = useCurrentUser();
  const name = displayName(profile, user);
  return (
    <div className="flex items-center gap-1.5">
      {name && <span className="hidden sm:inline text-xs font-medium text-muted-foreground max-w-[120px] truncate">{name}</span>}
      <Button variant="ghost" size="icon"
        onClick={async () => { await supabase.auth.signOut(); toast.success("Logged out"); }}
        aria-label="Logout" title="Logout">
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
