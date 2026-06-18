import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ReceiptDialog, type ReceiptInfo } from "@/components/ReceiptDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowRight, ArrowLeft, AlertTriangle, Wallet, Loader2, User2, Banknote, X } from "lucide-react";
import { LookupSelect } from "@/components/LookupSelect";
import { statusBadgeClass } from "@/lib/modules";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { resilientInsert, resilientUpdate, isNetworkError } from "@/lib/offline-queue";
import { generateNextId } from "@/lib/idgen";
import { speakDelivery } from "@/lib/voice";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DUE_RECEIVE_METHODS, isMdReceivedMethod, isVendorReceivedMethod } from "@/lib/payment-methods";
import { settleVendorBillByBooking } from "@/lib/vendor-settle";

const STATUS_EVENT_SOURCES = new Set(["status_event", "status_change", "status-delivery"]);

const DEFAULT_STATUS_ORDER = ["NEW", "File Process", "Card Ready", "Pending Delivery", "Delivered"];
const todayIso = () => new Date().toISOString().slice(0, 10);
const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const cleanStatusText = (text?: string | null) => String(text ?? "").replace(/^\s*status\s*:\s*/i, "").trim();

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
  recvCol: string;
  refId: string;
  serviceType: string;
  hasVendorField: boolean;
  hasVendorSentDate: boolean;
  hasReceivedDate: boolean;
  hasDeliveryDate: boolean;
  statusOrder?: string[];
  moduleKey?: string;
  anchorEl?: HTMLElement | null;
}

function idxOfIn(order: string[], s: string): number {
  return order.findIndex((x) => eq(x, s));
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
  const [costPriceInput, setCostPriceInput] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [discount, setDiscount] = useState<string>("");
  const [method, setMethod] = useState<string>("Cash");
  // Multi-method pay: split one due across several methods (only Cash hits the
  // staff balance; bKash/Bank/etc. still route to MD as before).
  const [multiMode, setMultiMode] = useState(false);
  const [methodAmts, setMethodAmts] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState<string>("");
  const [targetStatus, setTargetStatus] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptInfo | null>(null);

  const order = request?.statusOrder && request.statusOrder.length > 0
    ? request.statusOrder
    : DEFAULT_STATUS_ORDER;
  const current = String(request?.row.status ?? "") || (order[0] ?? "");
  const next = targetStatus || request?.newStatus || current;
  const idxOf = (s: string) => idxOfIn(order, s);
  const direction: "forward" | "backward" | "same" = useMemo(() => {
    if (!request) return "same";
    const a = idxOfIn(order, current);
    const b = idxOfIn(order, next);
    if (a < 0 || b < 0) return "forward";
    if (b > a) return "forward";
    if (b < a) return "backward";
    return "same";
  }, [request, current, next, order]);

  const sold = Number(request?.row.sold_price ?? 0);
  const received = Number(request?.row[request?.recvCol ?? ""] ?? 0);
  const existingDiscount = Number(request?.row.discount_amount ?? 0);
  const due = Math.max(0, sold - received - existingDiscount);
  const isDeliveredWithDue = eq(next, "Delivered") || eq(next, "DELIVERED") || eq(next, "Delivery") ? due > 0 : false;
  const isFileProcess = eq(next, "File Process");
  const isPendingDelivery = eq(next, "Pending Delivery");
  const isDeliveryButDue = eq(next, "Delivery But Due");
  const isDeliveredAny = eq(next, "Delivered") || eq(next, "DELIVERED") || eq(next, "Delivery");
  const isSame = direction === "same";

  useEffect(() => {
    if (!request) return;
    const requestOrder = request.statusOrder && request.statusOrder.length > 0
      ? request.statusOrder
      : DEFAULT_STATUS_ORDER;
    const currentStatus = String(request.row.status ?? "") || (requestOrder[0] ?? "");
    setTargetStatus(request.newStatus || currentStatus);
    setVendor(String(request.row.vendor_bought ?? ""));
    setCostPriceInput(request.row.cost_price ? String(request.row.cost_price) : "");
    setAmount("");
    setDiscount("");
    setMethod("Cash");
    setMultiMode(false);
    setMethodAmts({});
    setRemarks("");
  }, [request]);

  useEffect(() => {
    setAmount(isDeliveredWithDue ? String(due) : "");
    setDiscount("");
  }, [request, isDeliveredWithDue, due]);

  if (!request) return null;

  const forwardEffects: string[] = [];
  if (isFileProcess && request.hasVendorSentDate) forwardEffects.push("Vendor Sent Date = আজ");
  if (isFileProcess && request.hasVendorField) forwardEffects.push("Vendor সংরক্ষণ হবে");
  if (isPendingDelivery && request.hasReceivedDate) forwardEffects.push("Received Date = আজ");
  const currentIdx = idxOf(current);
  const _targetIdx = idxOf(next);
  const pdIdx = idxOf("Pending Delivery");
  const dlIdx = order.findIndex((x) => eq(x, "Delivered") || eq(x, "DELIVERED") || eq(x, "Delivery"));
  const issueIdx = order.findIndex((x) => eq(x, "ISSUE") || eq(x, "Issue"));
  // Vendor ledger checkpoint priority: Pending Delivery → ISSUE → Delivered
  // (tickets: BOOK → ISSUE [ledger] → DELIVERED; visas: ... → Pending Delivery [ledger] → ...)
  const ledgerIdx = pdIdx >= 0 ? pdIdx : issueIdx >= 0 ? issueIdx : dlIdx;
  const costPrice = Number(request.row.cost_price ?? 0);
  const vendorName = String(request.row.vendor_bought ?? "").trim();
  const fileProcessIdx = idxOf("File Process");
  const crossesIntoLedger = ledgerIdx >= 0 && direction === "forward" && currentIdx < ledgerIdx && _targetIdx >= ledgerIdx;
  const crossesOutOfLedger = ledgerIdx >= 0 && direction === "backward" && currentIdx >= ledgerIdx && _targetIdx < ledgerIdx;
  // Cost price is mandatory once the card moves forward to ANY status after "File Process".
  const requiresCostPrice = fileProcessIdx >= 0 && direction === "forward" && _targetIdx > fileProcessIdx;
  const needsCostPrice = requiresCostPrice && costPrice <= 0;
  const needsVendorForPD = crossesIntoLedger && !vendorName && request.hasVendorField;
  const effectiveCostPrice = needsCostPrice ? (Number(costPriceInput) || 0) : costPrice;
  const effectiveVendor = (needsVendorForPD ? vendor : vendorName).trim();
  if (crossesIntoLedger && effectiveCostPrice > 0 && effectiveVendor) {
    forwardEffects.push(`Vendor "${effectiveVendor}" এর খাতায় ৳${effectiveCostPrice.toLocaleString()} Credit`);
  }
  if ((isDeliveredAny || isDeliveryButDue) && request.hasDeliveryDate) forwardEffects.push("Delivery Date = আজ");
  if (isDeliveredWithDue) forwardEffects.push(`Due ৳${due.toLocaleString()} আদায় রসিদ`);
  if (isDeliveryButDue && due > 0) forwardEffects.push(`Due ৳${due.toLocaleString()} বকেয়া থাকবে`);

  const backwardClears: string[] = [];
  const targetIdx = _targetIdx;
  const fpIdx = idxOf("File Process");
  if (fpIdx >= 0 && targetIdx < fpIdx && request.hasVendorSentDate) backwardClears.push("Vendor Sent Date");
  if (pdIdx >= 0 && targetIdx < pdIdx && request.hasReceivedDate) backwardClears.push("Received Date");
  if (dlIdx >= 0 && targetIdx < dlIdx && request.hasDeliveryDate) backwardClears.push("Delivery Date");
  if (crossesOutOfLedger && costPrice > 0) backwardClears.push(`Vendor "${vendorName || "—"}" cost reverse`);
  // Full financial revert: stepping back below "Delivered" returns the row to its
  // earlier, unpaid state — received goes to 0 and ALL related receipts (incl.
  // handed-over ones) are removed so accounts match the prior status.
  const wasDeliveredLike =
    (dlIdx >= 0 && currentIdx >= dlIdx) ||
    eq(current, "Delivered") || eq(current, "DELIVERED") ||
    eq(current, "Delivery") || eq(current, "Delivery But Due");
  const revertFinancials =
    direction === "backward" && dlIdx >= 0 && targetIdx >= 0 && targetIdx < dlIdx && wasDeliveredLike;
  if (revertFinancials && received > 0) {
    backwardClears.push(`Received ৳${received.toLocaleString()} → ৳0 (সব রসিদ ফেরত)`);
  }


  const apply = async (asDeliveryButDue = false) => {
    if (isSame && !asDeliveryButDue) return;
    // "Delivery But Due" = mark delivered today but keep the outstanding due (no receive).
    const finalStatus = asDeliveryButDue ? "Delivery But Due" : next;
    const receiveDue = isDeliveredWithDue && !asDeliveryButDue;
    const markDelivered = isDeliveredAny || isDeliveryButDue || asDeliveryButDue;
    if (!user?.id && receiveDue) { toast.error("লগইন প্রয়োজন"); return; }
    if (!asDeliveryButDue && isFileProcess && request.hasVendorField && !vendor.trim()) {
      toast.error("Vendor নির্বাচন করুন"); return;
    }
    if (!asDeliveryButDue && needsCostPrice && effectiveCostPrice <= 0) {
      toast.error(`Vendor Cost Price দিন (${next} এর জন্য আবশ্যক)`); return;
    }
    if (!asDeliveryButDue && needsVendorForPD && !effectiveVendor) {
      toast.error("Vendor নির্বাচন করুন"); return;
    }
    setSaving(true);
    try {
      const patch: Record<string, unknown> = { status: finalStatus, status_by: displayName(profile, user) };
      if (direction === "forward") {
        if (isFileProcess) {
          if (request.hasVendorField) patch.vendor_bought = vendor.trim();
          if (request.hasVendorSentDate) patch.vendor_sent_date = todayIso();
        }
        if (needsCostPrice) patch.cost_price = effectiveCostPrice;
        if (crossesIntoLedger) {
          if (needsVendorForPD) {
            patch.vendor_bought = effectiveVendor;
            if (request.hasVendorSentDate && !request.row.vendor_sent_date) patch.vendor_sent_date = todayIso();
          }
        }
        if (isPendingDelivery && request.hasReceivedDate) patch.received_date = todayIso();
        if (markDelivered && request.hasDeliveryDate) patch.delivery_date = todayIso();
      } else if (direction === "backward") {
        if (fpIdx >= 0 && targetIdx < fpIdx && request.hasVendorSentDate) patch.vendor_sent_date = null;
        if (pdIdx >= 0 && targetIdx < pdIdx && request.hasReceivedDate) patch.received_date = null;
        if (dlIdx >= 0 && targetIdx < dlIdx && request.hasDeliveryDate) patch.delivery_date = null;
        if (revertFinancials) {
          // Reset money so the row matches the earlier (pre-delivery) status.
          patch[request.recvCol] = 0;
          if (request.row.discount_amount != null) patch.discount_amount = 0;
        }
      }


      let paid = 0;
      let discAmt = 0;
      let payments: { method: string; amount: number }[] = [];
      if (receiveDue) {
        discAmt = Math.max(0, Math.min(due, Number(discount) || 0));
        const maxPay = Math.max(0, due - discAmt);
        // Build (method, amount) lines — multi-mode splits across methods.
        payments = multiMode
          ? DUE_RECEIVE_METHODS
              .map((m) => ({ method: m, amount: Number(methodAmts[m]) || 0 }))
              .filter((p) => p.amount > 0)
          : (Number(amount) > 0 ? [{ method, amount: Number(amount) }] : []);
        const enteredTotal = payments.reduce((s, p) => s + p.amount, 0);
        if (enteredTotal > maxPay) {
          setSaving(false);
          toast.error(`সর্বোচ্চ ৳${maxPay.toLocaleString()} নেওয়া যাবে`);
          return;
        }
        paid = enteredTotal;
        if (paid + discAmt <= 0) { setSaving(false); toast.error("Amount বা Discount দিন"); return; }
        // Cash received only; discount is a price adjustment, NOT income.
        patch[request.recvCol] = received + paid;
        if (discAmt > 0) patch.discount_amount = existingDiscount + discAmt;
        patch.received_by = user!.id;
      }

      await resilientUpdate(request.table, { id: request.row.id }, patch);

      // Backward to a pre-delivery status → wipe every receipt tied to this row
      // (cash dues, MD-received, status events, service form) so accounts and
      // MD notifications return to the earlier state.
      if (revertFinancials) {
        try {
          // System cleanup via SECURITY DEFINER RPC so it works even when the
          // file was created by another staff member (owner-only DELETE RLS).
          const { error: revErr } = await supabase.rpc("revert_service_receipts", {
            _service_table: request.table,
            _service_row_id: request.row.id,
          });
          if (revErr) throw revErr;
        } catch (re) {
          if (!isNetworkError(re)) toast.warning("রসিদ revert failed: " + errMsg(re));
        }
      }



      let firstReceiptId = "";
      const me = displayName(profile, user);
      const mkReceiptId = async (): Promise<string> => {
        try {
          return await generateNextId({
            key: "_rcpt", label: "", short: "", table: "payment_receipts",
            idColumn: "receipt_id", idPrefix: "RCPT", monthlyId: true, fields: [],
          });
        } catch (e) {
          if (!isNetworkError(e)) throw e;
          const d = new Date();
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const yy = String(d.getFullYear()).slice(-2);
          return `RCPT-${mm}${yy}-OFFLINE-${Date.now().toString().slice(-6)}`;
        }
      };

      if (markDelivered) {
        // Notify MD ONCE per distinct status. A repeat of the SAME status (no new
        // info) does not create another event, but a genuinely new event (e.g.
        // "Delivery But Due" → "Delivered") creates a fresh notification.
        const existingStatusEvent = await supabase
          .from("payment_receipts")
          .select("id,remarks")
          .eq("service_table", request.table)
          .eq("service_row_id", request.row.id)
          .in("source", Array.from(STATUS_EVENT_SOURCES))
          .limit(20);

        const alreadySent = ((existingStatusEvent.data ?? []) as Array<{ remarks: string | null }>).some((row) =>
          eq(cleanStatusText(row.remarks), finalStatus)
        );

        if (!alreadySent) {
          const statusReceiptId = await mkReceiptId();
          await resilientInsert("payment_receipts", {
            receipt_id: statusReceiptId,
            entry_date: todayIso(),
            service_type: request.serviceType,
            service_table: request.table,
            service_row_id: request.row.id,
            ref_id: request.refId,
            passenger_name: String(request.row.passenger_name ?? ""),
            amount: 0,
            method: "Status",
            source: "status_event",
            remarks: finalStatus,
            received_by: user!.id,
            received_by_name: me,
            created_by: user!.id,
          });
        }
      }

      if (receiveDue && (paid > 0 || discAmt > 0)) {
        // Discount is a non-cash price adjustment (already applied to sold_price)
        // and must NEVER create its own payment_receipts row — otherwise it
        // inflates daily cash income. We append it to the cash receipt's remarks.
        if (paid > 0 && payments.length > 0) {
          const baseRid = await mkReceiptId();
          firstReceiptId = baseRid;
          const discNote = discAmt > 0 ? `Discount ৳${discAmt.toLocaleString()} প্রয়োগ` : "";
          const multiNote = payments.length > 1
            ? `একাধিক মেথড: ${payments.map((p) => `${p.method} ৳${p.amount.toLocaleString()}`).join(", ")}`
            : "";
          const combinedRemarks = [remarks, discNote, multiNote].filter(Boolean).join(" · ") || null;
          // One receipt per method line; only Cash hits the staff balance.
          for (let i = 0; i < payments.length; i++) {
            const p = payments[i];
            await resilientInsert("payment_receipts", {
              receipt_id: payments.length > 1 ? `${baseRid}-${i + 1}` : baseRid,
              entry_date: todayIso(),
              service_type: request.serviceType,
              service_table: request.table,
              service_row_id: request.row.id,
              ref_id: request.refId,
              passenger_name: String(request.row.passenger_name ?? ""),
              amount: p.amount, method: p.method, source: "due",
              remarks: combinedRemarks,
              received_by: user!.id,
              received_by_name: me,
            });
          }
        }
      }

      try {
        if (crossesIntoLedger && effectiveCostPrice > 0 && effectiveVendor) {
          const { data: existing } = await supabase
            .from("vendor_ledger").select("id")
            .eq("source_table", request.table).eq("source_id", request.row.id).limit(1);
          if (!existing || existing.length === 0) {
            let ledgerId: string;
            try {
              ledgerId = await generateNextId({
                key: "_vdl", label: "", short: "", table: "vendor_ledger",
                idColumn: "ledger_id", idPrefix: "VDL", monthlyId: true, fields: [],
              });
            } catch {
              const d = new Date();
              const mm = String(d.getMonth() + 1).padStart(2, "0");
              const yy = String(d.getFullYear()).slice(-2);
              ledgerId = `VDL-${mm}${yy}-OFFLINE-${Date.now().toString().slice(-6)}`;
            }
            const passport = String(request.row.passport ?? "");
            const pname = String(request.row.passenger_name ?? "");
            await resilientInsert("vendor_ledger", {
              ledger_id: ledgerId, entry_date: todayIso(),
              vendor_name: effectiveVendor, passenger_name: pname,
              passport: passport || null,
              mobile: String(request.row.mobile ?? "") || null,
              service_type: request.serviceType,
              country_route: String(request.row.country_name ?? request.row.country_route ?? "") || null,
              total_payable: effectiveCostPrice, paid_amount: 0, advance_applied: 0,
              payment_method: "Cash", source_table: request.table, source_id: request.row.id,
              remarks: `Cost for ${pname}${passport ? ` - ${passport}` : ""} (Received on ${todayIso()})`,
              created_by: user?.id ?? null,
            });
          }
        } else if (crossesOutOfLedger) {
          const { error: delErr } = await supabase.rpc("delete_vendor_ledger_by_source", {
            _source_table: request.table,
            _source_id: request.row.id,
          });
          if (delErr) throw delErr;
        }
      } catch (le) {
        if (!isNetworkError(le)) toast.warning("Vendor ledger update failed: " + errMsg(le));
      }

      // "Vendor Received" → passenger paid the vendor directly. Settle the
      // vendor's bill for this booking (after any bill creation above); the
      // staff cash balance is untouched.
      if (receiveDue) {
        const vendorPaidAmt = payments
          .filter((p) => isVendorReceivedMethod(p.method))
          .reduce((s, p) => s + p.amount, 0);
        if (vendorPaidAmt > 0) {
          await settleVendorBillByBooking(request.table, request.row.id, vendorPaidAmt, user!.id);
        }
      }

      toast.success(`Status: ${finalStatus}${request.refId ? `-${request.refId}` : ""}`, {
        meta: {
          passenger: String(request.row.passenger_name ?? "") || undefined,
          country: String(request.row.country_name ?? request.row.country_route ?? "") || undefined,
          vendor: effectiveVendor || String(request.row.vendor_bought ?? "") || undefined,
          receiptId: firstReceiptId || undefined,
        },
      } as Parameters<typeof toast.success>[1]);
      if (markDelivered) speakDelivery(String(request.row.passenger_name ?? ""));
      onApplied();
      onClose();
    } catch (e) {
      if (isNetworkError(e)) {
        toast.success("ইন্টারনেট নেই! পরিবর্তন অটো-সেভ হয়েছে।");
        onApplied(); onClose();
      } else {
        toast.error("সমস্যা: " + errMsg(e));
      }
    } finally {
      setSaving(false);
    }
  };

  const isWarn = direction === "backward";
  const row = request.row;
  const passport = String(row.passport ?? "");
  const country = String(row.country_name ?? row.country_route ?? "");
  const isTicket = request.moduleKey === "tickets";
  const airline = String(row.airline ?? "");
  const tripRoad = String(row.trip_road ?? row.route ?? row.sector ?? "");
  const flightDate = row.flight_date ? String(row.flight_date) : "";

  return (
    <>
    <ReceiptDialog
      receipt={receipt}
      open={!!receipt}
      onClose={() => { setReceipt(null); onClose(); }}
    />
    {open && !receipt && typeof document !== "undefined" && createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/35 p-2 backdrop-blur-[1px]" onClick={onClose}>
      <div
        className="relative flex max-h-[calc(100dvh-1rem)] w-[min(22rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-md border bg-popover p-2.5 pt-3 text-popover-foreground shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onClose()}
          aria-label="Close"
          className="absolute right-2 top-2 z-50 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm hover:bg-destructive hover:text-destructive-foreground hover:border-destructive focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>


        {/* Passenger meta header — name left, trip info right */}
        <div className="rounded-md border bg-muted/40 p-2 pr-10 mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <User2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{String(row.passenger_name ?? "—")}</span>
            </div>
            <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{request.refId}</div>
            {passport && <div className="text-[10px] text-muted-foreground">PP: <span className="font-mono">{passport}</span></div>}
            {country && <div className="text-[10px] text-muted-foreground truncate">{country}</div>}
          </div>
          {isTicket && (airline || tripRoad || flightDate) && (
            <div className="text-right text-[10px] leading-tight space-y-0.5 shrink-0 max-w-[45%]">
              {airline && <div>✈ <span className="font-medium text-foreground">{airline}</span></div>}
              {tripRoad && <div className="text-muted-foreground truncate">{tripRoad}</div>}
              {flightDate && <div className="text-muted-foreground">{flightDate}</div>}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-0.5 pb-2 pr-1">
          <Select value={next} onValueChange={setTargetStatus}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {order.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
            </SelectContent>
          </Select>
          <div className="flex items-center justify-center gap-1.5 rounded-md border bg-muted/40 py-1">
            <Badge variant="outline" className={`${statusBadgeClass(current)} text-[10px]`}>{current || "—"}</Badge>
            {direction === "backward"
              ? <ArrowLeft className="h-3 w-3 text-amber-500" />
              : <ArrowRight className="h-3 w-3 text-muted-foreground" />}
            <Badge variant="outline" className={`${statusBadgeClass(next)} text-[10px]`}>{next}</Badge>
          </div>

          {isWarn && (
            <Alert variant="destructive" className="border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300 [&>svg]:text-amber-500 py-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              <AlertTitle className="text-xs">পেছনের Status</AlertTitle>
              <AlertDescription className="text-[10px] mt-0.5">
                {backwardClears.length > 0
                  ? <ul className="list-disc list-inside">{backwardClears.map((c) => <li key={c}>{c}</li>)}</ul>
                  : "শুধু Status পরিবর্তন হবে"}
              </AlertDescription>
            </Alert>
          )}

          {direction === "forward" && forwardEffects.length > 0 && (
            <div className="rounded-md border bg-emerald-500/5 border-emerald-500/30 p-1.5 text-[10px]">
              <div className="font-semibold text-emerald-700 dark:text-emerald-400 mb-0.5">কী ঘটবে:</div>
              <ul className="list-disc list-inside text-foreground/80 space-y-0.5">
                {forwardEffects.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
          )}

          {next === "File Process" && request.hasVendorField && (
            <div className="space-y-1">
              <Label className="text-[10px]">Vendor <span className="text-rose-500">*</span></Label>
              <LookupSelect kind="vendor" value={vendor} onChange={setVendor} />
            </div>
          )}

          {(needsCostPrice || needsVendorForPD) && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                <Banknote className="h-3.5 w-3.5" />
                Vendor Cost Entry আবশ্যক
              </div>
              <div className="text-[10px] text-muted-foreground -mt-1">
                {next} করতে হলে আগে {needsVendorForPD ? "Vendor ও " : ""}Cost Price দিন।
              </div>
              {needsVendorForPD && (
                <div className="space-y-1">
                  <Label className="text-[10px]">Vendor <span className="text-rose-500">*</span></Label>
                  <LookupSelect kind="vendor" value={vendor} onChange={setVendor} />
                </div>
              )}
              {needsCostPrice && (
                <div className="space-y-1">
                  <Label className="text-[10px]">Cost Price (৳) <span className="text-rose-500">*</span></Label>
                  <Input
                    className="h-8 text-sm"
                    type="number"
                    inputMode="decimal"
                    value={costPriceInput}
                    onChange={(e) => setCostPriceInput(e.target.value)}
                    placeholder="0"
                    autoFocus
                  />
                  {sold > 0 && effectiveCostPrice > 0 && (
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      Profit: <span className={`font-semibold ${sold - effectiveCostPrice >= 0 ? "text-emerald-600" : "text-rose-500"}`}>৳{(sold - effectiveCostPrice).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {isDeliveredWithDue && (() => {
            const multiTotal = DUE_RECEIVE_METHODS.reduce((s, m) => s + (Number(methodAmts[m]) || 0), 0);
            const payN = multiMode ? multiTotal : (Number(amount) || 0);
            const discN = Number(discount) || 0;
            const remaining = Math.max(0, due - payN - discN);
            return (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-2 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> Due Receive</span>
                  <span className="text-[10px] text-muted-foreground font-normal">
                    Sold <span className="font-semibold text-foreground tabular-nums">৳{sold.toLocaleString()}</span>
                    {existingDiscount > 0 && <> · Discount <span className="font-semibold text-amber-600 tabular-nums">৳{existingDiscount.toLocaleString()}</span></>}
                    {" · "}Due <span className="font-semibold text-rose-500 tabular-nums">৳{due.toLocaleString()}</span>
                  </span>
                </div>

                {/* Single vs multi-method toggle */}
                <div className="flex items-center gap-1.5">
                  <Button type="button" size="sm" variant={multiMode ? "outline" : "default"}
                    className="h-7 text-[10px] flex-1" onClick={() => setMultiMode(false)}>
                    একক মেথড
                  </Button>
                  <Button type="button" size="sm" variant={multiMode ? "default" : "outline"}
                    className="h-7 text-[10px] flex-1"
                    onClick={() => {
                      setMultiMode(true);
                      setMethodAmts((prev) => (Object.keys(prev).length ? prev : { Cash: amount || "" }));
                    }}>
                    একাধিক মেথডে (Multi)
                  </Button>
                </div>

                {!multiMode ? (
                  <>
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="space-y-0.5">
                        <Label className="text-[10px]">Pay *</Label>
                        <Input className="h-8 text-sm" type="number" inputMode="decimal" value={amount}
                          onChange={(e) => setAmount(e.target.value)} placeholder="0" />
                      </div>
                      <div className="space-y-0.5">
                        <Label className="text-[10px] text-amber-600">− Discount</Label>
                        <Input className="h-8 text-sm text-amber-600" type="number" inputMode="decimal" value={discount}
                          onChange={(e) => {
                            const d = e.target.value;
                            setDiscount(d);
                            const dn = Math.max(0, Math.min(due, Number(d) || 0));
                            setAmount(String(Math.max(0, due - dn)));
                          }} placeholder="0" />
                      </div>
                      <div className="space-y-0.5">
                        <Label className="text-[10px]">Method</Label>
                        <Select value={method} onValueChange={setMethod}>
                          <SelectTrigger className="h-8 text-sm px-2"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {DUE_RECEIVE_METHODS.map((m) => (
                              <SelectItem key={m} value={m}>{m}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {isVendorReceivedMethod(method) ? (
                      <div className="rounded-md border border-sky-500/40 bg-sky-500/10 p-1.5 text-[10px] text-sky-700 dark:text-sky-300">
                        🏢 যাত্রী সরাসরি Vendor কে দিয়েছে — Vendor এর বিল পরিশোধ হবে ও Due কমবে, আপনার ব্যালেন্সে যোগ হবে না।
                      </div>
                    ) : isMdReceivedMethod(method) && (
                      <div className="rounded-md border border-sky-500/40 bg-sky-500/10 p-1.5 text-[10px] text-sky-700 dark:text-sky-300">
                        ⚠️ এই টাকা সরাসরি MD-এর কাছে যাবে — আপনার ক্যাশ ব্যালেন্সে যোগ হবে না, শুধু এন্ট্রি থাকবে ({method})।
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded-md border p-2 space-y-1.5">
                    <p className="text-[10px] font-medium text-muted-foreground">প্রতিটি মেথডে কত টাকা জমা হলো লিখুন:</p>
                    {DUE_RECEIVE_METHODS.map((m) => (
                      <div key={m} className="flex items-center gap-1.5">
                        <Label className="w-20 shrink-0 text-[11px]">{m}</Label>
                        <Input className="h-7 text-sm" type="number" inputMode="decimal"
                          value={methodAmts[m] ?? ""}
                          onChange={(e) => setMethodAmts((prev) => ({ ...prev, [m]: e.target.value }))}
                          placeholder="0" />
                        {isMdReceivedMethod(m)
                          ? <span className="text-[9px] text-amber-600 dark:text-amber-400 whitespace-nowrap w-12">→ MD</span>
                          : <span className="text-[9px] text-emerald-600 whitespace-nowrap w-12">→ ব্যালেন্স</span>}
                      </div>
                    ))}
                    <div className="flex items-center justify-between border-t pt-1.5 text-[11px]">
                      <span className="font-medium">মোট জমা</span>
                      <span className="font-bold tabular-nums text-emerald-600">৳{multiTotal.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <Label className="w-20 shrink-0 text-[11px] text-amber-600">− Discount</Label>
                      <Input className="h-7 text-sm text-amber-600" type="number" inputMode="decimal" value={discount}
                        onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
                    </div>
                    <p className="text-[9px] text-muted-foreground">শুধু Cash আপনার ক্যাশ ব্যালেন্সে যোগ হবে; বাকিগুলো (bKash, Bank ইত্যাদি) আগের মতোই MD-এর কাছে যাবে।</p>
                  </div>
                )}
                {(payN > 0 || discN > 0) && (
                  <div className="text-[10px] flex justify-between items-center px-1 tabular-nums">
                    <span className="text-muted-foreground">
                      ৳{due.toLocaleString()} − ৳{payN.toLocaleString()}
                      {discN > 0 && <> − <span className="text-amber-600">৳{discN.toLocaleString()}</span></>}
                    </span>
                    <span>বাকি: <span className={`font-semibold ${remaining > 0 ? "text-rose-500" : "text-emerald-600"}`}>৳{remaining.toLocaleString()}</span></span>
                  </div>
                )}
                <Textarea className="text-xs" rows={1} value={remarks}
                  onChange={(e) => setRemarks(e.target.value)} placeholder="Remarks (optional)" />
              </div>
            );
          })()}


          {isDeliveredAny && due === 0 && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-[11px]">
              ✅ বকেয়া নেই — Delivered হবে
            </div>
          )}

        </div>

          <div className="shrink-0 -mx-0.5 flex gap-2 border-t bg-popover px-0.5 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-2">
            {isDeliveredWithDue ? (
              <Button
                variant="outline"
                size="sm"
                className="flex-1 border-yellow-500/60 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/10"
                onClick={() => apply(true)}
                disabled={saving}
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Delivery But Due
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="flex-1" onClick={onClose} disabled={saving}>বাতিল</Button>
            )}
            <Button size="sm" className={`flex-1 ${isWarn ? "bg-amber-600 hover:bg-amber-700 text-white" : isDeliveredWithDue ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}`}
              onClick={() => apply(false)}
              disabled={saving || isSame}
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isSame ? "একই Status" : isDeliveredWithDue ? "Receive & Deliver" : isWarn ? "Revert" : "Confirm"}
            </Button>
          </div>
      </div>
      </div>,
      document.body,
    )}
    </>
  );
}
