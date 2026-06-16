import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { User, KeyRound, Trash2, RefreshCw, Phone, Briefcase, AlertTriangle, Mail } from "lucide-react";

// Data-reset groups. Each "module" maps to one or more tables that must be wiped together
// to keep ledgers/receipts in sync (services + their auto-generated ledger/receipt rows).
const RESET_GROUPS: { key: string; label: string; tables: string[] }[] = [
  { key: "tickets", label: "Air Ticket (tickets)", tables: ["tickets"] },
  { key: "bmet", label: "BMET কার্ড (bmet_cards)", tables: ["bmet_cards"] },
  { key: "saudi", label: "সৌদি ভিসা (saudi_visas)", tables: ["saudi_visas"] },
  { key: "kuwait", label: "কুয়েত ভিসা (kuwait_visas)", tables: ["kuwait_visas"] },
  { key: "agency_ledger", label: "Agency Ledger", tables: ["agency_ledger"] },
  { key: "vendor_ledger", label: "Vendor Ledger", tables: ["vendor_ledger"] },
  { key: "payment_receipts", label: "Payment Receipts (আয়)", tables: ["payment_receipts"] },
  { key: "cash_handovers", label: "Cash Handovers (জমা)", tables: ["cash_handovers"] },
  { key: "cash_expenses", label: "Cash Expenses (খরচ)", tables: ["cash_expenses"] },
  { key: "passengers", label: "Passengers", tables: ["passengers"] },
  { key: "agents", label: "Agents (পরিচিতি)", tables: ["agents"] },
  { key: "vendors", label: "Vendors (পরিচিতি)", tables: ["vendors"] },
];

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
  const [newPw, setNewPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [resetSelected, setResetSelected] = useState<Record<string, boolean>>({});
  const [resetBusy, setResetBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id;
      if (!uid) return;
      supabase.from("profiles").select("full_name,mobile,designation,role,notify_email").eq("user_id", uid).maybeSingle()
        .then(({ data }) => {
          const p = (data ?? {}) as { full_name?: string; mobile?: string; designation?: string; role?: string; notify_email?: string };
          setFullName(p.full_name ?? "");
          setMobile(p.mobile ?? "");
          setDesignation(p.designation ?? "");
          setNotifyEmail(p.notify_email ?? "");
          setIsAdmin((p.role ?? "") === "admin");
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
    if (newPw.length < 6) { toast.error("পাসওয়ার্ড অন্তত ৬ অক্ষর"); return; }
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwBusy(false);
    if (error) toast.error("পরিবর্তন ব্যর্থ"); else { toast.success("পাসওয়ার্ড পরিবর্তিত"); setNewPw(""); }
  };

  const clearCache = () => {
    try {
      const toDel: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("cache_v1_")) toDel.push(k);
      }
      toDel.forEach((k) => localStorage.removeItem(k));
      toast.success(`Cache cleared (${toDel.length} items)`);
    } catch { toast.error("Cache clear ব্যর্থ"); }
  };

  const toggleReset = (key: string) =>
    setResetSelected((s) => ({ ...s, [key]: !s[key] }));

  const selectedGroups = RESET_GROUPS.filter((g) => resetSelected[g.key]);
  const selectedTables = Array.from(new Set(selectedGroups.flatMap((g) => g.tables)));

  const runDataReset = async () => {
    if (selectedTables.length === 0) { toast.error("কোন মডিউল নির্বাচন করা হয়নি"); return; }
    if (confirmText.trim().toUpperCase() !== "DELETE") {
      toast.error('নিশ্চিত করতে "DELETE" টাইপ করুন'); return;
    }
    setResetBusy(true);
    const errors: string[] = [];
    for (const table of selectedTables) {
      const { error } = await supabase
        .from(table as never)
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) errors.push(`${table}: ${error.message}`);
    }
    setResetBusy(false);
    setConfirmText("");
    setResetSelected({});
    if (errors.length) toast.error(`কিছু টেবিলে সমস্যা: ${errors.join(" | ")}`);
    else toast.success(`${selectedTables.length} টেবিলের ডাটা মুছে ফেলা হয়েছে`);
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
          <form onSubmit={changePw} className="flex flex-col sm:flex-row gap-2">
            <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="New password (min 6)" />
            <Button type="submit" disabled={pwBusy}>{pwBusy ? "Updating…" : "Update"}</Button>
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

      {isAdmin && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Data Reset (Admin)
            </CardTitle>
            <CardDescription>
              নির্দিষ্ট মডিউলের সকল ডাটা স্থায়ীভাবে মুছে ফেলা হবে। অফিসিয়াল ব্যবহারের আগে শুরুর reset-এর জন্য।
              <br />
              <span className="text-amber-600 font-medium">
                পরামর্শ: পরিষেবা (Ticket/BMET/Visa) ডিলিট করলে সংশ্লিষ্ট ledger ও receipt স্বয়ংক্রিয় ভাবে মুছে যায়।
                কিন্তু Agency Ledger থেকে সরাসরি "Due Receive" করা receipt গুলো ledger রো ডিলিট করলেও থেকে যায় —
                তাই এখান থেকে <b>Payment Receipts</b> আলাদাভাবে রিসেট করুন।
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {RESET_GROUPS.map((g) => (
                <label key={g.key} className="flex items-center gap-2 rounded-md border p-2 cursor-pointer hover:bg-accent">
                  <Checkbox
                    checked={!!resetSelected[g.key]}
                    onCheckedChange={() => toggleReset(g.key)}
                  />
                  <span className="text-sm">{g.label}</span>
                </label>
              ))}
            </div>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={selectedTables.length === 0}
                  className="w-full sm:w-auto"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  নির্বাচিত {selectedTables.length}টি টেবিল ডিলিট করুন
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-destructive">নিশ্চিত?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2">
                      <div>নিম্নলিখিত টেবিলের সকল ডাটা স্থায়ীভাবে মুছে যাবে:</div>
                      <ul className="list-disc pl-5 text-xs">
                        {selectedTables.map((t) => <li key={t}>{t}</li>)}
                      </ul>
                      <div className="pt-2">
                        নিশ্চিত করতে নিচে <b>DELETE</b> টাইপ করুন:
                      </div>
                      <Input
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder="DELETE"
                        autoFocus
                      />
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setConfirmText("")}>বাতিল</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={resetBusy || confirmText.trim().toUpperCase() !== "DELETE"}
                    onClick={runDataReset}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {resetBusy ? "Deleting…" : "Permanently Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
