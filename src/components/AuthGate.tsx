import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plane, LogOut } from "lucide-react";
import { toast } from "sonner";

// Phone number-কে synthetic email-এ রূপান্তর (SMS provider লাগে না)
// উদাহরণ: "01712345678" -> "01712345678@asiatravel.local"
function phoneToEmail(phone: string) {
  const clean = phone.replace(/[^0-9]/g, "");
  return `${clean}@asiatravel.local`;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setMounted(true);

    const fallback = window.setTimeout(() => {
      if (!active) return;
      setLoading(false);
    }, 2500);

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      window.clearTimeout(fallback);
      setSession(session);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      window.clearTimeout(fallback);
      setSession(null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!active) return;
      setSession(s);
      setLoading(false);
    });

    return () => {
      active = false;
      window.clearTimeout(fallback);
      subscription.unsubscribe();
    };
  }, []);

  // SSR এবং প্রথম client render — দুটোই একই markup দেয় (hydration safe)
  if (!mounted || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!session) return <LoginScreen />;
  return <>{children}</>;
}

function LoginScreen() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = phone.replace(/[^0-9]/g, "");
    if (clean.length < 6) {
      toast.error("সঠিক মোবাইল নাম্বার দিন");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: phoneToEmail(clean),
      password,
    });
    setBusy(false);
    if (error) toast.error("লগইন ব্যর্থ — নাম্বার বা পাসওয়ার্ড ভুল");
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
          <CardTitle>Asia Travel — Login</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ph">মোবাইল নাম্বার</Label>
              <Input
                id="ph"
                type="tel"
                inputMode="numeric"
                placeholder="01XXXXXXXXX"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pw">পাসওয়ার্ড</Label>
              <Input
                id="pw"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign In"}
            </Button>
            <p className="text-xs text-muted-foreground text-center pt-2">
              শুধু অনুমোদিত staff লগইন করতে পারবে। Account লাগলে Admin-কে বলুন।
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export function LogoutButton() {
  const [name, setName] = useState<string>("");

  useEffect(() => {
    let cancel = false;
    const load = async (uid?: string) => {
      if (!uid) { setName(""); return; }
      const { data } = await supabase.from("profiles").select("full_name").eq("user_id", uid).maybeSingle();
      if (!cancel) setName((data as { full_name?: string } | null)?.full_name ?? "");
    };
    supabase.auth.getSession().then(({ data: { session } }) => load(session?.user?.id));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => load(s?.user?.id));
    return () => { cancel = true; subscription.unsubscribe(); };
  }, []);

  return (
    <div className="flex items-center gap-1.5">
      {name && <span className="hidden sm:inline text-xs font-medium text-muted-foreground max-w-[120px] truncate">{name}</span>}
      <Button
        variant="ghost"
        size="icon"
        onClick={async () => {
          await supabase.auth.signOut();
          toast.success("Logged out");
        }}
        aria-label="Logout"
        title="Logout"
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
