import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, displayName, type Profile } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Wallet, ArrowDownToLine, Receipt, HandCoins, Plus, Trash2, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/modules";

export const Route = createFileRoute("/cash-drawer")({
  head: () => ({ meta: [{ title: "Cash Drawer — Travel Manager" }] }),
  component: CashDrawerPage,
});

const EXPENSE_CATEGORIES = ["Transport", "Stationery", "Bill", "Food", "Internet", "Office", "Other"];
const todayIso = () => new Date().toISOString().slice(0, 10);

interface Drawer {
  user_id: string;
  full_name: string;
  total_received: number;
  total_received_today: number;
  total_handed_over: number;
  total_received_in: number;
  total_expenses: number;
  current_balance: number;
}

interface Expense {
  id: string; expense_id: string; entry_date: string; spent_by_name: string | null;
  category: string; amount: number; purpose: string | null;
}

function CashDrawerPage() {
  const { user, profile } = useCurrentUser();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [drawers, setDrawers] = useState<Drawer[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  // Hand over dialog
  const [hoOpen, setHoOpen] = useState(false);
  const [hoForm, setHoForm] = useState({ to_user: "", amount: 0, method: "Hand Cash", purpose: "Daily handover", remarks: "" });
  const [hoSaving, setHoSaving] = useState(false);

  // Expense dialog
  const [expOpen, setExpOpen] = useState(false);
  const [expForm, setExpForm] = useState({ entry_date: todayIso(), category: "Transport", amount: 0, purpose: "", remarks: "" });
  const [expSaving, setExpSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: p } = await supabase.from("profiles").select("user_id,full_name,role");
    const profs = ((p as unknown) as Profile[]) ?? [];
    setProfiles(profs);

    // Fetch drawer for each profile
    const drs: Drawer[] = [];
    for (const pr of profs) {
      const { data } = await supabase.rpc("get_cash_drawer" as never, { _user_id: pr.user_id } as never);
      if (Array.isArray(data) && data.length > 0) drs.push(data[0] as unknown as Drawer);
    }
    setDrawers(drs);

    const { data: ex } = await supabase.from("cash_expenses").select("*").order("entry_date", { ascending: false }).limit(100);
    setExpenses(((ex as unknown) as Expense[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase.channel("cash_drawer_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_transfers" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_expenses" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "bmet_cards" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "saudi_visas" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "kuwait_visas" }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const myDrawer = useMemo(() => drawers.find((d) => d.user_id === user?.id), [drawers, user?.id]);
  const others = useMemo(() => profiles.filter((p) => p.user_id !== user?.id), [profiles, user?.id]);

  const openHandover = () => {
    setHoForm({
      to_user: others[0]?.user_id ?? "",
      amount: Math.max(0, Math.floor(myDrawer?.current_balance ?? 0)),
      method: "Hand Cash", purpose: "Daily handover", remarks: "",
    });
    setHoOpen(true);
  };

  const submitHandover = async () => {
    if (!user?.id) return;
    if (hoForm.amount <= 0) { toast.error("টাকার পরিমাণ দিন"); return; }
    if (!hoForm.to_user) { toast.error("কাকে দিচ্ছেন সিলেক্ট করুন"); return; }
    setHoSaving(true);
    try {
      const toProf = profiles.find((p) => p.user_id === hoForm.to_user);
      const { data: idData, error: idErr } = await supabase.rpc("next_module_id" as never, {
        _prefix: "CSH", _table: "cash_transfers", _column: "transfer_id",
      } as never);
      if (idErr) throw idErr;
      const { error } = await supabase.from("cash_transfers").insert({
        transfer_id: idData as unknown as string,
        entry_date: todayIso(),
        from_user: user.id, to_user: hoForm.to_user,
        from_name: displayName(profile, user), to_name: toProf?.full_name ?? null,
        amount: hoForm.amount, method: hoForm.method,
        purpose: hoForm.purpose || null, remarks: hoForm.remarks || null,
        created_by: user.id,
      });
      if (error) throw error;
      toast.success(`✓ ${toProf?.full_name}-কে ৳${hoForm.amount.toLocaleString()} হ্যান্ডওভার সম্পন্ন`);
      setHoOpen(false);
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setHoSaving(false); }
  };

  const submitExpense = async () => {
    if (!user?.id) return;
    if (expForm.amount <= 0) { toast.error("টাকার পরিমাণ দিন"); return; }
    setExpSaving(true);
    try {
      const { data: idData, error: idErr } = await supabase.rpc("next_module_id" as never, {
        _prefix: "EXP", _table: "cash_expenses", _column: "expense_id",
      } as never);
      if (idErr) throw idErr;
      const { error } = await supabase.from("cash_expenses").insert({
        expense_id: idData as unknown as string,
        entry_date: expForm.entry_date,
        spent_by: user.id, spent_by_name: displayName(profile, user),
        category: expForm.category, amount: expForm.amount,
        purpose: expForm.purpose || null, remarks: expForm.remarks || null,
        created_by: user.id,
      });
      if (error) throw error;
      toast.success("খরচ যোগ হয়েছে");
      setExpOpen(false);
      setExpForm({ entry_date: todayIso(), category: "Transport", amount: 0, purpose: "", remarks: "" });
      await load();
    } catch (e) { toast.error((e as Error).message); }
    finally { setExpSaving(false); }
  };

  const delExpense = async (id: string) => {
    if (!confirm("এই খরচটি মুছবেন?")) return;
    const { error } = await supabase.from("cash_expenses").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("মুছে ফেলা হয়েছে"); await load(); }
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
          <Wallet className="h-7 w-7 text-primary" /> Cash Drawer
        </h1>
        <p className="text-sm text-muted-foreground">প্রতিটি ইউজারের লাইভ টাকার বাক্স — কে কত রিসিভ করল, কত হ্যান্ডওভার, কত খরচ, এখন হাতে কত</p>
      </div>

      {/* Drawers grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {loading && drawers.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">লোড হচ্ছে...</CardContent></Card>
        ) : drawers.map((d) => {
          const isMe = d.user_id === user?.id;
          return (
            <Card key={d.user_id} className={`overflow-hidden ${isMe ? "ring-2 ring-primary" : ""}`}>
              <div className={`p-4 ${isMe ? "bg-gradient-to-br from-primary/15 to-primary/5" : "bg-gradient-to-br from-muted/40 to-muted/10"}`}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Drawer Owner</p>
                    <p className="font-bold text-lg">{d.full_name} {isMe && <Badge variant="default" className="ml-1">You</Badge>}</p>
                  </div>
                  <Wallet className="h-8 w-8 text-primary/60" />
                </div>
                <div className="text-3xl font-bold tabular-nums">৳ {Number(d.current_balance).toLocaleString()}</div>
                <p className="text-xs text-muted-foreground mt-1">বর্তমান হাতে</p>
              </div>
              <CardContent className="p-4 space-y-1.5 text-sm">
                <Row label="মোট রিসিভ" value={d.total_received} positive />
                <Row label="আজ রিসিভ" value={d.total_received_today} positive subtle />
                <Row label="অন্য থেকে এসেছে" value={d.total_received_in} positive />
                <Row label="হ্যান্ডওভার" value={d.total_handed_over} negative />
                <Row label="খরচ" value={d.total_expenses} negative />
                {isMe && (
                  <div className="flex gap-2 pt-3">
                    <Button onClick={openHandover} className="flex-1 gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                      <HandCoins className="h-4 w-4" /> Hand Over
                    </Button>
                    <Button onClick={() => setExpOpen(true)} variant="outline" className="flex-1 gap-1.5">
                      <Receipt className="h-4 w-4" /> Add Expense
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Recent expenses */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4" /> Recent Expenses
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Spent By</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">কোনো খরচ এন্ট্রি নেই</TableCell></TableRow>
                ) : expenses.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(e.entry_date)}</TableCell>
                    <TableCell className="font-mono text-xs">{e.expense_id}</TableCell>
                    <TableCell className="whitespace-nowrap">{e.spent_by_name ?? "—"}</TableCell>
                    <TableCell><Badge variant="secondary">{e.category}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-rose-600">৳ {Number(e.amount).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{e.purpose ?? "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => delExpense(e.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Handover dialog */}
      <Dialog open={hoOpen} onOpenChange={setHoOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><HandCoins className="h-5 w-5 text-emerald-600" /> Hand Over Cash</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md bg-muted/40 p-3 text-sm">
              আপনার বর্তমান ব্যালেন্স: <span className="font-bold">৳ {Number(myDrawer?.current_balance ?? 0).toLocaleString()}</span>
              <br />আজ রিসিভ: <span className="font-medium">৳ {Number(myDrawer?.total_received_today ?? 0).toLocaleString()}</span>
            </div>
            <div>
              <Label>To <span className="text-rose-500">*</span></Label>
              <Select value={hoForm.to_user} onValueChange={(v) => setHoForm((f) => ({ ...f, to_user: v }))}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="কাকে দিচ্ছেন?" /></SelectTrigger>
                <SelectContent>{others.map((p) => <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount (৳) <span className="text-rose-500">*</span></Label>
              <Input type="number" value={hoForm.amount} onChange={(e) => setHoForm((f) => ({ ...f, amount: Number(e.target.value) }))} className="mt-1.5 text-lg font-semibold" />
            </div>
            <div>
              <Label>Method</Label>
              <Select value={hoForm.method} onValueChange={(v) => setHoForm((f) => ({ ...f, method: v }))}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Hand Cash", "Bank", "bKash", "Nagad", "Other"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Remarks</Label>
              <Textarea rows={2} value={hoForm.remarks} onChange={(e) => setHoForm((f) => ({ ...f, remarks: e.target.value }))} className="mt-1.5" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHoOpen(false)}>বাতিল</Button>
            <Button onClick={submitHandover} disabled={hoSaving} className="bg-emerald-600 hover:bg-emerald-700 gap-1.5">
              <HandCoins className="h-4 w-4" /> {hoSaving ? "সেভ হচ্ছে..." : "হ্যান্ডওভার"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Expense dialog */}
      <Dialog open={expOpen} onOpenChange={setExpOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Receipt className="h-5 w-5" /> অফিস খরচ যোগ</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date</Label>
                <Input type="date" value={expForm.entry_date} onChange={(e) => setExpForm((f) => ({ ...f, entry_date: e.target.value }))} className="mt-1.5" />
              </div>
              <div>
                <Label>Category</Label>
                <Select value={expForm.category} onValueChange={(v) => setExpForm((f) => ({ ...f, category: v }))}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>{EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Amount (৳) <span className="text-rose-500">*</span></Label>
              <Input type="number" value={expForm.amount} onChange={(e) => setExpForm((f) => ({ ...f, amount: Number(e.target.value) }))} className="mt-1.5 text-lg font-semibold" />
            </div>
            <div>
              <Label>Purpose</Label>
              <Input value={expForm.purpose} onChange={(e) => setExpForm((f) => ({ ...f, purpose: e.target.value }))} className="mt-1.5" placeholder="যেমনঃ অফিসে চা-নাশতা" />
            </div>
            <div>
              <Label>Remarks</Label>
              <Textarea rows={2} value={expForm.remarks} onChange={(e) => setExpForm((f) => ({ ...f, remarks: e.target.value }))} className="mt-1.5" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExpOpen(false)}>বাতিল</Button>
            <Button onClick={submitExpense} disabled={expSaving} className="gap-1.5">
              <Plus className="h-4 w-4" /> {expSaving ? "সেভ..." : "সেভ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value, positive, negative, subtle }: { label: string; value: number; positive?: boolean; negative?: boolean; subtle?: boolean }) {
  const cls = positive ? "text-emerald-600" : negative ? "text-rose-600" : "";
  const Icon = positive ? TrendingUp : negative ? TrendingDown : ArrowDownToLine;
  return (
    <div className={`flex items-center justify-between ${subtle ? "text-muted-foreground" : ""}`}>
      <span className="flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" /> {label}</span>
      <span className={`tabular-nums font-semibold ${cls}`}>৳ {Number(value).toLocaleString()}</span>
    </div>
  );
}
