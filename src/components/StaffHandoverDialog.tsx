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
import { Lock, AlertTriangle } from "lucide-react";

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => `৳ ${(n || 0).toLocaleString()}`;

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
  const [systemTotal, setSystemTotal] = useState<number>(0);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [cash, setCash] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingTotal, setLoadingTotal] = useState(false);

  useEffect(() => {
    if (!open || !user?.id) return;
    let cancelled = false;
    (async () => {
      setLoadingTotal(true);
      const { data, error } = await supabase
        .from("payment_receipts")
        .select("amount")
        .eq("received_by", user.id)
        .eq("approval_status", "pending_md")
        .lte("entry_date", closingDate)
        .is("handover_id", null);
      if (cancelled) return;
      if (error) toast.error(error.message);
      const rows = (data ?? []) as { amount: number }[];
      setSystemTotal(rows.reduce((s, r) => s + Number(r.amount || 0), 0));
      setPendingCount(rows.length);
      setLoadingTotal(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user?.id, closingDate]);

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
  const variance = declared - systemTotal;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" /> Submit Daily Cash Handover
          </DialogTitle>
          <DialogDescription>
            Once submitted, your receipts on or before this date are locked until MD approves.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Closing Date</Label>
            <DateInput value={closingDate} onChange={(v) => setClosingDate(v)} />
          </div>

          <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">System Total (pending)</span>
              <span className="tabular-nums font-semibold">
                {loadingTotal ? "…" : fmt(systemTotal)}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {pendingCount} pending receipt{pendingCount === 1 ? "" : "s"} will be locked
            </div>
          </div>

          <div>
            <Label className="text-xs">Physical Cash Counted (৳) *</Label>
            <Input
              type="number"
              inputMode="numeric"
              placeholder="0"
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
              {fmt(variance)} vs system total
            </div>
          )}

          <div>
            <Label className="text-xs">Remarks (optional)</Label>
            <Textarea
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Notes for MD…"
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
