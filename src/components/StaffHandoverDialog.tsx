import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateInput } from "@/components/ui/date-input";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { toast } from "sonner";
import { Lock, AlertTriangle, TrendingUp, TrendingDown, Wallet, BookOpen } from "lucide-react";
import { HandoverLedgerBook } from "@/components/HandoverLedgerBook";
import { formatDateTime } from "@/lib/modules";

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => `৳ ${(n || 0).toLocaleString()}`;

type Receipt = {
  id: string; receipt_id?: string | null; amount: number;
  passenger_name?: string | null; entry_date: string; created_at?: string | null;
  service_table?: string | null; service_row_id?: string | null;
  service_type?: string | null;
  discount?: number;
};
type Expense = { id: string; expense_id?: string | null; amount: number; category: string; purpose?: string | null; entry_date: string; created_at?: string | null };

const DISCOUNT_TABLES = ["tickets", "bmet_cards", "saudi_visas", "kuwait_visas", "agency_ledger"] as const;

export function StaffHandoverDialog({
  open,
  onOpenChange,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmitted?: () => void;
}) {
  const { user } = useCurrentUser();
  const [closingDate, setClosingDate] = useState(today());
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [cash, setCash] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [openHistory, setOpenHistory] = useState(false);

  useEffect(() => {
    if (!open || !user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [r, e] = await Promise.all([
        supabase
          .from("payment_receipts")
          .select("id,receipt_id,amount,passenger_name,entry_date,created_at,service_table,service_row_id,service_type")
          .eq("received_by", user.id)
          .eq("approval_status", "pending_md")
          .lte("entry_date", closingDate)
          .is("handover_id", null)
          .not("source", "eq", "discount")
          .not("method", "ilike", "discount")
          .order("entry_date", { ascending: false }),
        supabase
          .from("cash_expenses")
          .select("id,expense_id,amount,category,purpose,entry_date,created_at")
          .eq("spent_by", user.id)
          .eq("entry_date", closingDate)
          .is("handover_id", null)
          .order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      if (r.error) toast.error(r.error.message);
      if (e.error) toast.error(e.error.message);
      const recs = ((r.data ?? []) as unknown) as Receipt[];

      // Enrich each receipt with the discount stored on its underlying service row.
      const byTable: Record<string, Set<string>> = {};
      for (const rec of recs) {
        if (!rec.service_table || !rec.service_row_id) continue;
        if (!(DISCOUNT_TABLES as readonly string[]).includes(rec.service_table)) continue;
        byTable[rec.service_table] ??= new Set();
        byTable[rec.service_table].add(rec.service_row_id);
      }
      const discMap: Record<string, number> = {};
      await Promise.all(
        Object.entries(byTable).map(async ([tbl, ids]) => {
          const { data } = await supabase
            .from(tbl as never)
            .select("id,discount_amount")
            .in("id", Array.from(ids));
          for (const row of (data ?? []) as Array<{ id: string; discount_amount: number | null }>) {
            discMap[`${tbl}:${row.id}`] = Number(row.discount_amount ?? 0);
          }
        })
      );
      for (const rec of recs) {
        const k = rec.service_table && rec.service_row_id ? `${rec.service_table}:${rec.service_row_id}` : "";
        rec.discount = k ? (discMap[k] ?? 0) : 0;
      }

      setReceipts(recs);
      setExpenses(((e.data ?? []) as unknown) as Expense[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user?.id, closingDate]);

  const totalReceived = receipts.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalExpense = expenses.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalDiscount = receipts.reduce((s, r) => s + Number(r.discount || 0), 0);
  const netCash = totalReceived - totalExpense;

  const submit = async () => {
    const amt = Number(cash);
    if (!amt || amt <= 0) return toast.error("সঠিক টাকার পরিমাণ দিন");
    setSaving(true);
    const { error } = await supabase.rpc("submit_handover" as never, {
      _submitted_amount: amt,
      _closing_date: closingDate,
      _remarks: remarks || null,
    } as never);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Handover submitted. Awaiting MD approval.");
    setCash("");
    setRemarks("");
    onOpenChange(false);
    onSubmitted?.();
  };

  const declared = Number(cash) || 0;
  const variance = declared - netCash;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" /> Submit Cash Handover
          </DialogTitle>
          <DialogDescription>
            দিনে একাধিক বার Handover দিতে পারবেন। MD আয়-ব্যয় দেখে Approve করবেন।
          </DialogDescription>
        </DialogHeader>

        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2 mb-1"
          onClick={() => setOpenHistory(true)}
        >
          <BookOpen className="h-4 w-4" />
          📒 আমার হিসাব বই (Handover History)
        </Button>

        <HandoverLedgerBook open={openHistory} onOpenChange={setOpenHistory} mode="mine" />


        <div className="space-y-3">
          <div>
            <Label className="text-xs">Closing Date</Label>
            <DateInput value={closingDate} onChange={(e) => setClosingDate(e.target.value)} />
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border bg-emerald-500/10 p-2.5">
              <div className="flex items-center gap-1 text-[10px] uppercase text-emerald-600 dark:text-emerald-400">
                <TrendingUp className="h-3 w-3" /> আয়
              </div>
              <div className="text-sm font-semibold tabular-nums mt-1">{fmt(totalReceived)}</div>
              <div className="text-[10px] text-muted-foreground">{receipts.length} receipt</div>
            </div>
            <div className="rounded-lg border bg-rose-500/10 p-2.5">
              <div className="flex items-center gap-1 text-[10px] uppercase text-rose-600 dark:text-rose-400">
                <TrendingDown className="h-3 w-3" /> ব্যয়
              </div>
              <div className="text-sm font-semibold tabular-nums mt-1">{fmt(totalExpense)}</div>
              <div className="text-[10px] text-muted-foreground">{expenses.length} expense</div>
            </div>
            <div className="rounded-lg border bg-primary/10 p-2.5">
              <div className="flex items-center gap-1 text-[10px] uppercase text-primary">
                <Wallet className="h-3 w-3" /> Net Cash
              </div>
              <div className="text-sm font-semibold tabular-nums mt-1">{fmt(netCash)}</div>
              <div className="text-[10px] text-muted-foreground">আয় − ব্যয়</div>
            </div>
          </div>

          {/* Income detail */}
          <div className="rounded-lg border">
            <div className="px-3 py-2 text-xs font-semibold border-b bg-muted/30">
              আয় বিবরণ (Pending Receipts) — {receipts.length}
            </div>
            <div className="max-h-32 overflow-y-auto divide-y text-xs">
              {loading ? (
                <div className="p-3 text-muted-foreground">লোড হচ্ছে…</div>
              ) : receipts.length === 0 ? (
                <div className="p-3 text-muted-foreground">কোনো pending receipt নেই</div>
              ) : (
                receipts.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate">{r.passenger_name || "—"}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {r.receipt_id || r.id.slice(0, 8)} • {formatDateTime(r.created_at || r.entry_date)}
                      </div>
                    </div>
                    <div className="tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                      +{fmt(Number(r.amount))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Expense detail */}
          <div className="rounded-lg border">
            <div className="px-3 py-2 text-xs font-semibold border-b bg-muted/30">
              ব্যয় বিবরণ (আজকের) — {expenses.length}
            </div>
            <div className="max-h-32 overflow-y-auto divide-y text-xs">
              {loading ? (
                <div className="p-3 text-muted-foreground">লোড হচ্ছে…</div>
              ) : expenses.length === 0 ? (
                <div className="p-3 text-muted-foreground">কোনো ব্যয় নেই</div>
              ) : (
                expenses.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate">{e.category}{e.purpose ? ` — ${e.purpose}` : ""}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {e.expense_id || e.id.slice(0, 8)} • {formatDateTime(e.created_at || e.entry_date)}
                      </div>
                    </div>
                    <div className="tabular-nums font-semibold text-rose-600 dark:text-rose-400">
                      −{fmt(Number(e.amount))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <Label className="text-xs">Physical Cash Counted (৳) *</Label>
            <Input
              type="number"
              inputMode="numeric"
              placeholder={String(netCash || 0)}
              value={cash}
              onChange={(e) => setCash(e.target.value)}
              autoFocus
            />
          </div>

          {declared > 0 && Math.abs(variance) > 0 && (
            <div
              className={`flex items-center gap-2 rounded-md p-2 text-xs ${
                variance > 0
                  ? "bg-emerald-500/10 text-emerald-600"
                  : "bg-amber-500/10 text-amber-600"
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Variance: {variance > 0 ? "+" : ""}
              {fmt(variance)} vs Net Cash
            </div>
          )}

          <div>
            <Label className="text-xs">Remarks (optional)</Label>
            <Textarea
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="MD এর জন্য নোট…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !cash}>
            {saving ? "Submitting…" : "Submit to MD"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
