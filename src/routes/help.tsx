import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  BookOpen, ShieldCheck, Server, Database, Lock, Layers, Workflow, Users, Wallet,
  HandCoins, Crown, ClipboardList, FileText, Sparkles, CheckCircle2, Clock, Send,
  AlertTriangle, Code2, Cpu, KeyRound, Network, Image as ImageIcon,
} from "lucide-react";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "সহায়িকা ও ডকুমেন্টেশন — Asia Travel" },
      { name: "description", content: "Asia Travel Manager সফটওয়্যারের সম্পূর্ণ বাংলা ব্যবহার নির্দেশিকা এবং কারিগরি ডকুমেন্টেশন।" },
    ],
  }),
  component: HelpPage,
});

// --- Reusable bits ----------------------------------------------------------

function ScreenshotPlaceholder({ caption }: { caption: string }) {
  return (
    <div className="my-3 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-6 text-center">
      <ImageIcon className="mx-auto mb-2 h-6 w-6 text-primary/60" />
      <p className="text-xs font-medium text-muted-foreground">[ {caption} ]</p>
    </div>
  );
}

function StatusBadge({ kind }: { kind: "pending" | "sent" | "received" }) {
  if (kind === "pending")
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-400 ring-1 ring-amber-500/30">
        <Clock className="h-3 w-3" /> ⏳ হাতে আছে (পেন্ডিং)
      </span>
    );
  if (kind === "sent")
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/15 px-2 py-0.5 text-xs font-semibold text-sky-400 ring-1 ring-sky-500/30">
        <Send className="h-3 w-3" /> 📤 এমডিকে পাঠানো হয়েছে
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-500/30">
      <CheckCircle2 className="h-3 w-3" /> ✅ এমডি বুঝে নিয়েছেন
    </span>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="relative pl-12">
      <div className="absolute left-0 top-0 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold shadow-md ring-2 ring-primary/40">
        {n}
      </div>
      <h4 className="mb-1 text-base font-bold text-foreground">{title}</h4>
      <div className="text-sm leading-relaxed text-muted-foreground space-y-2">{children}</div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Server; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md border bg-card/50 p-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

// --- Page -------------------------------------------------------------------

function HelpPage() {
  const [tab, setTab] = useState("user");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
      {/* Hero */}
      <Card className="overflow-hidden border-primary/30">
        <div
          className="p-6 md:p-8 text-primary-foreground"
          style={{ background: "var(--gradient-hero)" }}
        >
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
              <BookOpen className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
                সহায়িকা ও ডকুমেন্টেশন কেন্দ্র
              </h1>
              <p className="mt-1 text-sm md:text-base opacity-90">
                Asia Travel Manager — স্টাফ, এমডি এবং কারিগরি দল সবার জন্য একটি সম্পূর্ণ বাংলা গাইড।
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/25">
                  v1.0 — বাংলা
                </Badge>
                <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/25">
                  স্টাফ + এমডি ওয়ার্কফ্লো
                </Badge>
                <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/25">
                  ফ্রড-প্রতিরোধী হিসাব
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 h-11">
          <TabsTrigger value="user" className="gap-2 text-sm font-semibold">
            <BookOpen className="h-4 w-4" /> ব্যবহার নির্দেশিকা
          </TabsTrigger>
          <TabsTrigger value="tech" className="gap-2 text-sm font-semibold">
            <Cpu className="h-4 w-4" /> কারিগরি ও প্রোডাক্ট পিচ
          </TabsTrigger>
        </TabsList>

        {/* ============================ USER MANUAL ============================ */}
        <TabsContent value="user" className="space-y-5 mt-5">
          {/* Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5 text-primary" /> এক নজরে সিস্টেমটি কী করে
              </CardTitle>
              <CardDescription className="text-sm">
                এই সফটওয়্যারটি একটি ট্রাভেল এজেন্সির সম্পূর্ণ অফিস পরিচালনা করে — Air Ticket,
                BMET কার্ড, সৌদি ভিসা, কুয়েত ভিসা, কাস্টমার ও ভেন্ডর হিসাব, এবং সবচেয়ে গুরুত্বপূর্ণ —
                <span className="font-semibold text-foreground"> দৈনিক ক্যাশ হ্যান্ডওভার ও এমডি অডিট</span>।
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <InfoRow icon={Users} label="স্টাফ ভূমিকা" value="ডেটা এন্ট্রি ও পেমেন্ট গ্রহণ" />
              <InfoRow icon={Crown} label="এমডি ভূমিকা" value="হ্যান্ডওভার যাচাই ও অনুমোদন" />
              <InfoRow icon={Wallet} label="ক্যাশ ব্যবস্থাপনা" value="পেন্ডিং / অনুমোদিত আলাদা" />
              <InfoRow icon={ShieldCheck} label="নিরাপত্তা" value="ভূমিকা-ভিত্তিক RLS" />
            </CardContent>
          </Card>

          {/* Status legend */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ClipboardList className="h-5 w-5 text-primary" /> স্ট্যাটাস চিহ্নসমূহের অর্থ
              </CardTitle>
              <CardDescription className="text-sm">
                প্রতিটি লেনদেনের পাশে এই তিনটি স্ট্যাটাসের একটি দেখা যাবে। নিচে অর্থ বুঝে নিন।
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-2 rounded-md border bg-card/50 p-3">
                <StatusBadge kind="pending" />
                <p className="text-sm text-muted-foreground">
                  স্টাফ টাকা গ্রহণ করেছেন, কিন্তু এখনও এমডিকে জমা দেওয়া হয়নি। এই টাকা
                  <span className="font-semibold text-foreground"> Global Cash in Hand </span>
                  এ যোগ হবে না।
                </p>
              </div>
              <div className="flex flex-col gap-2 rounded-md border bg-card/50 p-3">
                <StatusBadge kind="sent" />
                <p className="text-sm text-muted-foreground">
                  স্টাফ দৈনিক হ্যান্ডওভার সাবমিট করেছেন। দিনটি লক হয়ে গেছে — সেই দিনের
                  রসিদ আর সম্পাদনা/মুছে ফেলা যাবে না। এমডির অপেক্ষা।
                </p>
              </div>
              <div className="flex flex-col gap-2 rounded-md border bg-card/50 p-3">
                <StatusBadge kind="received" />
                <p className="text-sm text-muted-foreground">
                  এমডি নগদ টাকা গণনা করে কনফার্ম করেছেন (তারিখ ও সময়সহ)। টাকা এখন
                  Confirmed Cash এ যুক্ত। লেনদেনটি স্থায়ীভাবে সিলগালা।
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Staff workflow */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <HandCoins className="h-5 w-5 text-sky-400" /> স্টাফ ওয়ার্কফ্লো — ধাপে ধাপে
              </CardTitle>
              <CardDescription className="text-sm">
                একজন স্টাফ কীভাবে এন্ট্রি করেন, পেমেন্ট নেন এবং দিন শেষে হ্যান্ডওভার পাঠান।
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Step n={1} title="লগইন ও ড্যাশবোর্ড">
                <p>মোবাইল নম্বর ও পাসওয়ার্ড দিয়ে লগইন করুন। সাইডবারে আপনার অনুমোদিত
                মেনুগুলো দেখাবে। সিলেক্ট করা মেনু হালকা রঙে হাইলাইট থাকবে।</p>
                <ScreenshotPlaceholder caption="এখানে লগইন স্ক্রিন এবং ড্যাশবোর্ডের স্ক্রিনশট বসবে" />
              </Step>

              <Step n={2} title="সার্ভিস এন্ট্রি (টিকিট / BMET / ভিসা)">
                <p>সাইডবার থেকে প্রয়োজনীয় সার্ভিস (যেমন <b>AIR TICKET</b>) সিলেক্ট করুন।
                "নতুন এন্ট্রি" বাটনে ক্লিক করে যাত্রীর তথ্য, বিক্রয় মূল্য, ভেন্ডর এবং
                প্রাপ্ত টাকা পূরণ করুন।</p>
                <ScreenshotPlaceholder caption="এখানে Air Ticket এন্ট্রি ফর্মের স্ক্রিনশট বসবে" />
              </Step>

              <Step n={3} title="পেমেন্ট রিসিভ করা">
                <p>কাস্টমার টাকা দিলে সংশ্লিষ্ট রো-এর <b>Receive</b> বাটনে ক্লিক করে টাকার
                পরিমাণ লিখুন। সিস্টেম স্বয়ংক্রিয়ভাবে রসিদ তৈরি করবে এবং স্ট্যাটাস হবে:</p>
                <StatusBadge kind="pending" />
                <ScreenshotPlaceholder caption="এখানে Due Receive ডায়ালগ এবং পেন্ডিং স্ট্যাটাস ব্যাজের স্ক্রিনশট বসবে" />
              </Step>

              <Step n={4} title="দৈনিক হ্যান্ডওভার সাবমিট">
                <p>দিন শেষে <b>"আমার ক্যাশ হিসাব"</b> পেজে যান। সিস্টেম আজকের মোট পেন্ডিং
                রসিদ দেখাবে। আপনি হাতে যে নগদ আছে তা গুনে ইনপুট দিন এবং
                <b> "Submit Daily Cash Handover"</b> বাটনে চাপুন।</p>
                <p>সাবমিটের পর সেই দিনের সব রসিদ <StatusBadge kind="sent" /> হয়ে যাবে এবং
                আপনি আর সেগুলো এডিট/ডিলিট করতে পারবেন না।</p>
                <ScreenshotPlaceholder caption="এখানে Submit Handover ডায়ালগ এবং দিন লক হওয়ার স্ক্রিনশট বসবে" />
              </Step>
            </CardContent>
          </Card>

          {/* MD workflow */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Crown className="h-5 w-5 text-amber-400" /> এমডি ওয়ার্কফ্লো — যাচাই ও অনুমোদন
              </CardTitle>
              <CardDescription className="text-sm">
                এমডি প্যানেলে স্টাফ হ্যান্ডওভার যাচাই করার পদ্ধতি।
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Step n={1} title="MD Panel এ প্রবেশ">
                <p>সাইডবারের <b>Owner → MD Panel</b> লিঙ্কে ক্লিক করুন। শুধুমাত্র
                <b> md </b> ভূমিকার ব্যবহারকারী এই পেজ দেখতে পান।</p>
                <ScreenshotPlaceholder caption="এখানে MD Panel এর হোম স্ক্রিনশট বসবে" />
              </Step>

              <Step n={2} title="Pending Handovers — এক-রো লেআউট">
                <p>প্রতিটি পেন্ডিং হ্যান্ডওভার একটি রো-তে দেখানো হয়: স্টাফের নাম, তারিখ,
                সিস্টেম টোটাল, স্টাফ ঘোষিত নগদ, পার্থক্য (Variance), এবং অ্যাকশন বাটন।
                পার্থক্য থাকলে রো লাল রঙে হাইলাইট হবে।</p>
                <ScreenshotPlaceholder caption="এখানে Pending Handovers 1-row লেআউটের স্ক্রিনশট বসবে" />
              </Step>

              <Step n={3} title="বিস্তারিত যাচাই (Split-Screen Historical Tracker)">
                <p>যেকোনো রো এক্সপ্যান্ড করলে বাম দিকে আজকের আইটেমাইজড রসিদ এবং ডান দিকে
                সেই স্টাফের পূর্ববর্তী হ্যান্ডওভার ইতিহাস পাশাপাশি দেখা যাবে — তুলনা সহজ হবে।</p>
                <ScreenshotPlaceholder caption="এখানে Split-Screen historical tracker এর স্ক্রিনশট বসবে" />
              </Step>

              <Step n={4} title="Confirm & Approve অথবা Reject">
                <p>নগদ গুনে মিল পেলে <b>Confirm & Approve</b> চাপুন — কনফার্মড পরিমাণ,
                তারিখ ও সময় সংরক্ষিত হবে এবং রসিদগুলো <StatusBadge kind="received" />
                হয়ে যাবে। মিল না পেলে <b>Reject</b> চাপুন — দিন আনলক হবে, স্টাফ আবার
                সংশোধন করে পাঠাতে পারবেন।</p>
                <ScreenshotPlaceholder caption="এখানে Approve / Reject বাটন ও টাইমস্ট্যাম্পের স্ক্রিনশট বসবে" />
              </Step>
            </CardContent>
          </Card>

          {/* Discounts & misc */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5 text-primary" /> ডিসকাউন্ট, খরচ ও অন্যান্য
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>• <b className="text-foreground">ডিসকাউন্ট:</b> প্রতিটি সার্ভিস রো-তে আলাদা
              <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">discount_amount</code>
              ফিল্ড আছে। ডিসকাউন্ট দিলে কাস্টমারের Due স্বয়ংক্রিয়ভাবে কমে যায় এবং Profit
              রিক্যালকুলেট হয়।</p>
              <p>• <b className="text-foreground">খরচ এন্ট্রি:</b> "আমার ক্যাশ হিসাব" পেজ
              থেকে দৈনিক খরচ যোগ করুন। হ্যান্ডওভারের সময় সিস্টেম নেট ক্যাশ
              (প্রাপ্ত − খরচ) দেখাবে।</p>
              <p>• <b className="text-foreground">কাস্টমার / ভেন্ডর লেজার:</b> প্রতিটি সার্ভিস
              এন্ট্রি স্বয়ংক্রিয়ভাবে Agency Ledger ও Vendor Ledger এ পোস্ট হয় — ম্যানুয়াল
              ডাবল-এন্ট্রির প্রয়োজন নেই।</p>
              <p>• <b className="text-foreground">৪-কালার রো:</b> সব টেবিলে চোখ আরাম পেতে ৪টি
              আলাদা হালকা পেস্টেল রঙ পুনরাবৃত্তি হয় (A→B→C→D)।</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================ TECH PITCH ============================ */}
        <TabsContent value="tech" className="space-y-5 mt-5">
          {/* Pitch hero */}
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5 text-amber-400" />
                কেন এই সফটওয়্যার একটি ট্রাভেল এজেন্সির জন্য অপরিহার্য
              </CardTitle>
              <CardDescription className="text-sm">
                মালিকদের জন্য ফ্রড-প্রতিরোধী, স্টাফদের জন্য সহজ, আইটি দলের জন্য আধুনিক।
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>
                একটি ট্রাভেল এজেন্সিতে দৈনিক কয়েক লক্ষ টাকা ক্যাশ লেনদেন হয় — টিকিট,
                ভিসা, BMET, ভেন্ডর পেমেন্ট। প্রচলিত খাতা-কলম বা সাধারণ Excel এ
                <b className="text-foreground"> স্টাফ চাইলে যেকোনো সময় এন্ট্রি মুছে বা পরিবর্তন </b>
                করতে পারে — মালিক জানতেও পারেন না। এই সফটওয়্যার সেই ফাঁকটি বন্ধ করে।
              </p>
              <p>
                <b className="text-foreground">মূল প্রতিশ্রুতি:</b> স্টাফ একবার দৈনিক হ্যান্ডওভার
                সাবমিট করলে সেই দিনের কোনো রসিদ আর সম্পাদনা/মুছে ফেলা যাবে না —
                এটি ডাটাবেস ট্রিগার দ্বারা বলবৎ, ফ্রন্টএন্ড লুকিয়েও ফাঁকি দেওয়া অসম্ভব।
                এমডি নিজে গুনে কনফার্ম করার আগ পর্যন্ত সেই টাকা Global Cash এ যোগ হয় না।
              </p>
            </CardContent>
          </Card>

          {/* Architecture */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Layers className="h-5 w-5 text-primary" /> আর্কিটেকচার ও টেক স্ট্যাক
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <InfoRow icon={Code2} label="ফ্রন্টএন্ড" value="React 19 + TanStack Start (Vite 7)" />
              <InfoRow icon={Sparkles} label="স্টাইলিং" value="Tailwind CSS v4 + ডিজাইন টোকেন" />
              <InfoRow icon={Server} label="রানটাইম" value="Cloudflare Workers (Edge SSR)" />
              <InfoRow icon={Database} label="ডাটাবেস" value="Supabase PostgreSQL (Serverless)" />
              <InfoRow icon={Lock} label="অথেনটিকেশন" value="Supabase Auth (auth.uid())" />
              <InfoRow icon={Network} label="API লেয়ার" value="TanStack createServerFn (Typed RPC)" />
              <InfoRow icon={Workflow} label="স্টেট/ক্যাশ" value="TanStack Query (SWR + Persist)" />
              <InfoRow icon={ShieldCheck} label="নিরাপত্তা" value="Row Level Security (RLS) + Triggers" />
            </CardContent>
          </Card>

          {/* Security */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldCheck className="h-5 w-5 text-emerald-400" /> ডেটা নিরাপত্তার স্তরসমূহ
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              <div className="rounded-lg border bg-card/50 p-3">
                <h4 className="mb-1 font-semibold text-foreground flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-primary" /> ১. সেশন ও পরিচয় (auth.uid())
                </h4>
                <p>প্রতিটি API কলের সাথে JWT টোকেন স্বয়ংক্রিয়ভাবে যুক্ত হয়
                (<code className="rounded bg-muted px-1 text-xs">attachSupabaseAuth</code> মিডলওয়্যার)।
                সার্ভার <code className="rounded bg-muted px-1 text-xs">auth.uid()</code> থেকে
                ব্যবহারকারী চেনে — কেউ অন্যের পরিচয়ে কিছু করতে পারে না।</p>
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <h4 className="mb-1 font-semibold text-foreground flex items-center gap-2">
                  <Lock className="h-4 w-4 text-primary" /> ২. Row Level Security (RLS)
                </h4>
                <p>প্রতিটি টেবিলে PostgreSQL RLS পলিসি বলবৎ — যেমন স্টাফ শুধু নিজের রসিদ
                দেখেন, এমডি সব দেখেন, ডিলিট শুধু admin ভূমিকা করতে পারে। এই নিয়ম
                ডাটাবেস লেভেলে বলবৎ — ফ্রন্টএন্ড বাইপাস করেও ভাঙা যায় না।</p>
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <h4 className="mb-1 font-semibold text-foreground flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400" /> ৩. Day-Lock Trigger
                </h4>
                <p><code className="rounded bg-muted px-1 text-xs">guard_locked_receipt</code>
                ট্রিগার দিন লক হওয়া রসিদে UPDATE/DELETE ব্লক করে — শুধু এমডি/অ্যাডমিন বাইপাস
                করতে পারেন। ফলে সাবমিট-পরবর্তী টেম্পারিং কাঠামোগতভাবে অসম্ভব।</p>
              </div>
              <div className="rounded-lg border bg-card/50 p-3">
                <h4 className="mb-1 font-semibold text-foreground flex items-center gap-2">
                  <Workflow className="h-4 w-4 text-primary" /> ৪. SECURITY DEFINER RPCs
                </h4>
                <p>অনুমোদন/প্রত্যাখ্যানের মতো সংবেদনশীল অপারেশন
                (<code className="rounded bg-muted px-1 text-xs">approve_handover</code>,
                <code className="rounded bg-muted px-1 text-xs"> reject_handover</code>)
                সার্ভার-সাইড ফাংশনে চলে, যাতে নিয়মাবলী এক জায়গায় কেন্দ্রীভূত থাকে।</p>
              </div>
            </CardContent>
          </Card>

          {/* Relational integrity */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Database className="h-5 w-5 text-primary" /> রিলেশনাল ডেটা ইন্টেগ্রিটি
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>• একটি টিকিট/ভিসা এন্ট্রি স্বয়ংক্রিয়ভাবে
              <code className="mx-1 rounded bg-muted px-1 text-xs">agency_ledger</code> এবং
              <code className="mx-1 rounded bg-muted px-1 text-xs">vendor_ledger</code> এ পোস্ট হয়।</p>
              <p>• পেমেন্ট গ্রহণ করলে
              <code className="mx-1 rounded bg-muted px-1 text-xs">payment_receipts</code> এ রো
              তৈরি হয় এবং কাস্টমারের Due তৎক্ষণাৎ আপডেট হয়।</p>
              <p>• <b className="text-foreground">Confirmed Cash</b> =
              <code className="mx-1 rounded bg-muted px-1 text-xs">approval_status IN ('auto_approved','approved')</code>।
              পেন্ডিং টাকা মালিকের রিপোর্ট স্ফীত করে না।</p>
              <p>• Realtime সাবস্ক্রিপশন: একজন স্টাফ এন্ট্রি দিলে এমডির স্ক্রিনে তৎক্ষণাৎ আপডেট আসে।</p>
            </CardContent>
          </Card>

          {/* Business value */}
          <Card className="border-emerald-500/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5 text-emerald-400" /> ব্যবসায়িক মূল্য (Product Pitch)
              </CardTitle>
              <CardDescription className="text-sm">
                মালিকের ভাষায় — কেন এই সিস্টেম একটি absolute fraud prevention tool।
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border bg-emerald-500/5 p-3">
                  <h4 className="mb-1 font-bold text-emerald-400">✅ Zero Trust, Full Audit</h4>
                  <p className="text-xs text-muted-foreground">প্রতিটি টাকার পথ — কে নিয়েছে, কখন
                  জমা দিয়েছে, কে কনফার্ম করেছে — টাইমস্ট্যাম্পসহ সংরক্ষিত।</p>
                </div>
                <div className="rounded-lg border bg-emerald-500/5 p-3">
                  <h4 className="mb-1 font-bold text-emerald-400">🔒 Tamper-Proof Day Lock</h4>
                  <p className="text-xs text-muted-foreground">হ্যান্ডওভারের পরে রসিদ পরিবর্তন
                  ডাটাবেস ট্রিগার ব্লক করে — কোডে নয়, ডেটা স্তরে।</p>
                </div>
                <div className="rounded-lg border bg-emerald-500/5 p-3">
                  <h4 className="mb-1 font-bold text-emerald-400">📊 True Cash Position</h4>
                  <p className="text-xs text-muted-foreground">"Confirmed Cash" বনাম "Pending"
                  আলাদা — মালিক জানেন আসলে হাতে কত টাকা।</p>
                </div>
                <div className="rounded-lg border bg-emerald-500/5 p-3">
                  <h4 className="mb-1 font-bold text-emerald-400">⚡ Edge-Fast, Offline-Tolerant</h4>
                  <p className="text-xs text-muted-foreground">Cloudflare Edge SSR + Service Worker
                  ক্যাশ — দুর্বল ইন্টারনেটেও কাজ চলে।</p>
                </div>
                <div className="rounded-lg border bg-emerald-500/5 p-3">
                  <h4 className="mb-1 font-bold text-emerald-400">🧾 Auto-Synced Ledgers</h4>
                  <p className="text-xs text-muted-foreground">ডাবল-এন্ট্রি ভুল নেই — সার্ভিস এন্ট্রি
                  নিজেই Customer ও Vendor লেজার আপডেট করে।</p>
                </div>
                <div className="rounded-lg border bg-emerald-500/5 p-3">
                  <h4 className="mb-1 font-bold text-emerald-400">🌐 শতভাগ বাংলা UI</h4>
                  <p className="text-xs text-muted-foreground">স্টাফদের ইংরেজি জানার প্রয়োজন নেই
                  — প্রশিক্ষণ খরচ ও ভুলের হার দুটোই কম।</p>
                </div>
              </div>

              <Separator className="my-3" />

              <p className="text-sm leading-relaxed text-muted-foreground">
                <b className="text-foreground">সংক্ষেপে:</b> এটি শুধু একটি হিসাব সফটওয়্যার নয় —
                এটি মালিক ও স্টাফের মধ্যে একটি ডিজিটাল চুক্তি, যেখানে নিয়মগুলো ডাটাবেসে খোদাই
                করা। ফলে বিশ্বাসের উপর নয়, কাঠামোর উপর ব্যবসা দাঁড়ায়।
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
