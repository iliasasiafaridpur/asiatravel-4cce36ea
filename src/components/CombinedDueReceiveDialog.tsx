import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { generateNextId } from "@/lib/idgen";
import { resilientInsert, resilientUpdate } from "@/lib/offline-queue";
import { DUE_RECEIVE_METHODS, isVendorReceivedMethod } from "@/lib/payment-methods";
import { settleVendorBillByBooking } from "@/lib/vendor-settle";
import { Wallet } from "lucide-react";
import { toast } from "sonner";

const CONFIG = {
  tickets: { table: "tickets", idCol: "ticket_id", recvCol: "received", type: "Ticket", hasDelivery: false, delivered: "DELIVERED", dueDelivered: "DELIVERED" },
  bmet: { table: "bmet_cards", idCol: "bmet_id", recvCol: "received_amount", type: "BMET Card", hasDelivery: true, delivered: "Delivered", dueDelivered: "Delivery But Due" },
  "saudi-visa": { table: "saudi_visas", idCol: "saudi_id", recvCol: "received_amount", type: "Saudi Visa", hasDelivery: true, delivered: "Delivered", dueDelivered: "Delivered" },
  "kuwait-visa": { table: "kuwait_visas", idCol: "kuwait_id", recvCol: "received", type: "Kuwait Visa", hasDelivery: true, delivered: "Delivered", dueDelivered: "Delivered" },
  other: { table: "others", idCol: "other_id", recvCol: "received_amount", type: "Other", hasDelivery: true, delivered: "Delivery", dueDelivered: "Delivery" },
} as const;

export type CombinedDuePreselect = { serviceKey: keyof typeof CONFIG; rowId: string };
type PayLine = {
  id: string;
  kind: "main" | "extra";
  label: string;
  bill: number;
  received: number;
  discount: number;
  due: number;
  amount: string;
  newDiscount: string;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export function CombinedDueReceiveDialog({ open, onOpenChange, preselect, onDone }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselect: CombinedDuePreselect | null;
  onDone?: () => void;
}) {
  const { user, profile } = useCurrentUser();
  const [lines, setLines] = useState<PayLine[]>([]);
  const [parent, setParent] = useState<Record<string, unknown> | null>(null);
  const [method, setMethod] = useState("Cash");
  const [multiMode, setMultiMode] = useState(false);
  const [methodAmounts, setMethodAmounts] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState("");
  const [withDelivery, setWithDelivery] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !preselect) return;
    let cancelled = false;
    const cfg = CONFIG[preselect.serviceKey];
    void (async () => {
      setLoading(true);
      const mainColumns = ["id", cfg.idCol, "passenger_name", "passport", "mobile", "agency_sold", "sold_price", cfg.recvCol, "discount_amount", "status"];
      if (cfg.hasDelivery) mainColumns.push("delivery_date");
      const [mainRes, extraRes] = await Promise.all([
        supabase.from(cfg.table as never).select(mainColumns.join(",")).eq("id", preselect.rowId).maybeSingle(),
        supabase.from("extra_services" as never).select("id,service_name,service_price,received_amount,discount_amount").eq("source_table", cfg.table).eq("source_id", preselect.rowId).order("created_at", { ascending: true }),
      ]);
      if (cancelled) return;
      const p = mainRes.data as unknown as Record<string, unknown> | null;
      if (!p) { setLoading(false); return; }
      const mainBill = Number(p.sold_price ?? 0);
      const mainRecv = Number(p[cfg.recvCol] ?? 0);
      const mainDisc = Number(p.discount_amount ?? 0);
      const mainDue = Math.max(0, mainBill - mainRecv - mainDisc);
      const next: PayLine[] = [{
        id: String(p.id), kind: "main", label: `${cfg.type} ${String(p[cfg.idCol] ?? "")}`,
        bill: mainBill, received: mainRecv, discount: mainDisc, due: mainDue,
        amount: mainDue > 0 ? String(mainDue) : "", newDiscount: "",
      }];
      for (const raw of ((extraRes.data as unknown as Record<string, unknown>[] | null) ?? [])) {
        const bill = Number(raw.service_price ?? 0);
        const received = Number(raw.received_amount ?? 0);
        const discount = Number(raw.discount_amount ?? 0);
        const due = Math.max(0, bill - received - discount);
        next.push({ id: String(raw.id), kind: "extra", label: `Extra Service — ${String(raw.service_name || "Extra Service")}`, bill, received, discount, due, amount: due > 0 ? String(due) : "", newDiscount: "" });
      }
      setParent(p);
      setLines(next);
      setMethod("Cash");
      setMultiMode(false);
      setMethodAmounts({});
      setRemarks("");
      setWithDelivery(false);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, preselect?.serviceKey, preselect?.rowId]);

  const totalDue = useMemo(() => lines.reduce((sum, line) => sum + line.due, 0), [lines]);
  const entered = useMemo(() => lines.reduce((sum, line) => sum + (Number(line.amount) || 0) + (Number(line.newDiscount) || 0), 0), [lines]);
  const enteredPayment = useMemo(() => lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0), [lines]);
  const methodTotal = multiMode ? DUE_RECEIVE_METHODS.reduce((sum, item) => sum + (Number(methodAmounts[item]) || 0), 0) : enteredPayment;
  const updateLine = (id: string, field: "amount" | "newDiscount", value: string) => setLines((prev) => prev.map((line) => line.id === id ? { ...line, [field]: value } : line));

  const submit = async () => {
    if (!preselect || !parent || !user?.id) return;
    const cfg = CONFIG[preselect.serviceKey];
    const applies = lines.map((line) => {
      const discount = Math.max(0, Math.min(line.due, Number(line.newDiscount) || 0));
      const amount = Math.max(0, Math.min(line.due - discount, Number(line.amount) || 0));
      return { line, amount, discount };
    }).filter((item) => item.amount > 0 || item.discount > 0);
    if (!applies.length) return toast.error("প্রতিটি বিলের জন্য সঠিক টাকা অথবা discount লিখুন");
    if (multiMode && Math.abs(methodTotal - enteredPayment) > 0.005) return toast.error("Payment-এর মোট এবং Method breakdown-এর মোট সমান হতে হবে");
    setSaving(true);
    try {
      const today = todayIso();
      const baseReceiptId = await generateNextId({ key: "_rcpt", label: "", short: "", table: "payment_receipts", idColumn: "receipt_id", idPrefix: "RCPT", monthlyId: true, fields: [] });
      const combinedToken = `combined:${cfg.table}:${String(parent.id)}:${baseReceiptId}`;
      let receiptIndex = 0;
      const remainingByMethod = new Map(DUE_RECEIVE_METHODS.map((item) => [item, multiMode ? Number(methodAmounts[item]) || 0 : (item === method ? enteredPayment : 0)]));
      for (const { line, amount, discount } of applies) {
        if (line.kind === "main") {
          const patch: Record<string, unknown> = {
            [cfg.recvCol]: line.received + amount,
            discount_amount: line.discount + discount,
            received_by: user.id,
            ...(amount > 0 ? { payment_date: today } : {}),
          };
          if (withDelivery) {
            if (cfg.hasDelivery) patch.delivery_date = today;
            patch.status = line.due - amount - discount > 0 ? cfg.dueDelivered : cfg.delivered;
          }
          await resilientUpdate(cfg.table, { id: line.id }, patch);
        } else {
          await resilientUpdate("extra_services", { id: line.id }, {
            received_amount: line.received + amount,
            discount_amount: line.discount + discount,
            received_by: user.id,
            payment_method: method,
            ...(amount > 0 ? { payment_date: today } : {}),
          });
        }
        if (amount > 0) {
          let lineRemaining = amount;
          for (const paymentMethod of DUE_RECEIVE_METHODS) {
            const available = remainingByMethod.get(paymentMethod) ?? 0;
            const part = Math.min(lineRemaining, available);
            if (part <= 0) continue;
            receiptIndex += 1;
            await resilientInsert("payment_receipts", {
            receipt_id: `${baseReceiptId}-${receiptIndex}`,
            entry_date: today,
            service_type: line.kind === "main" ? cfg.type : `✨ ${line.label.replace(/^Extra Service — /, "")}`,
            service_table: line.kind === "main" ? cfg.table : "extra_services",
            service_row_id: line.id,
            ref_id: String(parent[cfg.idCol] ?? ""),
            passenger_name: String(parent.passenger_name ?? ""),
            amount: part,
            method: paymentMethod,
            source: line.kind === "main" ? "due" : "extra_due",
            remarks: [combinedToken, remarks, discount > 0 ? `Discount ৳${discount.toLocaleString()}` : ""].filter(Boolean).join(" · "),
            received_by: user.id,
            received_by_name: displayName(profile, user),
            });
            if (isVendorReceivedMethod(paymentMethod)) {
              await settleVendorBillByBooking(line.kind === "main" ? cfg.table : "extra_services", line.id, part, user.id, today);
            }
            remainingByMethod.set(paymentMethod, available - part);
            lineRemaining -= part;
            if (lineRemaining <= 0.005) break;
          }
        }
      }
      toast.success("মোট Due-এর পেমেন্ট সংরক্ষিত হয়েছে");
      onDone?.();
      onOpenChange(false);
    } catch (error) {
      toast.error("পেমেন্ট সংরক্ষণ হয়নি: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Wallet className="h-5 w-5" /> মোট Due Receive</DialogTitle></DialogHeader>
        {loading ? <p className="py-8 text-center text-sm text-muted-foreground">লোড হচ্ছে…</p> : (
          <div className="space-y-4">
            <div className="rounded-md border overflow-hidden">
              {lines.map((line) => (
                <div key={line.id} className="grid grid-cols-1 sm:grid-cols-[1fr_125px_125px] gap-2 border-b last:border-b-0 p-3">
                  <div><div className="font-semibold text-sm">{line.label}</div><div className="text-xs text-muted-foreground">Bill ৳{line.bill.toLocaleString()} · Received ৳{line.received.toLocaleString()} · Due ৳{line.due.toLocaleString()}</div></div>
                  <div><Label className="text-[11px]">Payment</Label><Input type="number" min={0} max={line.due} value={line.amount} onChange={(e) => updateLine(line.id, "amount", e.target.value)} className="h-9 mt-1" /></div>
                  <div><Label className="text-[11px]">Discount</Label><Input type="number" min={0} max={line.due} value={line.newDiscount} onChange={(e) => updateLine(line.id, "newDiscount", e.target.value)} className="h-9 mt-1" placeholder="0" /></div>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-sm font-semibold"><span>মোট Due: ৳{totalDue.toLocaleString()}</span><span className="text-emerald-600">এখন সমন্বয়: ৳{entered.toLocaleString()}</span></div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={multiMode} onCheckedChange={(value) => setMultiMode(value === true)} /> একাধিক Payment Method</label>
            {multiMode ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {DUE_RECEIVE_METHODS.map((item) => <div key={item}><Label className="text-[11px]">{item}</Label><Input type="number" min={0} value={methodAmounts[item] ?? ""} onChange={(e) => setMethodAmounts((prev) => ({ ...prev, [item]: e.target.value }))} className="h-9 mt-1" placeholder="0" /></div>)}
                <div className="col-span-2 sm:col-span-4 text-xs text-right text-muted-foreground">Method total: ৳{methodTotal.toLocaleString()} / Payment: ৳{enteredPayment.toLocaleString()}</div>
              </div>
            ) : <div><Label>Method</Label><Select value={method} onValueChange={setMethod}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent>{DUE_RECEIVE_METHODS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>}
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={withDelivery} onCheckedChange={(value) => setWithDelivery(value === true)} /> মূল সার্ভিস Delivery-সহ গ্রহণ</label>
            <div><Label>Remarks</Label><Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className="mt-1" /></div>
            <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>বাতিল</Button><Button onClick={submit} disabled={saving || entered <= 0}>{saving ? "সেভ হচ্ছে…" : "পেমেন্ট গ্রহণ করুন"}</Button></DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}