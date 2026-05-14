import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plane, LogOut } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";

function phoneToEmail(phone: string) {
  const clean = phone.replace(/[^0-9]/g, "");
  return `${clean}@asiatravel.local`;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeChecked, setActiveChecked] = useState(false);

  useEffect(() => {
    let active = true;
    setMounted(true);
    const fallback = window.setTimeout(() => { if (active) setLoading(false); }, 2500);

    const checkActive = async (s: Session | null) => {
      if (!s?.user) { setActiveChecked(true); return; }
      const { data } = await supabase.from("profiles")
        .select("is_active,full_name").eq("user_id", s.user.id).maybeSingle();
      const isActive = (data as { is_active?: boolean } | null)?.is_active ?? false;
      if (!isActive) {
        toast.error("আপনার অ্যাকাউন্ট এখনো Admin দ্বারা activate হয়নি");
        await supabase.auth.signOut();
        if (active) { setSession(null); setActiveChecked(true); }
        return;
      }
      if (active) setActiveChecked(true);
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      window.clearTimeout(fallback);
      setSession(session);
      setLoading(false);
      void checkActive(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (!active) return;
      setSession(s);
      setLoading(false);
      if (event === "SIGNED_IN") void checkActive(s);
      if (event === "SIGNED_OUT") setActiveChecked(true);
    });

    return () => { active = false; window.clearTimeout(fallback); subscription.unsubscribe(); };
  }, []);

  if (!mounted || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!session || !activeChecked) {
    if (session && !activeChecked) {
      return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Verifying…</div>;
    }
    return <LoginScreen />;
  }
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
        <Input id="pw" type="password" required value={password}
          onChange={(e) => setPassword(e.target.value)} />
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
