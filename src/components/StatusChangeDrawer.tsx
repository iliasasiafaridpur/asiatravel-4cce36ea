import { useEffect, useMemo, useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowRight, ArrowLeft, AlertTriangle, CheckCircle2, Wallet, Loader2 } from "lucide-react";
import { LookupSelect } from "@/components/LookupSelect";
import { statusBadgeClass } from "@/lib/modules";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { resilientInsert, resilientUpdate, isNetworkError } from "@/lib/offline-queue";
import { generateNextId } from "@/lib/idgen";
import { speakDelivery } from "@/lib/voice";
import { toast } from "sonner";

const STATUS_ORDER = ["NEW", "File Process", "Card Ready", "Pending Delivery", "Delivered"];
const todayIso = () => new Date().toISOString().slice(0, 10);

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    return String(o.message ?? o.details ?? o.hint ?? JSON.stringify(o));
  }
  return String(e);
}

export interface StatusChangeRequest {
  row: Record<string, unknown> & { id: string };
  newStatus: string;
  table: string;
  /** Column on row that stores the received amount. */
  recvCol: string;
  /** Human-readable ref id (e.g. BMT-1124-001). */
  refId: string;
  /** Service type label for receipts (e.g. "BMET Card"). */
  serviceType: string;
  hasVendorField: boolean;
  hasVendorSentDate: boolean;
  hasReceivedDate: boolean;
  hasDeliveryDate: boolean;
}

function idxOf(s: string): number {
  const i = STATUS_ORDER.indexOf(s);
  return i < 0 ? 0 : i;
}

export function StatusChangeDrawer({
  request,
  onClose,
  onApplied,
}: {
  request: StatusChangeRequest | null;
  onClose: () => void;
  onApplied: () => void;
}) {
  const { user, profile } = useCurrentUser();
  const open = !!request;

  const [vendor, setVendor] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [method, setMethod] = useState<string>("Cash");
  const [remarks, setRemarks] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const current = String(request?.row.status ?? "");
  const next = request?.newStatus ?? "";
  const direction: "forward" | "backward" | "same" = useMemo(() => {
    if (!request) return "same";
    const a = idxOf(current);
    const b = idxOf(next);
    if (b > a) return "forward";
    if (b < a) return "backward";
    return "same";
  }, [request, current, next]);

  const sold = Number(request?.row.sold_price ?? 0);
  const received = Number(request?.row[request?.recvCol ?? ""] ?? 0);
  const due = Math.max(0, sold - received);
  const isDeliveredWithDue = next === "Delivered" && due > 0;

  useEffect(() => {
    if (!request) return;
    setVendor(String(request.row.vendor_bought ?? ""));
    setAmount(isDeliveredWithDue ? String(due) : "");
    setMethod("Cash");
    setRemarks("");
  }, [request, isDeliveredWithDue, due]);

  if (!request) return null;

  // Compute the list of side-effects for the change (for messaging).
  const forwardEffects: string[] = [];
  if (next === "File Process" && request.hasVendorSentDate) {
    forwardEffects.push("Vendor Sent Date = আজকের তারিখ সেট হবে।");
  }
  if (next === "File Process" && request.hasVendorField) {
    forwardEffects.push("নির্বাচিত Vendor রেকর্ডে সংরক্ষণ হবে।");
  }
  if (next === "Pending Delivery" && request.hasReceivedDate) {
    forwardEffects.push("Received Date (Vendor থেকে) = আজকের তারিখ সেট হবে।");
  }
  if (next === "Delivered" && request.hasDeliveryDate) {
    forwardEffects.push("Delivery Date = আজকের তারিখ সেট হবে।");
  }
  if (isDeliveredWithDue) {
    forwardEffects.push(`বকেয়া ৳${due.toLocaleString()} আদায়ের রসিদ তৈরি হবে।`);
  }

  // Backward fields to clear / recalc
  const backwardClears: string[] = [];
  const targetIdx = idxOf(next);
  if (targetIdx < idxOf("File Process") && request.hasVendorSentDate) backwardClears.push("Vendor Sent Date");
  if (targetIdx < idxOf("Pending Delivery") && request.hasReceivedDate) backwardClears.push("Received Date");
  if (targetIdx < idxOf("Delivered") && request.hasDeliveryDate) backwardClears.push("Delivery Date");

  const apply = async () => {
    if (!user?.id && isDeliveredWithDue) {
      toast.error("লগইন প্রয়োজন");
      return;
    }
    if (next === "File Process" && request.hasVendorField && !vendor.trim()) {
      toast.error("Vendor নির্বাচন করুন");
      return;
    }

    setSaving(true);
    try {
      const patch: Record<string, unknown> = { status: next };

      if (direction === "forward") {
        if (next === "File Process") {
          if (request.hasVendorField) patch.vendor_bought = vendor.trim();
          if (request.hasVendorSentDate) patch.vendor_sent_date = todayIso();
        }
        if (next === "Pending Delivery" && request.hasReceivedDate) {
          patch.received_date = todayIso();
        }
        if (next === "Delivered" && request.hasDeliveryDate) {
          patch.delivery_date = todayIso();
        }
      } else if (direction === "backward") {
        if (targetIdx < idxOf("File Process") && request.hasVendorSentDate) patch.vendor_sent_date = null;
        if (targetIdx < idxOf("Pending Delivery") && request.hasReceivedDate) patch.received_date = null;
        if (targetIdx < idxOf("Delivered") && request.hasDeliveryDate) patch.delivery_date = null;
      }

      // Handle Delivered with due → payment receipt
      let paid = 0;
      if (isDeliveredWithDue) {
        paid = Math.max(0, Math.min(due, Number(amount) || 0));
        if (paid <= 0) {
          setSaving(false);
          toast.error("সঠিক টাকার পরিমাণ দিন");
          return;
        }
        patch[request.recvCol] = received + paid;
        patch.received_by = user!.id;
      }

      await resilientUpdate(request.table, { id: request.row.id }, patch);

      if (isDeliveredWithDue && paid > 0) {
        const me = displayName(profile, user);
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
        await resilientInsert("payment_receipts", {
          receipt_id: receiptId,
          entry_date: todayIso(),
          service_type: request.serviceType,
          service_table: request.table,
          service_row_id: request.row.id,
          ref_id: request.refId,
          passenger_name: String(request.row.passenger_name ?? ""),
          amount: paid,
          method,
          source: "due",
          remarks: remarks || null,
          received_by: user!.id,
          received_by_name: me,
        });
      }

      toast.success(`Status: ${next}`);
      if (next === "Delivered") speakDelivery(String(request.row.passenger_name ?? ""));
      onApplied();
      onClose();
    } catch (e) {
      if (isNetworkError(e)) {
        toast.success("ইন্টারনেট নেই! পরিবর্তন অটো-সেভ হয়েছে।");
        onApplied();
        onClose();
      } else {
        toast.error("সমস্যা: " + errMsg(e));
      }
    } finally {
      setSaving(false);
    }
  };

  const isWarn = direction === "backward";

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {isWarn ? <AlertTriangle className="h-5 w-5 text-amber-500" /> : <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
            Status পরিবর্তন
          </SheetTitle>
          <SheetDescription>
            {String(request.row.passenger_name ?? "")} · {request.refId}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Status transition visual */}
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3">
            <Badge variant="outline" className={statusBadgeClass(current)}>{current || "—"}</Badge>
            {direction === "backward"
              ? <ArrowLeft className="h-4 w-4 text-amber-500" />
              : <ArrowRight className="h-4 w-4 text-muted-foreground" />}
            <Badge variant="outline" className={statusBadgeClass(next)}>{next}</Badge>
          </div>

          {/* Backward warning */}
          {isWarn && (
            <Alert variant="destructive" className="border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300 [&>svg]:text-amber-500">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Warning: পেছনের Status-এ যাচ্ছেন</AlertTitle>
              <AlertDescription className="space-y-1 mt-1">
                <p>Confirming this will reset the following date fields:</p>
                {backwardClears.length > 0 ? (
                  <ul className="list-disc list-inside text-sm font-medium">
                    {backwardClears.map((c) => <li key={c}>{c} (cleared)</li>)}
                  </ul>
                ) : (
                  <p className="text-sm">কোনো তারিখ ক্লিয়ার হবে না, শুধু Status পরিবর্তন হবে।</p>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Forward effects */}
          {direction === "forward" && forwardEffects.length > 0 && (
            <div className="rounded-md border bg-emerald-500/5 border-emerald-500/30 p-3 text-sm space-y-1">
              <div className="font-semibold text-emerald-700 dark:text-emerald-400">কী ঘটবে:</div>
              <ul className="list-disc list-inside text-foreground/80">
                {forwardEffects.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
          )}

          {/* Vendor select for File Process */}
          {next === "File Process" && request.hasVendorField && (
            <div className="space-y-1.5">
              <Label>Vendor (যাকে File পাঠাচ্ছেন) <span className="text-rose-500">*</span></Label>
              <LookupSelect kind="vendor" value={vendor} onChange={setVendor} />
            </div>
          )}

          {/* Embedded Due Receive form for Delivered with due */}
          {isDeliveredWithDue && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Wallet className="h-4 w-4" /> Due Receive — Payment নিন
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded bg-background p-2">
                  <div className="text-muted-foreground">Sold</div>
                  <div className="font-semibold tabular-nums">৳{sold.toLocaleString()}</div>
                </div>
                <div className="rounded bg-background p-2">
                  <div className="text-muted-foreground">Received</div>
                  <div className="font-semibold tabular-nums text-emerald-600">৳{received.toLocaleString()}</div>
                </div>
                <div className="rounded bg-background p-2">
                  <div className="text-muted-foreground">Due</div>
                  <div className="font-semibold tabular-nums text-rose-500">৳{due.toLocaleString()}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Amount <span className="text-rose-500">*</span></Label>
                  <Input
                    type="number" inputMode="decimal" value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Payment Method</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Cash">Cash</SelectItem>
                      <SelectItem value="Bank">Bank</SelectItem>
                      <SelectItem value="bKash">bKash</SelectItem>
                      <SelectItem value="Nagad">Nagad</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Remarks</Label>
                <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="optional" />
              </div>
            </div>
          )}

          {/* Delivered with no due → simple confirmation note */}
          {next === "Delivered" && due === 0 && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
              ✅ বকেয়া নেই — Status "Delivered" হবে ও Delivery Date আজকের তারিখ সেট হবে।
            </div>
          )}
        </div>

        <SheetFooter className="mt-6 flex flex-row gap-2 sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={saving}>বাতিল</Button>
          <Button
            onClick={apply}
            disabled={saving}
            className={isWarn
              ? "bg-amber-600 hover:bg-amber-700 text-white"
              : isDeliveredWithDue
                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                : ""}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isDeliveredWithDue
              ? "Receive Payment & Confirm Delivery"
              : isWarn
                ? "Yes, Revert Status"
                : "Confirm Action"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
