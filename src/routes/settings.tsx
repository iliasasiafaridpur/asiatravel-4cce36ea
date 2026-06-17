import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { User, KeyRound, Trash2, RefreshCw, Phone, Briefcase, Mail } from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — Asia Travel" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [designation, setDesignation] = useState("");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id;
      if (!uid) return;
      supabase.from("profiles").select("full_name,mobile,designation,notify_email").eq("user_id", uid).maybeSingle()
        .then(({ data }) => {
          const p = (data ?? {}) as { full_name?: string; mobile?: string; designation?: string; notify_email?: string };
          setFullName(p.full_name ?? "");
          setMobile(p.mobile ?? "");
          setDesignation(p.designation ?? "");
          setNotifyEmail(p.notify_email ?? "");
        });
    });
  }, []);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) { setSavingProfile(false); return; }
    const email = notifyEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setSavingProfile(false);
      toast.error("সঠিক ইমেইল ঠিকানা দিন");
      return;
    }
    const { error } = await supabase.from("profiles")
      .update({ full_name: fullName, mobile, designation, notify_email: email || null }).eq("user_id", uid);
    setSavingProfile(false);
    if (error) toast.error("সেইভ ব্যর্থ"); else toast.success("প্রোফাইল আপডেটেড");
  };

  const changePw = async (e: FormEvent) => {
    e.preventDefault();
    if (!oldPw) { toast.error("পুরনো পাসওয়ার্ড দিন"); return; }
    if (newPw.length < 6) { toast.error("নতুন পাসওয়ার্ড অন্তত ৬ অক্ষর"); return; }
    if (oldPw === newPw) { toast.error("নতুন পাসওয়ার্ড আলাদা হতে হবে"); return; }
    setPwBusy(true);
    const { data: { session } } = await supabase.auth.getSession();
    const email = session?.user?.email;
    if (!email) { setPwBusy(false); toast.error("সেশন পাওয়া যায়নি"); return; }
    // Verify old password by re-authenticating (does not disturb session).
    const { error: verifyErr } = await supabase.auth.signInWithPassword({ email, password: oldPw });
    if (verifyErr) { setPwBusy(false); toast.error("পুরনো পাসওয়ার্ড ভুল"); return; }
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwBusy(false);
    if (error) toast.error("পরিবর্তন ব্যর্থ");
    else { toast.success("পাসওয়ার্ড পরিবর্তিত"); setOldPw(""); setNewPw(""); }
  };

  const clearCache = () => {
    try {
      const toDel: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith("cache_v1_") || k.startsWith("cache_v2_"))) toDel.push(k);
      }
      toDel.forEach((k) => localStorage.removeItem(k));
      toast.success(`Cache cleared (${toDel.length} items)`);
    } catch { toast.error("Cache clear ব্যর্থ"); }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto p-4">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">প্রোফাইল ও অ্যাকাউন্ট সেটিংস</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><User className="h-5 w-5" /> Profile</CardTitle>
          <CardDescription>আপনার তথ্য আপডেট করুন</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>পূর্ণ নাম</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> মোবাইল</Label>
              <Input value={mobile} onChange={(e) => setMobile(e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" /> পদবি</Label>
              <Input value={designation} onChange={(e) => setDesignation(e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> ইমেইল ঠিকানা (Gmail)</Label>
              <Input
                type="email"
                value={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.value)}
                placeholder="example@gmail.com"
              />
              <p className="text-xs text-muted-foreground">
                Cash handover ও নোটিফিকেশন এই ইমেইলে পাঠানো হবে।
              </p>
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button type="submit" disabled={savingProfile}>{savingProfile ? "Saving…" : "Save Profile"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> Change Password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePw} className="space-y-2 max-w-md">
            <Input type="password" autoComplete="current-password" value={oldPw}
              onChange={(e) => setOldPw(e.target.value)} placeholder="পুরনো পাসওয়ার্ড" />
            <Input type="password" autoComplete="new-password" value={newPw}
              onChange={(e) => setNewPw(e.target.value)} placeholder="নতুন পাসওয়ার্ড (min 6)" />
            <Button type="submit" disabled={pwBusy}>{pwBusy ? "Updating…" : "পাসওয়ার্ড পরিবর্তন"}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Trash2 className="h-5 w-5" /> Maintenance</CardTitle>
          <CardDescription>স্লো হলে local cache পরিষ্কার করুন</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={clearCache}>Clear local cache</Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Reload app
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
