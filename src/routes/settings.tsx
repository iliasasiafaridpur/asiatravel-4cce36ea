import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  getVoiceSettings, setVoiceEnabled, updateVoiceSettings,
  listVoices, speak, speakWelcome,
} from "@/lib/voice";
import { supabase } from "@/integrations/supabase/client";
import { Volume2, VolumeX, User, KeyRound, Trash2, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Asia Travel" },
      { name: "description", content: "App settings: sound, profile, account" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [s, setS] = useState(getVoiceSettings());
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [fullName, setFullName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    const refresh = () => setVoices(listVoices());
    refresh();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.onvoiceschanged = refresh;
    }
    // load profile name
    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id;
      if (!uid) return;
      supabase.from("profiles").select("full_name").eq("user_id", uid).maybeSingle()
        .then(({ data }) => setFullName((data as { full_name?: string } | null)?.full_name ?? ""));
    });
  }, []);

  const update = (patch: Partial<ReturnType<typeof getVoiceSettings>>) => {
    updateVoiceSettings(patch);
    setS(getVoiceSettings());
  };

  const onToggle = (v: boolean) => {
    setVoiceEnabled(v);
    setS(getVoiceSettings());
    if (v) speak("Sound system enabled", { force: true });
  };

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) { setSavingProfile(false); return; }
    const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("user_id", uid);
    setSavingProfile(false);
    if (error) toast.error("নাম সেইভ ব্যর্থ"); else toast.success("নাম সেইভ হয়েছে");
  };

  const changePw = async (e: FormEvent) => {
    e.preventDefault();
    if (newPw.length < 6) { toast.error("পাসওয়ার্ড অন্তত ৬ অক্ষর"); return; }
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwBusy(false);
    if (error) toast.error("পাসওয়ার্ড পরিবর্তন ব্যর্থ"); else { toast.success("পাসওয়ার্ড পরিবর্তিত"); setNewPw(""); }
  };

  const clearCache = () => {
    try {
      const keep = ["voice_settings_v2", "voice_enabled_v1"];
      const toDel: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && !keep.includes(k)) toDel.push(k);
      }
      toDel.forEach((k) => localStorage.removeItem(k));
      toast.success(`Local cache cleared (${toDel.length} items)`);
    } catch { toast.error("Cache clear ব্যর্থ"); }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto p-4">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">সিস্টেম ও সাউন্ড কনফিগারেশন</p>
      </div>

      {/* Sound System */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {s.enabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            Sound System
          </CardTitle>
          <CardDescription>Voice announcements for entries, deliveries, payments</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base">Enable voice</Label>
              <p className="text-xs text-muted-foreground">লগইন, এন্ট্রি, রিসিভ, ডেলিভারিতে সাউন্ড</p>
            </div>
            <Switch checked={s.enabled} onCheckedChange={onToggle} />
          </div>

          <div className="space-y-2">
            <Label>Language / ভাষা</Label>
            <Select value={s.lang} onValueChange={(v) => update({ lang: v, voiceURI: "" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="bn">Bengali (বাংলা)</SelectItem>
                <SelectItem value="hi">Hindi (हिन्दी)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Voice</Label>
            <Select value={s.voiceURI || "auto"} onValueChange={(v) => update({ voiceURI: v === "auto" ? "" : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (recommended)</SelectItem>
                {voices
                  .filter((v) => v.lang?.toLowerCase().startsWith(s.lang))
                  .map((v) => (
                    <SelectItem key={v.voiceURI} value={v.voiceURI}>
                      {v.name} — {v.lang}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {voices.length === 0 && (
              <p className="text-xs text-muted-foreground">Loading voices… (refresh if empty)</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Speed: {s.rate.toFixed(1)}x</Label>
            <Slider value={[s.rate]} min={0.5} max={2} step={0.1} onValueChange={([v]) => update({ rate: v })} />
          </div>
          <div className="space-y-2">
            <Label>Pitch: {s.pitch.toFixed(1)}</Label>
            <Slider value={[s.pitch]} min={0} max={2} step={0.1} onValueChange={([v]) => update({ pitch: v })} />
          </div>
          <div className="space-y-2">
            <Label>Volume: {Math.round(s.volume * 100)}%</Label>
            <Slider value={[s.volume]} min={0} max={1} step={0.05} onValueChange={([v]) => update({ volume: v })} />
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" onClick={() => speak("This is a voice test", { force: true, interrupt: true })}>
              🔊 Test voice
            </Button>
            <Button type="button" variant="secondary" onClick={() => speakWelcome(fullName)}>
              Welcome message
            </Button>
            <Button type="button" variant="outline" onClick={() => setVoices(listVoices())}>
              <RefreshCw className="h-4 w-4 mr-1" /> Reload voices
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><User className="h-5 w-5" /> Profile</CardTitle>
          <CardDescription>আপনার নাম পরিবর্তন</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="flex flex-col sm:flex-row gap-2">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" />
            <Button type="submit" disabled={savingProfile}>{savingProfile ? "Saving…" : "Save"}</Button>
          </form>
        </CardContent>
      </Card>

      {/* Password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> Change Password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePw} className="flex flex-col sm:flex-row gap-2">
            <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="New password (min 6)" />
            <Button type="submit" disabled={pwBusy}>{pwBusy ? "Updating…" : "Update"}</Button>
          </form>
        </CardContent>
      </Card>

      {/* Maintenance */}
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
