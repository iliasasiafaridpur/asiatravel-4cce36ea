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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowRightLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/modules";

export const Route = createFileRoute("/cash-transfers")({
  head: () => ({ meta: [{ title: "Cash Transfer — Manager → Md Sir" }] }),
  component: CashTransfersPage,
});

const METHODS = ["Hand Cash", "Bank", "bKash", "Nagad", "Other"];
const todayIso = () => new Date().toISOString().slice(0, 10);

interface Row {
  id: string;
  transfer_id: string;
  entry_date: string;
  from_name: string | null;
  to_name: string | null;
  amount: number;
  method: string;
  purpose: string | null;
  remarks: string | null;
}

function CashTransfersPage() {
  const { user, profile } = useCurrentUser();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [form, setForm] = useState({
    entry_date: todayIso(),
    to_user: "",
    amount: 0,
    method: "Hand Cash",
    purpose: "",
    remarks: "",
  });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase.from("cash_transfers").select("*").order("entry_date", { ascending: false }).limit(500),
      supabase.from("profiles").select("user_id,full_name,role"),
    ]);
    setRows(((r as unknown) as Row[]) ?? []);
    setProfiles(((p as unknown) as Profile[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const ch = supabase.channel("cash_transfers_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_transfers" }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const others = useMemo(
    () => profiles.filter((p) => p.user_id !== user?.id),
    [profiles, user?.id]
  );

  const totals = useMemo(() => {
    const t = { count: rows.length, amount: 0 };
    rows.forEach((r) => { t.amount += Number(r.amount); });
    return t;
  }, [rows]);

  const save = async () => {
    if (!user?.id) { toast.error("লগইন করুন"); return; }
    if (form.amount <= 0) { toast.error("টাকার পরিমাণ দিন"); return; }
    if (!form.to_user) { toast.error("কাকে দিচ্ছেন সিলেক্ট করুন"); return; }
    setSaving(true);
    try {
      const toProf = profiles.find((p) => p.user_id === form.to_user);
      // Generate id
      const { data: idData, error: idErr } = await supabase.rpc("next_module_id" as never, {
        _prefix: "CSH", _table: "cash_transfers", _column: "transfer_id",
      } as never);
      if (idErr) throw idErr;
      const { error } = await supabase.from("cash_transfers").insert({
        transfer_id: idData as unknown as string,
        entry_date: form.entry_date,
        from_user: user.id,
        to_user: form.to_user,
        from_name: displayName(profile, user),
        to_name: toProf?.full_name ?? null,
        amount: Number(form.amount) || 0,
        method: form.method,
        purpose: form.purpose || null,
        remarks: form.remarks || null,
        created_by: user.id,
      });
      if (error) throw error;
      toast.success("Transfer record saved");
      setForm({ entry_date: todayIso(), to_user: form.to_user, amount: 0, method: form.method, purpose: "", remarks: "" });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const del = async (id: string) => {
    if (!confirm("Delete this transfer?")) return;
    const { error } = await supabase.from("cash_transfers").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); await load(); }
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
          <ArrowRightLeft className="h-6 w-6 text-primary" /> Cash Transfer
        </h1>
        <p className="text-sm text-muted-foreground">Manager → Md Sir-কে হ্যান্ড ক্যাশ / ব্যাংক / অন্যান্য মাধ্যমে টাকা পাঠানোর হিসাব</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">নতুন Transfer</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.entry_date} onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))} className="mt-1.5" />
            </div>
            <div>
              <Label>From (You)</Label>
              <Input value={displayName(profile, user)} readOnly disabled className="mt-1.5" />
            </div>
            <div>
              <Label>To <span className="text-rose-500">*</span></Label>
              <Select value={form.to_user} onValueChange={(v) => setForm((f) => ({ ...f, to_user: v }))}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="কাকে দিচ্ছেন?" /></SelectTrigger>
                <SelectContent>
                  {others.map((p) => <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount (৳) <span className="text-rose-500">*</span></Label>
              <Input type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: Number(e.target.value) }))} className="mt-1.5" />
            </div>
            <div>
              <Label>Method</Label>
              <Select value={form.method} onValueChange={(v) => setForm((f) => ({ ...f, method: v }))}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Purpose</Label>
              <Input value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} className="mt-1.5" placeholder="যেমনঃ অফিস খরচ" />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <Label>Remarks</Label>
              <Textarea rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} className="mt-1.5" />
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <Button onClick={save} disabled={saving} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
              <Plus className="h-4 w-4" /> {saving ? "Saving..." : "Save Transfer"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Transfer History</span>
            <span className="text-sm font-normal text-muted-foreground">
              মোট {totals.count} এন্ট্রি • ৳ {totals.amount.toLocaleString()}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">লোড হচ্ছে...</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">কোনো এন্ট্রি নেই</TableCell></TableRow>
                ) : rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(r.entry_date)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.transfer_id}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.from_name ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap"><Badge variant="outline">{r.to_name ?? "—"}</Badge></TableCell>
                    <TableCell><Badge variant="secondary">{r.method}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-emerald-600">৳ {Number(r.amount).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{r.purpose ?? "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => del(r.id)}>
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
    </div>
  );
}
