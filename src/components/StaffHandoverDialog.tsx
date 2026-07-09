import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateInput } from "@/components/ui/date-input";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useServerFn } from "@tanstack/react-start";
import { sendGmail } from "@/lib/send-email.functions";
import { toast } from "sonner";
import { Lock, AlertTriangle, TrendingUp, TrendingDown, Wallet, BookOpen, Mail } from "lucide-react";
import { HandoverLedgerBook } from "@/components/HandoverLedgerBook";
import { formatDateTime, formatDate } from "@/lib/modules";
import { isCashMethod, isMdReceivedMethod, isVendorReceivedMethod, vendorExpenseHitsUserBalance, methodLabel, DISCOUNT_LABEL } from "@/lib/payment-methods";

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => `৳ ${(n || 0).toLocaleString()}`;

type Receipt = {
  id: string; receipt_id?: string | null; amount: number;
  passenger_name?: string | null; entry_date: string; created_at?: string | null;
  service_table?: string | null; service_row_id?: string | null;
  service_type?: string | null;
  method?: string | null;
  source?: string | null;
  remarks?: string | null;
  discount?: number;
  svc?: SvcDetail;
};
type Expense = { id: string; expense_id?: string | null; amount: number; category: string; purpose?: string | null; entry_date: string; created_at?: string | null; linked_source_table?: string | null };

// Balance-neutral / non-cash vendor-ledger mirror rows (Opening Due, MD Sir
// Deposit, Vendor Received, Adjustment) never left this staff member's drawer,
// so they must be kept OUT of the cash-handover expense breakdown. Manual
// expenses (no linked_source_table) always count.
const expenseHitsBalance = (e: { category?: string | null; linked_source_table?: string | null }) =>
  e.linked_source_table === "vendor_ledger" ? vendorExpenseHitsUserBalance(e.category) : true;

const STATUS_EVENT_SOURCES = new Set(["status_event", "status_change", "status-delivery"]);
const isStatusEvent = (r: Receipt) =>
  STATUS_EVENT_SOURCES.has(String(r.source ?? "")) || String(r.method ?? "").toLowerCase() === "status";
const cleanStatusText = (text?: string | null) => String(text ?? "").replace(/^\s*status\s*:\s*/i, "").trim() || "Delivery";
const serviceKey = (r: Receipt) => r.service_table && r.service_row_id ? `${r.service_table}:${r.service_row_id}` : "";

type SvcDetail = {
  country?: string | null; route?: string | null; airline?: string | null;
  service_name?: string | null; flight_date?: string | null;
  agent?: string | null;
};

const DISCOUNT_TABLES = ["tickets", "bmet_cards", "saudi_visas", "kuwait_visas", "agency_ledger"] as const;

// Module label per service table (matches MODULES schema).
const TABLE_LABELS: Record<string, string> = {
  tickets: "AIR TICKET",
  bmet_cards: "BMET কার্ড",
  saudi_visas: "সৌদি ভিসা",
  kuwait_visas: "কুয়েত ভিসা",
  others: "Other Service",
  agency_ledger: "Agency Ledger",
};

// Columns + mapper to pull service/route info per table.
const SVC_CONFIGS: Record<string, { cols: string; map: (r: Record<string, unknown>) => SvcDetail }> = {
  tickets: {
    cols: "id,airline,trip_road,flight_date,agency_sold",
    map: (r) => ({ airline: r.airline as string, route: r.trip_road as string, flight_date: r.flight_date as string, agent: r.agency_sold as string }),
  },
  bmet_cards: {
    cols: "id,country_name,agency_sold",
    map: (r) => ({ country: r.country_name as string, agent: r.agency_sold as string }),
  },
  saudi_visas: {
    cols: "id,agency_sold",
    map: (r) => ({ country: "Saudi Arabia", agent: r.agency_sold as string }),
  },
  kuwait_visas: {
    cols: "id,agency_sold",
    map: (r) => ({ country: "Kuwait", agent: r.agency_sold as string }),
  },
  others: {
    cols: "id,service_name,airline,trip_road,flight_date,country_route,agency_sold",
    map: (r) => ({ service_name: r.service_name as string, airline: r.airline as string, route: r.trip_road as string, flight_date: r.flight_date as string, country: r.country_route as string, agent: r.agency_sold as string }),
  },
  agency_ledger: {
    cols: "id,agent_name",
    map: (r) => ({ agent: r.agent_name as string }),
  },
};

// Build the secondary line: module/service name, country, then ticket details.
function svcLine(rec: Receipt): string {
  const tbl = rec.service_table ?? "";
  const svc = rec.svc ?? {};
  const bits: string[] = [];
  const label = svc.service_name || TABLE_LABELS[tbl] || rec.service_type || "Service";
  if (label) bits.push(label);
  if (svc.country) bits.push(String(svc.country));
  if (svc.airline) bits.push(String(svc.airline));
  if (svc.route) bits.push(String(svc.route));
  if (svc.flight_date) bits.push(`✈ ${formatDate(svc.flight_date)}`);
  return bits.join(" · ");
}

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
  const [totalAgents, setTotalAgents] = useState<Set<string>>(new Set());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [cash, setCash] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [openHistory, setOpenHistory] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [mdEmail, setMdEmail] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const sendEmailFn = useServerFn(sendGmail);

  useEffect(() => {
    if (!open || !user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [r, e, md, ag] = await Promise.all([
        supabase
          .from("payment_receipts")
          .select("id,receipt_id,amount,passenger_name,entry_date,created_at,service_table,service_row_id,service_type,method,source,remarks")
          .eq("received_by", user.id)
          .eq("approval_status", "pending_md")
          .lte("entry_date", closingDate)
          .is("handover_id", null)
          .not("source", "eq", "discount")
          .not("method", "ilike", "discount")
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("cash_expenses")
          .select("id,expense_id,amount,category,purpose,entry_date,created_at,linked_source_table")
          .eq("spent_by", user.id)
          .lte("entry_date", closingDate)
          .is("handover_id", null)
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("profiles")
          .select("notify_email,role")
          .in("role", ["md", "admin"])
          .not("notify_email", "is", null),
        supabase
          .from("agents")
          .select("name")
          .eq("settle_mode", "total"),
      ]);
      if (cancelled) return;
      if (r.error) toast.error(r.error.message);
      if (e.error) toast.error(e.error.message);
      // Prefer the MD's email; fall back to an admin's email if MD has none set.
      const mdRows = ((md?.data ?? []) as Array<{ notify_email?: string; role?: string }>);
      const pick = mdRows.find((p) => p.role === "md") ?? mdRows[0];
      const foundMdEmail = (pick?.notify_email ?? "").trim();
      setMdEmail(foundMdEmail);
      setRecipientEmail((prev) => prev || foundMdEmail);
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

      // Enrich each receipt with service/route info from its underlying service row.
      const svcByTable: Record<string, Set<string>> = {};
      for (const rec of recs) {
        if (!rec.service_table || !rec.service_row_id) continue;
        if (!SVC_CONFIGS[rec.service_table]) continue;
        svcByTable[rec.service_table] ??= new Set();
        svcByTable[rec.service_table].add(rec.service_row_id);
      }
      const svcMap: Record<string, SvcDetail> = {};
      await Promise.all(
        Object.entries(svcByTable).map(async ([tbl, ids]) => {
          const cfg = SVC_CONFIGS[tbl];
          const { data } = await supabase
            .from(tbl as never)
            .select(cfg.cols)
            .in("id", Array.from(ids));
          for (const row of (data ?? []) as Array<Record<string, unknown>>) {
            svcMap[`${tbl}:${String(row.id)}`] = cfg.map(row);
          }
        })
      );
      for (const rec of recs) {
        const k = rec.service_table && rec.service_row_id ? `${rec.service_table}:${rec.service_row_id}` : "";
        rec.svc = k ? svcMap[k] : undefined;
      }

      // Total-mode agencies (হিসাব ধরন = "মোটের উপর") settle in aggregate at the
      // agency ledger — exactly like total-mode vendors. Their per-booking
      // delivery markers must NOT clutter the cash handover; only the received
      // amount (agency_ledger_payment receipt) should appear. So drop the
      // delivery/status rows whose booking belongs to a total-mode agent.
      const totalAgentSet = new Set(
        (((ag?.data ?? []) as Array<{ name?: string | null }>))
          .map((a) => String(a.name ?? "").trim())
          .filter(Boolean)
      );
      const filtered = recs.filter((rec) => {
        if (!isStatusEvent(rec)) return true;
        const agent = String(rec.svc?.agent ?? "").trim();
        return !(agent && totalAgentSet.has(agent));
      });

      setTotalAgents(totalAgentSet);
      setReceipts(filtered);
      setExpenses((((e.data ?? []) as unknown) as Expense[]).filter(expenseHitsBalance));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user?.id, closingDate]);

  const totalReceived = receipts.reduce((s, r) => s + (isCashMethod(r.method) ? Number(r.amount || 0) : 0), 0);
  const totalMdReceived = receipts.reduce((s, r) => s + (isMdReceivedMethod(r.method) ? Number(r.amount || 0) : 0), 0);
  const totalVendorReceived = receipts.reduce((s, r) => s + (isVendorReceivedMethod(r.method) ? Number(r.amount || 0) : 0), 0);
  const totalExpense = expenses.reduce((s, r) => s + Number(r.amount || 0), 0);
  // Discount is stored on the service ROW, so every receipt for that row carries
  // the same value. Count it once per service row to avoid double-counting when a
  // booking has multiple installment receipts in the same handover.
  const totalDiscount = (() => {
    const seen = new Set<string>();
    let sum = 0;
    for (const r of receipts) {
      const k = serviceKey(r);
      if (!k) { sum += Number(r.discount || 0); continue; }
      if (seen.has(k)) continue;
      seen.add(k);
      sum += Number(r.discount || 0);
    }
    return sum;
  })();
  const netCash = totalReceived - totalExpense;
  const moneyServiceKeys = new Set(
    receipts.filter((r) => !isStatusEvent(r) && Number(r.amount || 0) > 0).map(serviceKey).filter(Boolean)
  );
  const visibleReceipts = receipts.filter((r) => !(isStatusEvent(r) && moneyServiceKeys.has(serviceKey(r))));

  // মোটের উপর হিসাবের agency (যেমন Jahangir QA): প্রতিটি passenger আলাদা করে
  // receive দেখাবে না — passbook-এর মতো agency-র নামে এক লাইনে মোট received
  // দেখাবে (total bill হিসাব), ঠিক total-mode vendor-এর মতো।
  const agencyOf = (r: Receipt): string => {
    const a = String(r.svc?.agent ?? "").trim();
    if (a) return a;
    const m = String(r.service_type ?? "").match(/Receipt:\s*(.+)$/i);
    return m ? m[1].trim() : "";
  };
  const isTotalAgencyPay = (r: Receipt) =>
    String(r.source ?? "") === "agency_ledger_payment" && totalAgents.has(agencyOf(r));

  type IncomeItem =
    | { kind: "receipt"; key: string; r: Receipt }
    | { kind: "agency"; key: string; agency: string; amount: number; count: number; method?: string | null; cat: "cash" | "md" | "vendor" };

  const incomeItems: IncomeItem[] = (() => {
    const items: IncomeItem[] = [];
    const groups = new Map<string, { agency: string; amount: number; count: number; method?: string | null; cat: "cash" | "md" | "vendor" }>();
    for (const r of visibleReceipts) {
      if (isTotalAgencyPay(r)) {
        const agency = agencyOf(r);
        const cat = isVendorReceivedMethod(r.method) ? "vendor" : isMdReceivedMethod(r.method) ? "md" : "cash";
        const key = `${agency}|${cat}`;
        const g = groups.get(key) ?? { agency, amount: 0, count: 0, method: r.method, cat };
        g.amount += Number(r.amount || 0);
        g.count += 1;
        groups.set(key, g);
      } else {
        items.push({ kind: "receipt", key: r.id, r });
      }
    }
    for (const [key, g] of groups) items.push({ kind: "agency", key, ...g });
    return items;
  })();


  const submit = async () => {
    const cashText = cash.trim();
    const amt = Number(cashText);
    if (cashText === "" || !Number.isFinite(amt) || amt < 0) return toast.error("সঠিক টাকার পরিমাণ দিন");
    if (receipts.length + expenses.length === 0) return toast.error("এই closing date পর্যন্ত handover করার মতো কোনো pending আয়/খরচ নেই");
    setSaving(true);
    const { error } = await supabase.rpc("submit_handover" as never, {
      _submitted_amount: amt,
      _closing_date: closingDate,
      _remarks: remarks || null,
    } as never);
    if (error) {
      setSaving(false);
      return toast.error(error.message);
    }
    toast.success("Handover submitted. Awaiting MD approval.");

    // Auto-email the report to the MD's saved email (Settings → ইমেইল ঠিকানা).
    const to = (recipientEmail.trim() || mdEmail.trim());
    if (to) {
      const ok = await sendTo(to);
      if (ok) toast.success(`📧 রিপোর্ট MD-কে ইমেইলে পাঠানো হয়েছে: ${to}`);
    } else {
      toast.warning("MD এখনো নোটিফিকেশন ইমেইল সেট করেননি — শুধু MD panel-এ গেছে, ইমেইল যায়নি।");
    }

    setSaving(false);
    setCash("");
    setRemarks("");
    onOpenChange(false);
    onSubmitted?.();
  };

  const declared = Number(cash) || 0;
  const variance = declared - netCash;

  const buildReportHtml = () => {
    const row = (label: string, value: string, color: string) =>
      `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#555;">${label}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;color:${color};">${value}</td></tr>`;
    const incomeRows = incomeItems
      .map((it) => {
        if (it.kind === "agency") {
          const vendorRecv = it.cat === "vendor";
          const mdRecv = it.cat === "md";
          const color = vendorRecv ? "#ea580c" : mdRecv ? "#0284c7" : "#059669";
          const tag = vendorRecv ? "(Vendor) " : mdRecv ? "(MD) " : "";
          const amt = `${tag}৳ ${it.amount.toLocaleString()}`;
          return `<tr><td style="padding:5px 12px;border-bottom:1px solid #f1f1f1;"><b>${it.agency}</b><br><span style="color:#999;font-size:11px;">এজেন্সি (মোটের উপর) · ${it.count} পেমেন্ট</span></td><td style="padding:5px 12px;border-bottom:1px solid #f1f1f1;text-align:right;color:${color};font-weight:600;">${amt}</td></tr>`;
        }
        const r = it.r;
        const evt = isStatusEvent(r);
        const mdRecv = isMdReceivedMethod(r.method) && !evt;
        const vendorRecv = isVendorReceivedMethod(r.method) && !evt;
        // Cash = green, MD received = sky-blue, Vendor received = orange.
        const color = evt ? "#7c3aed" : vendorRecv ? "#ea580c" : mdRecv ? "#0284c7" : "#059669";
        const tag = vendorRecv ? "(Vendor) " : mdRecv ? "(MD) " : "";
        const amt = evt ? "📦 Delivery" : `${tag}৳ ${Number(r.amount || 0).toLocaleString()}`;
        const note = vendorRecv
          ? `<br><span style="color:#ea580c;font-size:10px;">Vendor Rece</span>`
          : mdRecv
          ? `<br><span style="color:#0284c7;font-size:10px;">MD রিসিভ · ${methodLabel(r.method)}</span>`
          : "";
        return `<tr><td style="padding:5px 12px;border-bottom:1px solid #f1f1f1;">${r.passenger_name || "—"}<br><span style="color:#999;font-size:11px;">${svcLine(r) || (r.receipt_id || "")}</span>${note}</td><td style="padding:5px 12px;border-bottom:1px solid #f1f1f1;text-align:right;color:${color};font-weight:600;">${amt}</td></tr>`;
      })
      .join("");
    const expenseRows = expenses
      .map(
        (e) =>
          `<tr><td style="padding:5px 12px;border-bottom:1px solid #f1f1f1;">${e.category}${e.purpose ? ` — ${e.purpose}` : ""}</td><td style="padding:5px 12px;border-bottom:1px solid #f1f1f1;text-align:right;color:#dc2626;">− ৳ ${Number(e.amount || 0).toLocaleString()}</td></tr>`
      )
      .join("");
    return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;">
  <div style="background:#0f172a;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;font-size:18px;">Cash Handover Report</h2>
    <p style="margin:4px 0 0;font-size:13px;color:#94a3b8;">Asia Travel — Closing Date: ${formatDate(closingDate)}</p>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;padding:16px 8px;border-radius:0 0 8px 8px;">
    <p style="padding:0 12px;font-size:13px;color:#555;">Staff: <b>${user?.email || user?.id || "—"}</b></p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      ${row("নগদ আয় (Cash Received)", `৳ ${totalReceived.toLocaleString()}`, "#059669")}
      ${totalMdReceived > 0 ? row("MD রিসিভ", `৳ ${totalMdReceived.toLocaleString()}`, "#0284c7") : ""}
      ${totalVendorReceived > 0 ? row("Vendor Rece", `৳ ${totalVendorReceived.toLocaleString()}`, "#ea580c") : ""}
      ${row("ব্যয় (Expense)", `− ৳ ${totalExpense.toLocaleString()}`, "#dc2626")}
      ${row("ডিসকাউন্ট (Discount)", `৳ ${totalDiscount.toLocaleString()}`, "#d97706")}
      ${row("Net Cash", `৳ ${netCash.toLocaleString()}`, "#0f172a")}
      ${row("Physical Cash Counted", `৳ ${declared.toLocaleString()}`, "#0f172a")}
      ${row("Variance", `${variance >= 0 ? "+" : ""}৳ ${variance.toLocaleString()}`, variance >= 0 ? "#059669" : "#d97706")}
    </table>
    ${incomeRows ? `<h3 style="margin:16px 12px 4px;font-size:14px;">আয়/ডেলিভারি বিবরণ</h3><table style="width:100%;border-collapse:collapse;font-size:12px;">${incomeRows}</table>` : ""}
    ${expenseRows ? `<h3 style="margin:16px 12px 4px;font-size:14px;">ব্যয় বিবরণ</h3><table style="width:100%;border-collapse:collapse;font-size:12px;">${expenseRows}</table>` : ""}
    ${remarks ? `<p style="padding:12px;font-size:13px;color:#555;"><b>Remarks:</b> ${remarks}</p>` : ""}
  </div>
</div>`;
  };

  const sendTo = async (to: string): Promise<boolean> => {
    const target = to.trim();
    if (!target) {
      toast.error("প্রাপকের ইমেইল দিন");
      return false;
    }
    setSendingEmail(true);
    try {
      await sendEmailFn({
        data: {
          to: target,
          subject: `Cash Handover Report — ${formatDate(closingDate)}`,
          html: buildReportHtml(),
        },
      });
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ইমেইল পাঠানো যায়নি");
      return false;
    } finally {
      setSendingEmail(false);
    }
  };

  const sendReport = async () => {
    const ok = await sendTo(recipientEmail);
    if (ok) toast.success(`রিপোর্ট ইমেইলে পাঠানো হয়েছে: ${recipientEmail.trim()}`);
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" /> MD-কে হিসাব পাঠান
          </DialogTitle>
          <DialogDescription>
            আপনার আইডির pending পেমেন্ট, delivery ও delivery but due — Submit to MD দিলে Kaium Khan-এর MD panel-এ যাবে।
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-lg border bg-emerald-500/10 p-2.5">
              <div className="flex items-center gap-1 text-[10px] uppercase text-emerald-600 dark:text-emerald-400">
                <TrendingUp className="h-3 w-3" /> নগদ আয়
              </div>
              <div className="text-sm font-semibold tabular-nums mt-1">{fmt(totalReceived)}</div>
              <div className="text-[10px] text-muted-foreground">{incomeItems.length} item</div>
              {totalMdReceived > 0 && (
                <div className="text-[10px] text-sky-600 dark:text-sky-400 mt-0.5">MD: {fmt(totalMdReceived)}</div>
              )}
              {totalVendorReceived > 0 && (
                <div className="text-[10px] text-orange-600 dark:text-orange-400 mt-0.5">Vendor: {fmt(totalVendorReceived)}</div>
              )}
            </div>
            <div className="rounded-lg border bg-rose-500/10 p-2.5">
              <div className="flex items-center gap-1 text-[10px] uppercase text-rose-600 dark:text-rose-400">
                <TrendingDown className="h-3 w-3" /> ব্যয়
              </div>
              <div className="text-sm font-semibold tabular-nums mt-1">{fmt(totalExpense)}</div>
              <div className="text-[10px] text-muted-foreground">{expenses.length} expense</div>
            </div>
            <div className="rounded-lg border bg-amber-500/10 p-2.5">
              <div className="flex items-center gap-1 text-[10px] uppercase text-amber-600 dark:text-amber-400">
                ডিসকাউন্ট
              </div>
              <div className="text-sm font-semibold tabular-nums mt-1">{fmt(totalDiscount)}</div>
              <div className="text-[10px] text-muted-foreground">ক্যাশ নয় — শুধু নোট</div>
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
              আয়/ডেলিভারি বিবরণ — {incomeItems.length}
            </div>
            <div className="max-h-32 overflow-y-auto divide-y text-xs">
              {loading ? (
                <div className="p-3 text-muted-foreground">লোড হচ্ছে…</div>
              ) : incomeItems.length === 0 ? (
                <div className="p-3 text-muted-foreground">কোনো pending receipt নেই</div>
              ) : (
                incomeItems.map((it) => {
                  if (it.kind === "agency") {
                    const vendorRecv = it.cat === "vendor";
                    const mdRecv = it.cat === "md";
                    return (
                    <div key={it.key} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{it.agency}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          এজেন্সি (মোটের উপর) · {it.count} পেমেন্ট
                        </div>
                        {mdRecv && (
                          <div className="text-[10px] text-sky-600 dark:text-sky-400">MD রিসিভ · {methodLabel(it.method)}</div>
                        )}
                        {vendorRecv && (
                          <div className="text-[10px] text-orange-600 dark:text-orange-400">Vendor Rece</div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className={`tabular-nums font-semibold ${vendorRecv ? "text-orange-600 dark:text-orange-400" : mdRecv ? "text-sky-600 dark:text-sky-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                          {mdRecv || vendorRecv ? "" : "+"}{fmt(it.amount)}
                        </div>
                      </div>
                    </div>
                    );
                  }
                  const r = it.r;
                  const statusEvt = isStatusEvent(r);
                  const mdRecv = isMdReceivedMethod(r.method) && !statusEvt;
                  const vendorRecv = isVendorReceivedMethod(r.method) && !statusEvt;
                  return (
                  <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.passenger_name || "—"}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {svcLine(r) || (r.receipt_id || r.id.slice(0, 8))}
                      </div>
                      {statusEvt && (
                        <div className="text-[10px] text-violet-600 dark:text-violet-400">
                          {cleanStatusText(r.remarks)} — ডেলিভারি তথ্য
                        </div>
                      )}
                      {mdRecv && (
                        <div className="text-[10px] text-sky-600 dark:text-sky-400">MD রিসিভ · {methodLabel(r.method)}</div>
                      )}
                      {vendorRecv && (
                        <div className="text-[10px] text-orange-600 dark:text-orange-400">Vendor Rece</div>
                      )}
                    </div>
                    <div className="text-right">
                      {statusEvt ? (
                        <div className="text-[10px] font-semibold text-violet-600 dark:text-violet-400">📦 Delivery</div>
                      ) : (
                        <div className={`tabular-nums font-semibold ${vendorRecv ? "text-orange-600 dark:text-orange-400" : mdRecv ? "text-sky-600 dark:text-sky-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                          {mdRecv || vendorRecv ? "" : "+"}{fmt(Number(r.amount))}
                        </div>
                      )}
                      {Number(r.discount || 0) > 0 && (
                        <div className="text-[10px] tabular-nums text-amber-600 dark:text-amber-400">
                          ডিসকাউন্ট: {fmt(Number(r.discount))}
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Expense detail */}
          <div className="rounded-lg border">
            <div className="px-3 py-2 text-xs font-semibold border-b bg-muted/30">
              ব্যয় বিবরণ (Pending — এই তারিখ পর্যন্ত) — {expenses.length}
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

          {/* Email report */}
          <div className="rounded-lg border p-3 space-y-2">
            <Label className="text-xs flex items-center gap-1">
              <Mail className="h-3.5 w-3.5" /> MD-এর ইমেইল (Submit to MD দিলে এখানে রিপোর্ট যাবে)
            </Label>
            <div className="flex gap-2">
              <Input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="md@gmail.com"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={sendReport}
                disabled={sendingEmail || loading}
                className="shrink-0 gap-1"
              >
                <Mail className="h-4 w-4" />
                {sendingEmail ? "পাঠানো হচ্ছে…" : "এখনই পাঠান"}
              </Button>
            </div>
            {!mdEmail && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                ⚠️ MD এখনো Settings-এ ইমেইল সেট করেননি। অটো-ইমেইল পেতে MD-কে Settings → ইমেইল ঠিকানা সেট করতে বলুন।
              </p>
            )}
          </div>

        </div>


        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || cash.trim() === "" || receipts.length + expenses.length === 0}>
            {saving ? "Submitting…" : "Submit to MD"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
