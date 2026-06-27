import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateInput } from "@/components/ui/date-input";
import { toast } from "sonner";
import { verifyCurrentPassword } from "@/components/PasswordConfirmDialog";
import { generateNextId } from "@/lib/idgen";
import type { ModuleSchema } from "@/lib/modules";

type Row = Record<string, unknown> & { id: string };

const todayIso = () => new Date().toISOString().slice(0, 10);
const n = (v: unknown) => Number(v ?? 0) || 0;
/** Show empty string instead of a sticky leading 0 in number inputs. */
const blank = (v: number) => (v ? String(v) : "");
const money = (v: number) =>
  (Math.round(v * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

export function TicketRefundDialog({
  row,
  userEmail,
  userId,
  onClose,
  onDone,
}: {
  row: Row | null;
  userEmail: string;
  userId: string | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const open = !!row;
  const cost = n(row?.cost_price);
  const received = n(row?.received);
  const agency = String(row?.agency_sold ?? "").trim();
  const vendor = String(row?.vendor_bought ?? "").trim();
  const alreadyCancelled = !!row?.cancelled;

  // Vendor side: vendor_refund (returned to office) + vendor_refund_fee (kept by vendor) = cost
  const [vendorRefund, setVendorRefund] = useState<string>("");
  const [vendorFee, setVendorFee] = useState<string>("");
  // Passenger side: passenger_refund (returned) + office_refund_fee (kept by office) = received
  const [paxRefund, setPaxRefund] = useState<string>("");
  const [officeFee, setOfficeFee] = useState<string>("");
  const [mode, setMode] = useState<"cash" | "advance">("cash");
  const [cDate, setCDate] = useState<string>(todayIso());
  const [reason, setReason] = useState<string>("");
  const [pw, setPw] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState<string | null>(null);

  // Seed values once per opened row.
  if (row && seeded !== row.id) {
    setSeeded(row.id);
    if (alreadyCancelled) {
      setVendorRefund(blank(n(row.vendor_refund)));
      setVendorFee(blank(n(row.vendor_refund_fee)));
      setPaxRefund(blank(n(row.passenger_refund)));
      setOfficeFee(blank(n(row.office_refund_fee)));
      setMode((String(row.passenger_refund_mode ?? "cash") === "advance" ? "advance" : "cash"));
      setCDate(String(row.cancel_date ?? todayIso()));
      setReason(String(row.cancel_reason ?? ""));
    } else {
      // default: vendor returns full cost (fee 0); passenger gets full received back (fee 0)
      setVendorRefund(blank(cost));
      setVendorFee("");
      setPaxRefund(blank(received));
      setOfficeFee("");
      setMode("cash");
      setCDate(todayIso());
      setReason("");
    }
    setPw("");
  }

  const vRefundNum = Math.min(Math.max(0, n(vendorRefund)), cost);
  const vFeeNum = Math.max(0, cost - vRefundNum);
  const pRefundNum = Math.min(Math.max(0, n(paxRefund)), received);
  const oFeeNum = Math.max(0, received - pRefundNum);

  const netProfit = useMemo(() => oFeeNum - vFeeNum, [oFeeNum, vFeeNum]);

  const onVendorRefund = (v: string) => {
    setVendorRefund(v);
    setVendorFee(String(Math.max(0, cost - (n(v) || 0))));
  };
  const onVendorFee = (v: string) => {
    setVendorFee(v);
    setVendorRefund(String(Math.max(0, cost - (n(v) || 0))));
  };
  const onPaxRefund = (v: string) => {
    setPaxRefund(v);
    setOfficeFee(String(Math.max(0, received - (n(v) || 0))));
  };
  const onOfficeFee = (v: string) => {
    setOfficeFee(v);
    setPaxRefund(String(Math.max(0, received - (n(v) || 0))));
  };

  const close = () => {
    if (busy) return;
    setSeeded(null);
    onClose();
  };

  const submit = async () => {
    if (!row) return;
    if (!pw.trim()) {
      toast.error("নিশ্চিত করতে পাসওয়ার্ড দিন");
      return;
    }
    if (mode === "advance" && pRefundNum > 0 && !agency) {
      toast.error("Advance রাখতে হলে টিকেটে agency থাকতে হবে। নগদ ফেরত বেছে নিন।");
      return;
    }
    setBusy(true);
    try {
      const ok = await verifyCurrentPassword(userEmail, pw);
      if (!ok) {
        toast.error("ভুল পাসওয়ার্ড");
        return;
      }

      // 1) Update the ticket — triggers re-sync vendor & agency ledgers to net figures.
      const { error: upErr } = await supabase
        .from("tickets" as never)
        .update({
          cancelled: true,
          cancel_date: cDate || todayIso(),
          cancel_reason: reason.trim() || null,
          vendor_refund: vRefundNum,
          vendor_refund_fee: vFeeNum,
          passenger_refund: pRefundNum,
          passenger_refund_mode: mode,
          office_refund_fee: oFeeNum,
        } as never)
        .eq("id", row.id);
      if (upErr) throw upErr;

      // 2) Clean up any previous refund advance entry (idempotent re-cancel).
      //    NOTE: Cash refunds do NOT create a cash_expenses row. The ticket update
      //    nets `received` down to office_refund_fee, so the cash drawer mirror
      //    automatically drops by the refunded amount — adding an expense too
      //    would double-count the cash going out.
      await supabase
        .from("agency_ledger" as never)
        .delete()
        .eq("source_table", "ticket_refund_advance")
        .eq("source_id", row.id);

      // 3) Advance mode → keep passenger refund as agency advance (credit for next ticket).
      //    This re-adds the kept cash to the drawer and gives the agent a credit,
      //    instead of paying it out in cash.
      if (mode === "advance" && pRefundNum > 0 && agency) {
        const advId = await generateNextId({
          key: "_agl",
          label: "",
          short: "",
          table: "agency_ledger",
          idColumn: "ledger_id",
          idPrefix: "AGL",
          monthlyId: true,
          fields: [],
        } as unknown as ModuleSchema);
        const { error: advErr } = await supabase.from("agency_ledger" as never).insert({
          ledger_id: advId,
          entry_date: cDate || todayIso(),
          agent_name: agency,
          passenger_name: String(row.passenger_name ?? ""),
          service_type: "ADVANCE",
          total_bill: 0,
          received_amount: pRefundNum,
          payment_method: "Ticket Refund Advance",
          remarks: `টিকেট ক্যানসেল রিফান্ড advance · ${String(row.ticket_id ?? "")}`,
          source_table: "ticket_refund_advance",
          source_id: row.id,
          created_by: userId,
          received_by: userId,
        } as never);
        if (advErr) throw advErr;
      }

      toast.success(`রিফান্ড সম্পন্ন: ${String(row.ticket_id ?? "")}`);
      setSeeded(null);
      onClose();
      await onDone();
    } catch (e) {
      toast.error("রিফান্ড করা যায়নি: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>টিকেট ক্যানসেল ও রিফান্ড</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{String(row?.passenger_name ?? "")}</span>{" "}
            ({String(row?.ticket_id ?? "")}) — এন্ট্রি ডিলেট হবে না, হিসাব রিফান্ড অনুযায়ী মিলে যাবে।
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Vendor side */}
          <div className="rounded-md border border-border p-3 space-y-2">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>Vendor: {vendor || "—"}</span>
              <span className="text-muted-foreground">Cost: {money(cost)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Vendor কত ফেরত দিল</Label>
                <Input type="number" inputMode="decimal" value={vendorRefund} onChange={(e) => onVendorRefund(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Vendor refund fee (কাটল)</Label>
                <Input type="number" inputMode="decimal" value={vendorFee} onChange={(e) => onVendorFee(e.target.value)} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              একটা লিখলেই অন্যটা অটো বসবে (যোগফল = Cost {money(cost)})।
            </p>
          </div>

          {/* Passenger side */}
          <div className="rounded-md border border-border p-3 space-y-2">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>Passenger</span>
              <span className="text-muted-foreground">পেমেন্ট করেছে: {money(received)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Passenger কে ফেরত</Label>
                <Input type="number" inputMode="decimal" value={paxRefund} onChange={(e) => onPaxRefund(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Office fee (রাখল)</Label>
                <Input type="number" inputMode="decimal" value={officeFee} onChange={(e) => onOfficeFee(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setMode("cash")}
                className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${mode === "cash" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
              >
                💵 নগদে ফেরত
              </button>
              <button
                type="button"
                onClick={() => setMode("advance")}
                className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${mode === "advance" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
              >
                📌 পরের টিকেটে Advance
              </button>
            </div>
          </div>

          {/* Net result */}
          <div className="rounded-md bg-muted/50 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">নিট অফিস লাভ/ক্ষতি</span>
              <span className={`font-semibold ${netProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {netProfit >= 0 ? "+" : "−"}{money(Math.abs(netProfit))}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              অফিস fee {money(oFeeNum)} − Vendor fee {money(vFeeNum)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">ক্যানসেল তারিখ</Label>
              <DateInput value={cDate} onChange={(e) => setCDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">কারণ (ঐচ্ছিক)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="ক্যানসেলের কারণ..." />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">পাসওয়ার্ড দিয়ে নিশ্চিত করুন</Label>
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy}>ফিরে যান</Button>
          <Button onClick={submit} disabled={busy} className="bg-amber-600 hover:bg-amber-700 text-white">
            {busy ? "প্রসেস হচ্ছে..." : "রিফান্ড নিশ্চিত করুন"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
