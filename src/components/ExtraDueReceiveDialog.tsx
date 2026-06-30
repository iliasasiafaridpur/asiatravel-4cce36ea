import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Wallet } from "lucide-react";
import { toast } from "sonner";
import { notify } from "@/lib/notify";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { generateNextId } from "@/lib/idgen";
import { resilientInsert, resilientUpdate, isNetworkError } from "@/lib/offline-queue";
import { DUE_RECEIVE_METHODS, isMdReceivedMethod, isVendorReceivedMethod } from "@/lib/payment-methods";
import { settleVendorBillByBooking } from "@/lib/vendor-settle";

const todayIso = () => new Date().toISOString().slice(0, 10);

export interface ExtraDuePreselect {
  /** parent service table — e.g. "tickets" / "bmet_cards" / ... */
  sourceTable: string;
  /** parent row uuid */
  sourceId: string;
  /** parent human ref id (for the receipt) */
  refId: string;
  /** passenger name (for the header / receipt) */
  passenger: string;
}

interface ExtraRow {
  id: string;
  service_name: string;
  service_price: number;
  vendor_cost: number;
  received_amount: number;
  discount_amount: number;
  passport: string | null;
  mobile: string | null;
  /** local edit fields */
  payAmount: string;
  payDiscount: string;
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    return String(o.message ?? o.details ?? o.hint ?? JSON.stringify(o));
  }
  return String(e);
}

export function ExtraDueReceiveDialog({
  open,
  onOpenChange,
  preselect,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  preselect?: ExtraDuePreselect | null;
  onDone?: () => void;
}) {
  const { user, profile } = useCurrentUser();
  const [rows, setRows] = useState<ExtraRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [method, setMethod] = useState("Cash");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !preselect) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase
          .from("extra_services" as never)
          .select("id,service_name,service_price,vendor_cost,received_amount,discount_amount,passport,mobile")
          .eq("source_table", preselect.sourceTable)
          .eq("source_id", preselect.sourceId)
          .order("created_at", { ascending: true });
        if (cancelled) return;
        const list = ((data as unknown) as Record<string, unknown>[] | null) ?? [];
        const mapped: ExtraRow[] = list.map((r) => {
          const price = Number(r.service_price ?? 0);
          const recv = Number(r.received_amount ?? 0);
          const disc = Number(r.discount_amount ?? 0);
          const due = Math.max(0, price - recv - disc);
          return {
            id: String(r.id),
            service_name: String(r.service_name ?? "Extra Service"),
            service_price: price,
            vendor_cost: Number(r.vendor_cost ?? 0),
            received_amount: recv,
            discount_amount: disc,
            passport: r.passport ? String(r.passport) : null,
            mobile: r.mobile ? String(r.mobile) : null,
            payAmount: due > 0 ? String(due) : "",
            payDiscount: "",
          };
        });
        setRows(mapped);
        setMethod("Cash");
        setRemarks("");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, preselect?.sourceTable, preselect?.sourceId]);

  const totals = useMemo(() => {
    let due = 0, pay = 0, disc = 0;
    for (const r of rows) {
      const d = Math.max(0, r.service_price - r.received_amount - r.discount_amount);
      due += d;
      pay += Number(r.payAmount) || 0;
      disc += Number(r.payDiscount) || 0;
    }
    return { due, pay, disc };
  }, [rows]);

  const setField = (id: string, key: "payAmount" | "payDiscount", value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
  };

  const handleClose = (v: boolean) => {
    onOpenChange(v);
    if (!v) { setRows([]); setRemarks(""); }
  };

  const submit = async () => {
    if (!preselect) return;
    if (!user?.id) return toast.error("লগইন প্রয়োজন");
    const toApply = rows
      .map((r) => {
        const remainingDue = Math.max(0, r.service_price - r.received_amount - r.discount_amount);
        const disc = Math.max(0, Math.min(remainingDue, Number(r.payDiscount) || 0));
        const amt = Math.max(0, Math.min(remainingDue - disc, Number(r.payAmount) || 0));
        return { r, amt, disc };
      })
      .filter((x) => x.amt > 0 || x.disc > 0);

    if (!toApply.length) return toast.error("সঠিক টাকার পরিমাণ অথবা ডিসকাউন্ট দিন");

    setSaving(true);
    try {
      const me = displayName(profile, user);
      const today = todayIso();
      let totalCash = 0;
      let offline = false;

      for (const { r, amt, disc } of toApply) {
        // 1) update the extra_services row (source of truth; trigger mirrors to ledger)
        const updRes = await resilientUpdate(
          "extra_services",
          { id: r.id },
          {
            received_amount: r.received_amount + amt,
            discount_amount: r.discount_amount + disc,
            received_by: user.id,
          },
        );
        if (updRes.offline) offline = true;

        // 2) record a cash receipt (only when actual cash received)
        if (amt > 0) {
          totalCash += amt;
          let receiptId: string;
          try {
            receiptId = await generateNextId({
              key: "_rcpt", label: "", short: "", table: "payment_receipts",
              idColumn: "receipt_id", idPrefix: "RCPT", monthlyId: true, fields: [],
            });
          } catch (e) {
            if (!isNetworkError(e)) throw e;
            const d = new Date();
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const yy = String(d.getFullYear()).slice(-2);
            receiptId = `RCPT-${mm}${yy}-OFFLINE-${Date.now().toString().slice(-6)}`;
          }
          const remarkParts: string[] = [`✨ Extra: ${r.service_name}`];
          if (remarks) remarkParts.push(remarks);
          if (disc > 0) remarkParts.push(`Discount ৳${disc.toLocaleString()}`);
          const insRes = await resilientInsert("payment_receipts", {
            receipt_id: receiptId,
            entry_date: today,
            service_type: `✨ ${r.service_name || "Extra Service"}`,
            service_table: "extra_services",
            service_row_id: r.id,
            ref_id: preselect.refId,
            passenger_name: preselect.passenger,
            amount: amt,
            method,
            source: "extra_due",
            remarks: remarkParts.join(" · "),
            received_by: user.id,
            received_by_name: me,
          });
          if (insRes.offline) offline = true;

          // "Vendor Received" → passenger paid the vendor directly; settle the
          // extra service's vendor bill without touching the staff balance.
          if (isVendorReceivedMethod(method)) {
            await settleVendorBillByBooking("extra_services", r.id, amt, user.id, today);
          }
        }
      }

      if (!offline) {
        notify.success(`✓ Extra Due Received: ৳${totalCash.toLocaleString()}`, {
          meta: {
            service: "Extra Service Receipt",
            passenger: preselect.passenger,
            refId: preselect.refId,
            amount: totalCash,
          },
        });
      } else {
        toast.success("ইন্টারনেট নেই! ডাটা অটো-সেভ হয়েছে।", { duration: 4000 });
      }

      onDone?.();
      handleClose(false);
    } catch (e) {
      if (isNetworkError(e)) {
        toast.success("ইন্টারনেট নেই! ডাটা অটো-সেভ হয়েছে।", { duration: 4000 });
        onDone?.();
        handleClose(false);
      } else {
        toast.error("সমস্যা: " + errMsg(e));
      }
    } finally {
      setSaving(false);
    }
  };

  const fmt = (n: number) => n.toLocaleString();

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-fuchsia-600 dark:text-fuchsia-400">
            <Sparkles className="h-5 w-5" />
            Extra Due Receive{preselect ? ` — ${preselect.passenger}` : ""}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-6">লোড হচ্ছে…</p>
        ) : totals.due <= 0 ? (
          <p className="text-sm text-emerald-600 text-center py-6">✓ কোনো Extra বকেয়া নেই</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              {rows.map((r) => {
                const remainingDue = Math.max(0, r.service_price - r.received_amount - r.discount_amount);
                return (
                  <Card key={r.id} className={remainingDue <= 0 ? "opacity-60" : ""}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm">✨ {r.service_name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          Bill ৳{fmt(r.service_price)} · Recv ৳{fmt(r.received_amount)}
                        </span>
                      </div>
                      {remainingDue <= 0 ? (
                        <p className="text-xs text-emerald-600 font-semibold">✓ পরিশোধিত</p>
                      ) : (
                        <>
                          <p className="text-xs text-rose-500 font-semibold tabular-nums">Due: ৳{fmt(remainingDue)}</p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-[11px]">Amount</Label>
                              <Input
                                type="number" inputMode="decimal" min={0}
                                value={r.payAmount}
                                onChange={(e) => setField(r.id, "payAmount", e.target.value)}
                                className="mt-1 h-9"
                              />
                            </div>
                            <div>
                              <Label className="text-[11px]">Discount</Label>
                              <Input
                                type="number" inputMode="decimal" min={0}
                                value={r.payDiscount}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  const d = Math.max(0, Math.min(remainingDue, Number(v) || 0));
                                  setRows((prev) => prev.map((x) => {
                                    if (x.id !== r.id) return x;
                                    // Only auto-fill "pay the rest" when the user
                                    // hasn't manually customized the amount — i.e.
                                    // it still equals the prior full-minus-discount
                                    // value. Otherwise keep their partial entry so
                                    // typing a discount can't inflate the payment.
                                    const prevD = Math.max(0, Math.min(remainingDue, Number(x.payDiscount) || 0));
                                    const prevFull = String(Math.max(0, remainingDue - prevD));
                                    const customized = x.payAmount !== "" && x.payAmount !== prevFull;
                                    return {
                                      ...x,
                                      payDiscount: v,
                                      payAmount: customized ? x.payAmount : String(Math.max(0, remainingDue - d)),
                                    };
                                  }));
                                }}
                                className="mt-1 h-9"
                                placeholder="0"
                              />
                            </div>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <div>
              <Label>Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DUE_RECEIVE_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isVendorReceivedMethod(method) ? (
                <p className="mt-1.5 text-[11px] leading-snug text-sky-600 dark:text-sky-400">
                  🏢 যাত্রী সরাসরি Vendor কে দিয়েছে — Vendor এর বিল পরিশোধ হবে ও Due কমবে, আপনার ব্যালেন্সে যোগ হবে না।
                </p>
              ) : isMdReceivedMethod(method) && (
                <p className="mt-1.5 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
                  ⚠️ এই টাকা সরাসরি MD-এর কাছে যাবে — আপনার ক্যাশ ব্যালেন্সে যোগ হবে না ({method})।
                </p>
              )}
            </div>

            <div>
              <Label>Remarks</Label>
              <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className="mt-1.5" placeholder="মন্তব্য (ঐচ্ছিক)" />
            </div>

            <div className="text-xs text-muted-foreground tabular-nums">
              মোট Extra Due: ৳{fmt(totals.due)} · এখন জমা: ৳{fmt(totals.pay)}
              {totals.disc > 0 ? ` · Discount: ৳${fmt(totals.disc)}` : ""}
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={() => handleClose(false)}>বাতিল</Button>
              <Button
                onClick={submit}
                disabled={saving}
                className="gap-2 bg-fuchsia-600 hover:bg-fuchsia-700 text-white"
              >
                <Wallet className="h-4 w-4" />
                {saving ? "সেভ হচ্ছে…" : "Extra Due Receive করুন"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
