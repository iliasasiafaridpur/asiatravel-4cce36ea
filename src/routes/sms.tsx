import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Save, RefreshCw } from "lucide-react";
import { moduleByKey } from "@/lib/modules";
import { SMS_MODULES, SMS_TAGS, DEFAULT_STATUS_TEMPLATE, DEFAULT_DUE_TEMPLATE, normalizeBdMobile } from "@/lib/sms";
import { sendSms } from "@/lib/sms.functions";

export const Route = createFileRoute("/sms")({
  head: () => ({
    meta: [
      { title: "SMS সিস্টেম — Asia Travel" },
      { name: "description", content: "SMS Gateway সেটিংস, স্ট্যাটাস টেমপ্লেট, রিমাইন্ডার ও SMS হিস্ট্রি।" },
      { property: "og:title", content: "SMS সিস্টেম — Asia Travel" },
      { property: "og:description", content: "SMS Gateway সেটিংস, টেমপ্লেট ও হিস্ট্রি।" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SmsPage,
});

function SmsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 md:p-6">
      <h1 className="text-xl font-bold">SMS সিস্টেম</h1>
      <Tabs defaultValue="gateway">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="gateway">Gateway</TabsTrigger>
          <TabsTrigger value="templates">টেমপ্লেট</TabsTrigger>
          <TabsTrigger value="send">পাঠান</TabsTrigger>
          <TabsTrigger value="logs">হিস্ট্রি</TabsTrigger>
        </TabsList>
        <TabsContent value="gateway"><GatewayTab /></TabsContent>
        <TabsContent value="templates"><TemplatesTab /></TabsContent>
        <TabsContent value="send"><SendTab /></TabsContent>
        <TabsContent value="logs"><LogsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

type Settings = { enabled: boolean; api_url: string; api_key: string | null; sender_id: string | null; company_name: string | null };

function GatewayTab() {
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testNo, setTestNo] = useState("");
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    void supabase.from("sms_settings").select("*").eq("id", 1).maybeSingle().then(({ data }) =>
      setS(data ?? { enabled: true, api_url: "http://bulksmsbd.net/api/smsapi?api_key={api_key}&type=text&number={number}&senderid={sender_id}&message={message}", api_key: "", sender_id: "", company_name: "Asia Travels" }));
  }, []);
  if (!s) return <Loader2 className="m-6 h-5 w-5 animate-spin" />;
  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("sms_settings").upsert({ id: 1, ...s, updated_at: new Date().toISOString() });
    setSaving(false);
    error ? toast.error("সেভ হয়নি: " + error.message) : toast.success("Gateway সেভ হয়েছে");
  };
  const test = async () => {
    if (!normalizeBdMobile(testNo)) return toast.error("সঠিক মোবাইল নম্বর দিন");
    setTesting(true);
    const r = await sendSms({ data: { mobile: testNo, message: `Test SMS - ${s.company_name ?? ""}`, kind: "test" } }).catch(() => ({ ok: false, error: "ত্রুটি" }));
    setTesting(false);
    r.ok ? toast.success("টেস্ট SMS পাঠানো হয়েছে") : toast.error("যায়নি: " + (r.error ?? ""));
  };
  return (
    <Card><CardHeader><CardTitle>SMS Gateway</CardTitle>
      <CardDescription>যেকোনো কোম্পানি ব্যবহার করতে পারবেন। API URL-এ {"{api_key}"}, {"{sender_id}"}, {"{number}"}, {"{message}"} লিখে দিন — সফটওয়্যার নিজে বসিয়ে নেবে।</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> SMS চালু</label>
        <div><Label>API URL</Label><Textarea rows={3} value={s.api_url} onChange={(e) => setS({ ...s, api_url: e.target.value })} className="font-mono text-xs" /></div>
        <div className="grid gap-3 md:grid-cols-3">
          <div><Label>API Key / Token</Label><Input type="password" value={s.api_key ?? ""} onChange={(e) => setS({ ...s, api_key: e.target.value })} /></div>
          <div><Label>Sender ID</Label><Input value={s.sender_id ?? ""} onChange={(e) => setS({ ...s, sender_id: e.target.value })} /></div>
          <div><Label>প্রতিষ্ঠানের নাম ({"{company}"})</Label><Input value={s.company_name ?? ""} onChange={(e) => setS({ ...s, company_name: e.target.value })} /></div>
        </div>
        <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} সেভ</Button>
        <div className="flex gap-2 border-t pt-3">
          <Input placeholder="টেস্ট নম্বর 01XXXXXXXXX" value={testNo} onChange={(e) => setTestNo(e.target.value)} />
          <Button variant="outline" onClick={test} disabled={testing}>{testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} টেস্ট</Button>
        </div>
      </CardContent></Card>
  );
}

function TemplatesTab() {
  const [mk, setMk] = useState<string>(SMS_MODULES[0].key);
  const [rows, setRows] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const statuses = [...(moduleByKey(mk)?.statuses ?? []), "DUE_REMINDER"];
  useEffect(() => {
    void supabase.from("sms_templates").select("status, body").eq("module_key", mk).then(({ data }) =>
      setRows(Object.fromEntries((data ?? []).map((r) => [r.status, r.body]))));
  }, [mk]);
  const save = async () => {
    setSaving(true);
    const payload = Object.entries(rows).filter(([, b]) => b.trim()).map(([status, body]) => ({ module_key: mk, status, body, updated_at: new Date().toISOString() }));
    const { error } = payload.length ? await supabase.from("sms_templates").upsert(payload, { onConflict: "module_key,status" }) : { error: null };
    setSaving(false);
    error ? toast.error("সেভ হয়নি: " + error.message) : toast.success("টেমপ্লেট সেভ হয়েছে");
  };
  return (
    <Card><CardHeader><CardTitle>মেসেজ টেমপ্লেট</CardTitle>
      <CardDescription>ট্যাগ: {SMS_TAGS.join("  ")} — খালি রাখলে ডিফল্ট মেসেজ যাবে।</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">{SMS_MODULES.map((m) => (
          <Button key={m.key} size="sm" variant={mk === m.key ? "default" : "outline"} onClick={() => setMk(m.key)}>{m.label}</Button>))}</div>
        {statuses.map((st) => (
          <div key={st}><Label>{st === "DUE_REMINDER" ? "বকেয়া রিমাইন্ডার" : st}</Label>
            <Textarea rows={2} placeholder={st === "DUE_REMINDER" ? DEFAULT_DUE_TEMPLATE : DEFAULT_STATUS_TEMPLATE}
              value={rows[st] ?? ""} onChange={(e) => setRows({ ...rows, [st]: e.target.value })} /></div>))}
        <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} সেভ</Button>
      </CardContent></Card>
  );
}

function SendTab() {
  const [mobile, setMobile] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const nums = mobile.split(/[\s,;]+/).filter(Boolean);
  const send = async () => {
    const valid = nums.filter((n) => normalizeBdMobile(n));
    if (!valid.length) return toast.error("সঠিক মোবাইল নম্বর দিন");
    if (!msg.trim()) return toast.error("মেসেজ লিখুন");
    setBusy(true);
    let ok = 0;
    for (const n of valid) {
      const r = await sendSms({ data: { mobile: n, message: msg, kind: valid.length > 1 ? "bulk" : "manual" } }).catch(() => ({ ok: false }));
      if (r.ok) ok++;
    }
    setBusy(false);
    ok === valid.length ? toast.success(`${ok}টি SMS পাঠানো হয়েছে`) : toast.error(`${ok}/${valid.length} সফল — হিস্ট্রি দেখুন`);
  };
  return (
    <Card><CardHeader><CardTitle>SMS / রিমাইন্ডার পাঠান</CardTitle>
      <CardDescription>একাধিক নম্বর কমা বা নতুন লাইনে দিন (Bulk)।</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <div><Label>মোবাইল নম্বর</Label><Textarea rows={2} value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="01XXXXXXXXX, 01XXXXXXXXX" /></div>
        <div><Label>মেসেজ <span className="text-muted-foreground">({msg.length} অক্ষর)</span></Label><Textarea rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} /></div>
        <Button onClick={send} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} পাঠান ({nums.length})</Button>
      </CardContent></Card>
  );
}

type Log = { id: string; created_at: string; mobile: string; message: string; kind: string; ref_id: string | null; passenger_name: string | null; success: boolean; response: string | null };
function LogsTab() {
  const [logs, setLogs] = useState<Log[] | null>(null);
  const load = () => void supabase.from("sms_logs").select("*").order("created_at", { ascending: false }).limit(200).then(({ data }) => setLogs((data ?? []) as Log[]));
  useEffect(load, []);
  return (
    <Card><CardHeader className="flex-row items-center justify-between"><CardTitle>SMS হিস্ট্রি</CardTitle>
      <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-4 w-4" /></Button></CardHeader>
      <CardContent className="space-y-2">
        {!logs ? <Loader2 className="h-5 w-5 animate-spin" /> : logs.length === 0 ? <p className="text-sm text-muted-foreground">এখনো কোনো SMS পাঠানো হয়নি</p> :
          logs.map((l) => (
            <div key={l.id} className="rounded-md border p-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={l.success ? "default" : "destructive"}>{l.success ? "সফল" : "ব্যর্থ"}</Badge>
                <span className="font-mono">{l.mobile}</span>
                {l.passenger_name && <span>{l.passenger_name}</span>}
                {l.ref_id && <span className="text-muted-foreground">{l.ref_id}</span>}
                <span className="ml-auto text-muted-foreground">{new Date(l.created_at).toLocaleString("en-GB")}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap">{l.message}</p>
              {!l.success && l.response && <p className="mt-1 text-destructive">{l.response}</p>}
            </div>))}
      </CardContent></Card>
  );
}
