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
    setMounted(true);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
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
  return (
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
  );
}
