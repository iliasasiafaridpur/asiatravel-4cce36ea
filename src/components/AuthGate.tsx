import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LogOut, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import logoAsset from "@/assets/logo.png.asset.json";

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

function withTimeout<T>(promise: PromiseLike<T>, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error("auth timeout")), ms);
    promise.then(
      (value) => { globalThis.clearTimeout(timer); resolve(value); },
      (error) => { globalThis.clearTimeout(timer); reject(error); },
    );
  });
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  // SSR-safe: always start with deterministic values, flip in useEffect.
  // Reading localStorage during initial render causes hydration mismatch
  // (server has no localStorage, client does), which makes React discard
  // the entire tree and re-render — producing the "stuck on loading" bug.
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [optimisticSession, setOptimisticSession] = useState<boolean>(false);
  const [mustReset, setMustReset] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    // Avoid checking the same user twice on load (getSession + SIGNED_IN
    // both resolve within the same second → duplicate profiles request).
    let lastChecked: string | null = null;

    // Optimistically render children if a token exists locally.
    if (hasStoredSession()) setOptimisticSession(true);

    const checkActive = async (s: Session | null) => {
      if (!s?.user) return;
      if (lastChecked === s.user.id) return;
      lastChecked = s.user.id;
      try {
        const { data } = await supabase.from("profiles")
          .select("is_active,must_reset_password").eq("user_id", s.user.id).maybeSingle();
        if (!active) return;
        const row = data as { is_active?: boolean; must_reset_password?: boolean } | null;
        if (row && row.is_active === false) {
          toast.error("আপনার অ্যাকাউন্ট এখনো Admin দ্বারা activate হয়নি");
          await supabase.auth.signOut();
          return;
        }
        setMustReset(!!row?.must_reset_password);
      } catch (err) {
        console.warn("profile check failed (non-blocking)", err);
      }
    };

    withTimeout(supabase.auth.getSession()).then(({ data: { session } }) => {
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
      if (event === "SIGNED_OUT") setMustReset(false);
    });

    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  if (!authReady) {
    if (optimisticSession) return <>{children}</>;
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (!session) return <LoginScreen />;
  if (mustReset) return <ForcePasswordChange onDone={() => setMustReset(false)} />;
  return <>{children}</>;
}


function LoginScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-2">
          <div
            className="mx-auto h-16 w-16 rounded-xl bg-white ring-1 ring-primary/20 overflow-hidden flex items-center justify-center"
            style={{ boxShadow: "var(--shadow-glow)" }}
          >
            <img src={logoAsset.url} alt="Asia Tours and Travel" className="h-full w-full object-contain" width={64} height={64} />
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

function ForcePasswordChange({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 6) return toast.error("পাসওয়ার্ড অন্তত ৬ অক্ষর");
    if (pw !== pw2) return toast.error("দুটি পাসওয়ার্ড মিলছে না");
    setBusy(true);
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { setBusy(false); return toast.error("পরিবর্তন ব্যর্থ: " + error.message); }
    if (uid) {
      await supabase.from("profiles")
        .update({ must_reset_password: false } as never).eq("user_id", uid);
    }
    setBusy(false);
    toast.success("নতুন পাসওয়ার্ড সেট হয়েছে");
    onDone();
  };

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
          <CardTitle>নতুন পাসওয়ার্ড দিন</CardTitle>
          <p className="text-sm text-muted-foreground">
            নিরাপত্তার জন্য চালিয়ে যাওয়ার আগে নতুন পাসওয়ার্ড সেট করুন।
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <Label>নতুন পাসওয়ার্ড</Label>
              <div className="relative">
                <Input type={showPw ? "text" : "password"} required value={pw}
                  className="pr-10" onChange={(e) => setPw(e.target.value)} />
                <button type="button" onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1} aria-label={showPw ? "Hide password" : "Show password"}>
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <Label>নতুন পাসওয়ার্ড (আবার)</Label>
              <Input type={showPw ? "text" : "password"} required value={pw2}
                onChange={(e) => setPw2(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "সেট হচ্ছে…" : "পাসওয়ার্ড সেট করুন"}
            </Button>
            <Button type="button" variant="ghost" className="w-full"
              onClick={async () => { await supabase.auth.signOut(); }}>
              লগআউট
            </Button>
          </form>
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
  const [showPw, setShowPw] = useState(false);
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
        <div className="relative">
          <Input type={showPw ? "text" : "password"} value={password}
            className="pr-10"
            onChange={(e) => setPassword(e.target.value)} required />
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
