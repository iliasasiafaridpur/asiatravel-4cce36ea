import { useEffect, useState, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { toast } from "sonner";
import { Wallet, Plus, ArrowLeftRight, Lock, RefreshCw } from "lucide-react";
import { generateNextId } from "@/lib/idgen";
import { formatDate } from "@/lib/modules";

export const Route = createFileRoute("/accounts-manager")({
  head: () => ({ meta: [{ title: "Accounts Manager — Cash Flow" }] }),
  component: AccountsManagerPage,
});

const ACCOUNT_TYPES = ["cash", "bank", "mobile", "crypto", "other"];
const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => `৳ ${(Number(n) || 0).toLocaleString()}`;

interface Account {
  id: string;
  account_code: string;
  name: string;
  type: string;
  opening_balance: number;
  current_balance: number;
  allow_negative: boolean;
  is_active: boolean;
  sort_order: number;
  notes: string | null;
}

interface Transfer {
  id: string;
  transfer_id: string;
  entry_date: string;
  from_account_id: string;
  to_account_id: string;
  amount: number;
  remarks: string | null;
}

interface Closing {
  id: string;
  closing_date: string;
  account_id: string;
  opening_balance: number;
  total_received: number;
  total_paid: number;
  expected_closing: number;
  actual_closing: number;
  discrepancy: number;
  is_locked: boolean;
  notes: string | null;
}

function AccountsManagerPage() {
  const { profile } = useCurrentUser();
  const isAdmin = profile?.role === "admin";

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Wallet className="h-6 w-6 text-primary" />
        <h1 className="text-xl sm:text-2xl font-bold">Accounts Manager</h1>
      </div>

      <Tabs defaultValue="accounts" className="w-full">
        <TabsList className="grid grid-cols-3 w-full max-w-xl">
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="transfers">Fund Transfers</TabsTrigger>
          <TabsTrigger value="closing">Day-End Closing</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts"><AccountsTab isAdmin={isAdmin} /></TabsContent>
        <TabsContent value="transfers"><TransfersTab /></TabsContent>
        <TabsContent value="closing"><ClosingTab isAdmin={isAdmin} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// 1. ACCOUNTS TAB
// ============================================================
function AccountsTab({ isAdmin }: { isAdmin: boolean }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    account_code: "", name: "", type: "cash",
    opening_balance: 0, allow_negative: false, is_active: true, notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("accounts").select("*").order("sort_order").order("name");
    if (error) toast.error(error.message);
    setAccounts((data as Account[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = async () => {
    setEditing(null);
    const code = await (await supabase.rpc("next_simple_id" as never, { _prefix: "ACC", _table: "accounts", _column: "account_code" } as never)).data as unknown as string;
    setForm({ account_code: code, name: "", type: "cash", opening_balance: 0, allow_negative: false, is_active: true, notes: "" });
    setOpenForm(true);
  };
  const openEdit = (a: Account) => {
    setEditing(a);
    setForm({
      account_code: a.account_code, name: a.name, type: a.type,
      opening_balance: a.opening_balance, allow_negative: a.allow_negative,
      is_active: a.is_active, notes: a.notes ?? "",
    });
    setOpenForm(true);
  };
  const submit = async () => {
    if (saving) return;
    if (!form.name.trim()) { toast.error("Account name required"); return; }
    setSaving(true);
    try {
      const payload = {
        account_code: form.account_code, name: form.name.trim(), type: form.type,
        opening_balance: Number(form.opening_balance) || 0,
        allow_negative: form.allow_negative, is_active: form.is_active,
        notes: form.notes || null,
      };
      const editRow = editing;
      if (editRow) {
        const { error } = await supabase.from("accounts").update(payload).eq("id", editRow.id);
        if (error) throw error;
        toast.success("Account updated");
      } else {
        const { error } = await supabase.from("accounts").insert(payload);
        if (error) throw error;
        toast.success("Account created");
      }
      setOpenForm(false); setEditing(null);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    const { error } = await supabase.from("accounts").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted"); load();
  };

  const totalBalance = accounts.reduce((s, a) => s + Number(a.current_balance || 0), 0);

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground">Total Cash in Hand (all accounts)</div>
            <div className="text-2xl font-bold tabular-nums">{fmt(totalBalance)}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
            {isAdmin && (
              <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />New Account</Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="p-2 text-left">Code</th>
                <th className="p-2 text-left">Name</th>
                <th className="p-2 text-left">Type</th>
                <th className="p-2 text-right">Opening</th>
                <th className="p-2 text-right">Current Balance</th>
                <th className="p-2 text-center">Active</th>
                <th className="p-2 text-center">Allow −</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              ) : accounts.length === 0 ? (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No accounts yet</td></tr>
              ) : accounts.map((a, idx) => (
                <tr key={a.id} className={`row-tint-${idx % 6} border-t`}>
                  <td className="p-2 font-mono text-xs">{a.account_code}</td>
                  <td className="p-2 font-medium">{a.name}</td>
                  <td className="p-2 capitalize">{a.type}</td>
                  <td className="p-2 text-right tabular-nums">{fmt(a.opening_balance)}</td>
                  <td className={`p-2 text-right tabular-nums font-semibold ${a.current_balance < 0 ? "text-rose-600" : ""}`}>
                    {fmt(a.current_balance)}
                  </td>
                  <td className="p-2 text-center">{a.is_active ? "✓" : "—"}</td>
                  <td className="p-2 text-center">{a.allow_negative ? "✓" : "—"}</td>
                  <td className="p-2 text-right">
                    {isAdmin && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => openEdit(a)}>Edit</Button>
                        <ConfirmDeleteButton onConfirm={() => remove(a.id)} description={`Delete account "${a.name}"?`} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Account" : "New Account"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Code</Label>
                <Input value={form.account_code} onChange={(e) => setForm({ ...form, account_code: e.target.value })} />
              </div>
              <div>
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Opening Balance</Label>
              <Input type="number" value={form.opening_balance}
                onChange={(e) => setForm({ ...form, opening_balance: Number(e.target.value) })} />
            </div>
            <div className="flex items-center justify-between"><Label>Active</Label>
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} /></div>
            <div className="flex items-center justify-between"><Label>Allow Negative Balance (Admin)</Label>
              <Switch checked={form.allow_negative} onCheckedChange={(v) => setForm({ ...form, allow_negative: v })} /></div>
            <div>
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// 2. FUND TRANSFERS TAB
// ============================================================
function TransfersTab() {
  const { user } = useCurrentUser();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    entry_date: today(), from_account_id: "", to_account_id: "", amount: 0, remarks: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [a, t] = await Promise.all([
      supabase.from("accounts").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("fund_transfers").select("*").order("entry_date", { ascending: false }).limit(200),
    ]);
    if (a.error) toast.error(a.error.message);
    if (t.error) toast.error(t.error.message);
    setAccounts((a.data as Account[]) ?? []);
    setTransfers((t.data as Transfer[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm({ entry_date: today(), from_account_id: "", to_account_id: "", amount: 0, remarks: "" });
    setOpen(true);
  };
  const submit = async () => {
    if (saving) return;
    if (!form.from_account_id || !form.to_account_id) { toast.error("Select both accounts"); return; }
    if (form.from_account_id === form.to_account_id) { toast.error("Source and destination must differ"); return; }
    if (!form.amount || form.amount <= 0) { toast.error("Amount must be greater than zero"); return; }
    setSaving(true);
    try {
      const transfer_id = await (await supabase.rpc("next_module_id" as never, { _prefix: "FT", _table: "fund_transfers", _column: "transfer_id" } as never)).data as unknown as string;
      const { error } = await supabase.from("fund_transfers").insert({
        transfer_id, entry_date: form.entry_date,
        from_account_id: form.from_account_id, to_account_id: form.to_account_id,
        amount: Number(form.amount), remarks: form.remarks || null,
        category: "INTERNAL_TRANSFER", created_by: user?.id ?? null,
      });
      if (error) throw error;
      toast.success("Fund transfer recorded");
      setOpen(false);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Transfer failed");
    } finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    const { error } = await supabase.from("fund_transfers").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted"); load();
  };

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "—";

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4 flex justify-between items-center">
          <div className="text-sm text-muted-foreground">Move money between your own accounts. Tagged as <span className="font-mono">INTERNAL_TRANSFER</span> so revenue / expense reports ignore it.</div>
          <Button onClick={openCreate} size="sm"><ArrowLeftRight className="h-4 w-4 mr-1" />New Transfer</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">ID</th>
                <th className="p-2 text-left">From</th>
                <th className="p-2 text-left">To</th>
                <th className="p-2 text-right">Amount</th>
                <th className="p-2 text-left">Remarks</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              ) : transfers.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No transfers yet</td></tr>
              ) : transfers.map((t, idx) => (
                <tr key={t.id} className={`row-tint-${idx % 6} border-t`}>
                  <td className="p-2">{formatDate(t.entry_date)}</td>
                  <td className="p-2 font-mono text-xs">{t.transfer_id}</td>
                  <td className="p-2">{accountName(t.from_account_id)}</td>
                  <td className="p-2">{accountName(t.to_account_id)}</td>
                  <td className="p-2 text-right tabular-nums font-medium">{fmt(t.amount)}</td>
                  <td className="p-2 text-muted-foreground">{t.remarks ?? ""}</td>
                  <td className="p-2 text-right">
                    <ConfirmDeleteButton onConfirm={() => remove(t.id)} description={`Delete transfer ${t.transfer_id}?`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Fund Transfer</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>From *</Label>
                <Select value={form.from_account_id} onValueChange={(v) => setForm({ ...form, from_account_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Source account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} ({fmt(a.current_balance)})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>To *</Label>
                <Select value={form.to_account_id} onValueChange={(v) => setForm({ ...form, to_account_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Destination" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Amount *</Label>
              <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Remarks</Label>
              <Textarea value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Transfer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// 3. DAY-END CLOSING TAB
// ============================================================
function ClosingTab({ isAdmin }: { isAdmin: boolean }) {
  const { user } = useCurrentUser();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [closings, setClosings] = useState<Closing[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(today());
  const [computed, setComputed] = useState({ opening: 0, received: 0, paid: 0, expected: 0 });
  const [actual, setActual] = useState(0);
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [a, c] = await Promise.all([
      supabase.from("accounts").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("daily_cash_closings").select("*").order("closing_date", { ascending: false }).limit(200),
    ]);
    if (a.error) toast.error(a.error.message);
    if (c.error) toast.error(c.error.message);
    setAccounts((a.data as Account[]) ?? []);
    setClosings((c.data as Closing[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const compute = useCallback(async (acctId: string, d: string) => {
    if (!acctId || !d) return;
    // opening = previous closing actual OR account opening_balance + activity before d
    const acct = accounts.find((x) => x.id === acctId);
    if (!acct) return;
    const { data: prev } = await supabase.from("daily_cash_closings")
      .select("actual_closing,closing_date")
      .eq("account_id", acctId).lt("closing_date", d)
      .order("closing_date", { ascending: false }).limit(1).maybeSingle();
    let opening = 0;
    let fromDate: string;
    if (prev) {
      opening = Number(prev.actual_closing);
      fromDate = prev.closing_date;
    } else {
      opening = Number(acct.opening_balance);
      fromDate = "1900-01-01";
    }
    // sum receipts and expenses for this account on day d (exclusive of prev closing date)
    const [rRecv, rExp, rXin, rXout] = await Promise.all([
      supabase.from("payment_receipts").select("amount").eq("account_id", acctId)
        .gt("entry_date", fromDate).lte("entry_date", d),
      supabase.from("cash_expenses").select("amount").eq("account_id", acctId)
        .gt("entry_date", fromDate).lte("entry_date", d),
      supabase.from("fund_transfers").select("amount").eq("to_account_id", acctId)
        .gt("entry_date", fromDate).lte("entry_date", d),
      supabase.from("fund_transfers").select("amount").eq("from_account_id", acctId)
        .gt("entry_date", fromDate).lte("entry_date", d),
    ]);
    const sum = (rows: { amount: number }[] | null) => (rows ?? []).reduce((s, r) => s + Number(r.amount), 0);
    const received = sum(rRecv.data as { amount: number }[]) + sum(rXin.data as { amount: number }[]);
    const paid = sum(rExp.data as { amount: number }[]) + sum(rXout.data as { amount: number }[]);
    const expected = opening + received - paid;
    setComputed({ opening, received, paid, expected });
    setActual(expected);
  }, [accounts]);

  useEffect(() => { if (open) compute(accountId, date); }, [open, accountId, date, compute]);

  const openCreate = () => {
    setAccountId(accounts[0]?.id ?? "");
    setDate(today()); setActual(0); setNotes("");
    setComputed({ opening: 0, received: 0, paid: 0, expected: 0 });
    setOpen(true);
  };

  const submit = async () => {
    if (saving) return;
    if (!accountId) { toast.error("Select account"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("daily_cash_closings").insert({
        closing_date: date, account_id: accountId,
        opening_balance: computed.opening, total_received: computed.received,
        total_paid: computed.paid, expected_closing: computed.expected,
        actual_closing: Number(actual), notes: notes || null,
        is_locked: true, closed_by: user?.id ?? null,
      });
      if (error) throw error;
      toast.success("Day closed and locked");
      setOpen(false); await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Closing failed");
    } finally { setSaving(false); }
  };
  const removeClosing = async (id: string) => {
    const { error } = await supabase.from("daily_cash_closings").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Closing removed (unlocked)"); load();
  };
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "—";

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4 flex justify-between items-center">
          <div className="text-sm text-muted-foreground">
            Close each account at end-of-day. Locked dates cannot be edited by general staff.
          </div>
          <Button onClick={openCreate} size="sm"><Lock className="h-4 w-4 mr-1" />New Day-End Closing</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Account</th>
                <th className="p-2 text-right">Opening</th>
                <th className="p-2 text-right">Received</th>
                <th className="p-2 text-right">Paid</th>
                <th className="p-2 text-right">Expected</th>
                <th className="p-2 text-right">Actual</th>
                <th className="p-2 text-right">Discrepancy</th>
                <th className="p-2 text-center">Locked</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              ) : closings.length === 0 ? (
                <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">No closings yet</td></tr>
              ) : closings.map((c, idx) => (
                <tr key={c.id} className={`row-tint-${idx % 6} border-t`}>
                  <td className="p-2">{formatDate(c.closing_date)}</td>
                  <td className="p-2 font-medium">{accountName(c.account_id)}</td>
                  <td className="p-2 text-right tabular-nums">{fmt(c.opening_balance)}</td>
                  <td className="p-2 text-right tabular-nums text-emerald-600">{fmt(c.total_received)}</td>
                  <td className="p-2 text-right tabular-nums text-rose-600">{fmt(c.total_paid)}</td>
                  <td className="p-2 text-right tabular-nums font-semibold">{fmt(c.expected_closing)}</td>
                  <td className="p-2 text-right tabular-nums">{fmt(c.actual_closing)}</td>
                  <td className={`p-2 text-right tabular-nums font-semibold ${c.discrepancy < 0 ? "text-rose-600" : c.discrepancy > 0 ? "text-amber-600" : ""}`}>
                    {fmt(c.discrepancy)}
                  </td>
                  <td className="p-2 text-center">{c.is_locked ? "🔒" : "—"}</td>
                  <td className="p-2 text-right">
                    {isAdmin && (
                      <ConfirmDeleteButton onConfirm={() => removeClosing(c.id)} description={`Unlock message={`Unlock & delete ${formatDate(c.closing_date)} closing for ${accountName(c.account_id)}?`} delete ${formatDate(c.closing_date)} closing for ${accountName(c.account_id)}?`} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Day-End Closing</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Account *</Label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Date *</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>

            <div className="rounded-md border p-3 bg-muted/30 space-y-1 text-sm">
              <div className="flex justify-between"><span>Opening Balance</span><span className="tabular-nums font-medium">{fmt(computed.opening)}</span></div>
              <div className="flex justify-between text-emerald-700"><span>+ Total Received</span><span className="tabular-nums font-medium">{fmt(computed.received)}</span></div>
              <div className="flex justify-between text-rose-700"><span>− Total Paid</span><span className="tabular-nums font-medium">{fmt(computed.paid)}</span></div>
              <div className="flex justify-between border-t pt-1 font-semibold"><span>Expected Closing</span><span className="tabular-nums">{fmt(computed.expected)}</span></div>
            </div>

            <div>
              <Label>Actual Cash Counted *</Label>
              <Input type="number" value={actual} onChange={(e) => setActual(Number(e.target.value))} />
            </div>
            <div className={`text-sm font-semibold ${Number(actual) - computed.expected < 0 ? "text-rose-600" : Number(actual) - computed.expected > 0 ? "text-amber-600" : "text-emerald-600"}`}>
              Discrepancy: {fmt(Number(actual) - computed.expected)}
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? "Closing…" : "Close & Lock Day"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
