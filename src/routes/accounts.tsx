import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Wallet, ArrowUpRight, Receipt, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/modules";

export const Route = createFileRoute("/accounts")({
  head: () => ({ meta: [{ title: "My Accounts — Travel Manager" }] }),
  component: AccountsPage,
});

const METHODS = ["Hand Cash", "Bank", "bKash", "Nagad", "Other"];
const EXPENSE_CATEGORIES = ["Office", "Transport", "Food", "Stationery", "Bill", "Other"];
const today = () => new Date().toISOString().slice(0, 10);

interface Acct {
  user_id: string; full_name: string;
  total_received: number; total_received_today: number;
  total_handed_over: number; total_expenses: number; current_balance: number;
}
interface Hand { id: string; handover_id: string; entry_date: string; to_name: string; amount: number; method: string; remarks: string | null; }
interface Exp  { id: string; expense_id: string; entry_date: string; category: string; purpose: string | null; amount: number; remarks: string | null; }
interface Recv { id: string; entry_date: string; service: string; ref_id: string; passenger: string; amount: number; }

function AccountsPage() {
  const { user, profile } = useCurrentUser();
  const [acct, setAcct] = useState<Acct | null>(null);
  const [handovers, setHandovers] = useState<Hand[]>([]);
  const [expenses, setExpenses] = useState<Exp[]>([]);
  const [hForm, setHForm] = useState({ entry_date: today(), to_name: "MD Sir", amount: 0, method: "Hand Cash", remarks: "" });
  const [eForm, setEForm] = useState({ entry_date: today(), category: "Office", purpose: "", amount: 0, remarks: "" });
  const reloadingRef = useRef(false);
  const queuedRef = useRef(false);

  const reload = useCallback(async () => {
    if (!user?.id) return;
    if (reloadingRef.current) {
      queuedRef.current = true;
      return;
    }
    reloadingRef.current = true;
    const [a, h, e] = await Promise.all([
      supabase.rpc("get_user_account" as never, { _user_id: user.id } as never),
      supabase.from("cash_handovers").select("id,handover_id,entry_date,to_name,amount,method,remarks").eq("from_user", user.id).order("entry_date", { ascending: false }).limit(100),
      supabase.from("cash_expenses").select("id,expense_id,entry_date,category,purpose,amount,remarks").eq("spent_by", user.id).order("entry_date", { ascending: false }).limit(100),
    ]);
    const arr = (a.data as unknown) as Acct[] | null;
    setAcct(arr?.[0] ?? null);
    setHandovers(((h.data as unknown) as Hand[]) ?? []);
    setExpenses(((e.data as unknown) as Exp[]) ?? []);
    reloadingRef.current = false;
    if (queuedRef.current) {
      queuedRef.current = false;
      window.setTimeout(() => void reload(), 250);
    }
  }, [user?.id]);

  useEffect(() => {
    void reload();
    const ch = supabase.channel("acct_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_handovers" }, () => void reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_expenses" }, () => void reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, () => void reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "bmet_cards" }, () => void reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "saudi_visas" }, () => void reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "kuwait_visas" }, () => void reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, reload]);

  const saveHandover = async () => {
    if (!user?.id) return toast.error("লগ-ইন করুন");
    if (hForm.amount <= 0) return toast.error("টাকার পরিমাণ দিন");
    const { data: idData, error: idErr } = await supabase.rpc("next_module_id" as never, {
      _prefix: "HND", _table: "cash_handovers", _column: "handover_id",
    } as never);
    if (idErr) return toast.error(idErr.message);
    const { error } = await supabase.from("cash_handovers").insert({
      handover_id: idData as unknown as string,
      entry_date: hForm.entry_date,
      from_user: user.id,
      from_name: displayName(profile, user),
      to_name: hForm.to_name,
      amount: Number(hForm.amount) || 0,
      method: hForm.method,
      remarks: hForm.remarks || null,
      created_by: user.id,
    });
    if (error) return toast.error(error.message);
    toast.success("✓ Handover এন্ট্রি হয়েছে");
    setHForm({ ...hForm, amount: 0, remarks: "" });
    void reload();
  };

  const saveExpense = async () => {
    if (!user?.id) return toast.error("লগ-ইন করুন");
    if (eForm.amount <= 0) return toast.error("টাকার পরিমাণ দিন");
    const { data: idData, error: idErr } = await supabase.rpc("next_module_id" as never, {
      _prefix: "EXP", _table: "cash_expenses", _column: "expense_id",
    } as never);
    if (idErr) return toast.error(idErr.message);
    const { error } = await supabase.from("cash_expenses").insert({
      expense_id: idData as unknown as string,
      entry_date: eForm.entry_date,
      spent_by: user.id,
      spent_by_name: displayName(profile, user),
      category: eForm.category,
      purpose: eForm.purpose || null,
      amount: Number(eForm.amount) || 0,
      remarks: eForm.remarks || null,
      created_by: user.id,
    });
    if (error) return toast.error(error.message);
    toast.success("✓ খরচ এন্ট্রি হয়েছে");
    setEForm({ ...eForm, amount: 0, purpose: "", remarks: "" });
    void reload();
  };

  const delHand = async (id: string) => {
    if (!confirm("Delete?")) return;
    const { error } = await supabase.from("cash_handovers").delete().eq("id", id);
    if (error) toast.error(error.message); else void reload();
  };
  const delExp = async (id: string) => {
    if (!confirm("Delete?")) return;
    const { error } = await supabase.from("cash_expenses").delete().eq("id", id);
    if (error) toast.error(error.message); else void reload();
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="rounded-2xl p-5 text-primary-foreground" style={{ background: "var(--gradient-hero)", boxShadow: "var(--shadow-glow)" }}>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Wallet className="h-6 w-6" /> আমার Accounts</h1>
        <p className="text-sm opacity-90 mt-1">{acct?.full_name ?? displayName(profile, user)} — শুধু আপনার নিজের হিসাব</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="মোট Received" value={acct?.total_received ?? 0} color="from-emerald-500 to-teal-600" />
        <Stat label="আজকের Received" value={acct?.total_received_today ?? 0} color="from-blue-500 to-indigo-600" />
        <Stat label="Hand Over" value={acct?.total_handed_over ?? 0} color="from-amber-500 to-orange-600" />
        <Stat label="Current Balance" value={acct?.current_balance ?? 0} color="from-violet-500 to-purple-600" highlight />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Hand-over to MD Sir */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ArrowUpRight className="h-4 w-4 text-amber-600" /> কর্তৃপক্ষকে Cash Hand-over</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Date</Label><Input type="date" value={hForm.entry_date} onChange={(e) => setHForm({ ...hForm, entry_date: e.target.value })} /></div>
              <div><Label>To</Label><Input value={hForm.to_name} onChange={(e) => setHForm({ ...hForm, to_name: e.target.value })} placeholder="MD Sir" /></div>
              <div><Label>Amount (৳)</Label><Input type="number" inputMode="decimal" value={hForm.amount === 0 ? "" : hForm.amount} placeholder="0" onChange={(e) => setHForm({ ...hForm, amount: Number(e.target.value) || 0 })} /></div>
              <div>
                <Label>Method</Label>
                <Select value={hForm.method} onValueChange={(v) => setHForm({ ...hForm, method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Remarks</Label><Textarea rows={2} value={hForm.remarks} onChange={(e) => setHForm({ ...hForm, remarks: e.target.value })} /></div>
            <Button onClick={saveHandover} className="w-full gap-1.5 bg-amber-600 hover:bg-amber-700"><Plus className="h-4 w-4" /> Hand-over সেভ</Button>
          </CardContent>
        </Card>

        {/* Expense */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4 text-rose-600" /> খরচ এন্ট্রি</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Date</Label><Input type="date" value={eForm.entry_date} onChange={(e) => setEForm({ ...eForm, entry_date: e.target.value })} /></div>
              <div>
                <Label>Category</Label>
                <Select value={eForm.category} onValueChange={(v) => setEForm({ ...eForm, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2"><Label>Purpose</Label><Input value={eForm.purpose} onChange={(e) => setEForm({ ...eForm, purpose: e.target.value })} placeholder="কিসের খরচ?" /></div>
              <div><Label>Amount (৳)</Label><Input type="number" inputMode="decimal" value={eForm.amount === 0 ? "" : eForm.amount} placeholder="0" onChange={(e) => setEForm({ ...eForm, amount: Number(e.target.value) || 0 })} /></div>
            </div>
            <div><Label>Remarks</Label><Textarea rows={2} value={eForm.remarks} onChange={(e) => setEForm({ ...eForm, remarks: e.target.value })} /></div>
            <Button onClick={saveExpense} className="w-full gap-1.5 bg-rose-600 hover:bg-rose-700"><Plus className="h-4 w-4" /> খরচ সেভ</Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Hand-over History ({handovers.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>ID</TableHead><TableHead>To</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {handovers.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">কোনো এন্ট্রি নেই</TableCell></TableRow>
                  : handovers.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(h.entry_date)}</TableCell>
                      <TableCell className="font-mono text-xs">{h.handover_id}</TableCell>
                      <TableCell><Badge variant="outline">{h.to_name}</Badge></TableCell>
                      <TableCell><Badge variant="secondary">{h.method}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-amber-600">৳ {Number(h.amount).toLocaleString()}</TableCell>
                      <TableCell><Button variant="ghost" size="icon" onClick={() => void delHand(h.id)}><Trash2 className="h-3.5 w-3.5 text-rose-500" /></Button></TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Expense History ({expenses.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>ID</TableHead><TableHead>Category</TableHead><TableHead>Purpose</TableHead><TableHead className="text-right">Amount</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {expenses.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">কোনো এন্ট্রি নেই</TableCell></TableRow>
                  : expenses.map((x) => (
                    <TableRow key={x.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(x.entry_date)}</TableCell>
                      <TableCell className="font-mono text-xs">{x.expense_id}</TableCell>
                      <TableCell><Badge variant="secondary">{x.category}</Badge></TableCell>
                      <TableCell className="text-xs">{x.purpose ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-rose-600">৳ {Number(x.amount).toLocaleString()}</TableCell>
                      <TableCell><Button variant="ghost" size="icon" onClick={() => void delExp(x.id)}><Trash2 className="h-3.5 w-3.5 text-rose-500" /></Button></TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, color, highlight }: { label: string; value: number; color: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl p-4 text-white shadow-lg bg-gradient-to-br ${color} ${highlight ? "ring-2 ring-white/40" : ""}`}>
      <p className="text-[11px] uppercase tracking-wide opacity-90">{label}</p>
      <p className="text-xl sm:text-2xl font-bold mt-1 tabular-nums">৳ {Number(value).toLocaleString()}</p>
    </div>
  );
}
