import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateInput } from "@/components/ui/date-input";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { useServerFn } from "@tanstack/react-start";
import { sendGmail } from "@/lib/send-email.functions";
import { toast } from "sonner";
import {
  Lock, AlertTriangle, TrendingUp, TrendingDown, Wallet, HandCoins, BookOpen, Mail,
} from "lucide-react";
import { formatDateTime, formatDate } from "@/lib/modules";
import { HandoverLedgerInline } from "@/components/HandoverLedgerBook";
import { PageWatermark } from "@/components/PageWatermark";
import { isCashMethod, isMdReceivedMethod } from "@/lib/payment-methods";

export const Route = createFileRoute("/my-handover")({
  head: () => ({ meta: [{ title: "আমার ক্যাশ হিসাব" }] }),
  component: MyHandoverPage,
});

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => `৳ ${(n || 0).toLocaleString()}`;

type SvcDetail = {
  country?: string | null; route?: string | null; airline?: string | null;
  service_name?: string | null; flight_date?: string | null;
  bill?: number; vendor?: string | null; agent?: string | null; passport?: string | null; discount?: number;
  vendor_price?: number; tracks_cost?: boolean;
  delivery_date?: string | null; has_delivery?: boolean;
};
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

const STATUS_EVENT_SOURCES = new Set(["status_event", "status_change", "status-delivery"]);
const isStatusEvent = (r: Receipt) =>
  STATUS_EVENT_SOURCES.has(String(r.source ?? "")) || String(r.method ?? "").toLowerCase() === "status";
const cleanStatusText = (text?: string | null) => String(text ?? "").replace(/^\s*status\s*:\s*/i, "").trim() || "Delivery";
const serviceKey = (r: Receipt) => r.service_table && r.service_row_id ? `${r.service_table}:${r.service_row_id}` : "";
type Expense = {
  id: string; expense_id?: string | null; amount: number;
  category: string; purpose?: string | null;
  entry_date: string; created_at?: string | null;
};

// Module label per service table (matches MODULES schema).
const TABLE_LABELS: Record<string, string> = {
  tickets: "AIR TICKET",
  bmet_cards: "BMET কার্ড",
  saudi_visas: "সৌদি ভিসা",
  kuwait_visas: "কুয়েত ভিসা",
  others: "Other Service",
  agency_ledger: "Agency Ledger",
};

// Columns + mapper to pull full service/financial info per table (mirrors Handover Book).
const SVC_CONFIGS: Record<string, { cols: string; map: (r: Record<string, unknown>) => SvcDetail }> = {
  tickets: {
    cols: "id,airline,trip_road,flight_date,sold_price,vendor_bought,agency_sold,passport,discount_amount,cost_price,status",
    map: (r) => {
      const isBook = String(r.status ?? "").toUpperCase() === "BOOK";
      return {
        airline: r.airline as string, route: r.trip_road as string, flight_date: r.flight_date as string,
        bill: Number(r.sold_price ?? 0), vendor: isBook ? null : (r.vendor_bought as string),
        agent: r.agency_sold as string, passport: r.passport as string,
        discount: Number(r.discount_amount ?? 0), vendor_price: isBook ? 0 : Number(r.cost_price ?? 0),
        tracks_cost: !isBook, has_delivery: false,
      };
    },
  },
  bmet_cards: {
    cols: "id,country_name,sold_price,vendor_bought,agency_sold,passport,discount_amount,cost_price,delivery_date",
    map: (r) => ({
      country: r.country_name as string, bill: Number(r.sold_price ?? 0), vendor: r.vendor_bought as string,
      agent: r.agency_sold as string, passport: r.passport as string, discount: Number(r.discount_amount ?? 0),
      vendor_price: Number(r.cost_price ?? 0), tracks_cost: true, delivery_date: r.delivery_date as string, has_delivery: true,
    }),
  },
  saudi_visas: {
    cols: "id,sold_price,vendor_bought,agency_sold,passport,discount_amount,cost_price,delivery_date",
    map: (r) => ({
      country: "Saudi Arabia", bill: Number(r.sold_price ?? 0), vendor: r.vendor_bought as string,
      agent: r.agency_sold as string, passport: r.passport as string, discount: Number(r.discount_amount ?? 0),
      vendor_price: Number(r.cost_price ?? 0), tracks_cost: true, delivery_date: r.delivery_date as string, has_delivery: true,
    }),
  },
  kuwait_visas: {
    cols: "id,sold_price,vendor_bought,agency_sold,passport,discount_amount,cost_price,delivery_date",
    map: (r) => ({
      country: "Kuwait", bill: Number(r.sold_price ?? 0), vendor: r.vendor_bought as string,
      agent: r.agency_sold as string, passport: r.passport as string, discount: Number(r.discount_amount ?? 0),
      vendor_price: Number(r.cost_price ?? 0), tracks_cost: true, delivery_date: r.delivery_date as string, has_delivery: true,
    }),
  },
  others: {
    cols: "id,service_name,airline,trip_road,flight_date,country_route,sold_price,vendor_bought,agency_sold,passport,discount_amount,cost_price,delivery_date",
    map: (r) => ({
      service_name: r.service_name as string, airline: r.airline as string, route: r.trip_road as string,
      flight_date: r.flight_date as string, country: r.country_route as string, bill: Number(r.sold_price ?? 0),
      vendor: r.vendor_bought as string, agent: r.agency_sold as string, passport: r.passport as string,
      discount: Number(r.discount_amount ?? 0), vendor_price: Number(r.cost_price ?? 0), tracks_cost: true,
      delivery_date: r.delivery_date as string, has_delivery: true,
    }),
  },
  agency_ledger: {
    cols: "id,country_route,agent_name,total_bill,discount_amount",
    map: (r) => ({
      country: r.country_route as string, bill: Number(r.total_bill ?? 0), vendor: r.agent_name as string,
      agent: r.agent_name as string, discount: Number(r.discount_amount ?? 0), tracks_cost: false, has_delivery: false,
    }),
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

function MyHandoverPage() {
  const { user, profile } = useCurrentUser();
  const [closingDate, setClosingDate] = useState(today());
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [cash, setCash] = useState("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [mdEmail, setMdEmail] = useState("");
  const [recByService, setRecByService] = useState<Record<string, Receipt[]>>({});
  const [sendingEmail, setSendingEmail] = useState(false);
  const sendEmailFn = useServerFn(sendGmail);

  // When navigated from "MD-কে পাঠানো" list, highlight the target handover card.
  useEffect(() => {
    if (!user?.id) return;
    const targetId = sessionStorage.getItem("highlight-handover");
    if (!targetId) return;
    sessionStorage.removeItem("highlight-handover");
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      window.dispatchEvent(new CustomEvent("ledger-highlight-handover", { detail: targetId }));
      const found = document.getElementById(`handover-card-${targetId}`);
      if (found || tries > 12) clearInterval(timer);
    }, 600);
    return () => clearInterval(timer);
  }, [user?.id]);


  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [r, e, md] = await Promise.all([
        supabase
          .from("payment_receipts")
          .select("id,receipt_id,amount,passenger_name,entry_date,created_at,service_table,service_row_id,service_type,method,source,remarks")
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
          .lte("entry_date", closingDate)
          .is("handover_id", null)
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("profiles")
          .select("notify_email,role")
          .in("role", ["md", "admin"])
          .not("notify_email", "is", null),
      ]);
      if (cancelled) return;
      if (r.error) toast.error(r.error.message);
      if (e.error) toast.error(e.error.message);
      const mdRows = ((md?.data ?? []) as Array<{ notify_email?: string | null; role?: string | null }>);
      const pick = mdRows.find((p) => p.role === "md") ?? mdRows[0];
      setMdEmail((pick?.notify_email ?? "").trim());
      const recs = ((r.data ?? []) as unknown) as Receipt[];

      // Enrich each receipt with full service/financial info from its underlying service row.
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
        rec.discount = rec.svc?.discount ?? 0;
      }

      // Load ALL receipts for each service row so we can show পূর্বের জমা / বাকি (paid history).
      const byService: Record<string, Receipt[]> = {};
      const entries = Object.entries(svcByTable);
      if (entries.length > 0) {
        await Promise.all(
          entries.map(async ([tbl, ids]) => {
            const { data } = await supabase
              .from("payment_receipts")
              .select("id,receipt_id,amount,passenger_name,entry_date,created_at,service_table,service_row_id,service_type,method,source,remarks")
              .eq("service_table", tbl)
              .in("service_row_id", Array.from(ids))
              .not("source", "eq", "discount");
            for (const row of ((data ?? []) as unknown as Receipt[])) {
              if (!row.service_table || !row.service_row_id) continue;
              (byService[`${row.service_table}:${row.service_row_id}`] ??= []).push(row);
            }
          })
        );
      }
      setRecByService(byService);


      setReceipts(recs);
      setExpenses(((e.data ?? []) as unknown) as Expense[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.id, closingDate, reloadTick]);

  // Only Cash counts as the staff's physical cash. Non-cash goes to MD directly.
  const totalReceived = receipts.reduce((s, r) => s + (isCashMethod(r.method) ? Number(r.amount || 0) : 0), 0);
  const totalMdReceived = receipts.reduce((s, r) => s + (isMdReceivedMethod(r.method) ? Number(r.amount || 0) : 0), 0);
  const totalExpense = expenses.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalDiscount = receipts.reduce((s, r) => s + Number(r.discount || 0), 0);
  const netCash = totalReceived - totalExpense;
  const moneyServiceKeys = useMemo(() => new Set(
    receipts.filter((r) => !isStatusEvent(r) && Number(r.amount || 0) > 0).map(serviceKey).filter(Boolean)
  ), [receipts]);
  const visibleReceipts = useMemo(
    () => receipts.filter((r) => !(isStatusEvent(r) && moneyServiceKeys.has(serviceKey(r)))),
    [receipts, moneyServiceKeys]
  );

  const buildReportHtml = () => {
    const money = (n: number) => `৳ ${(Number(n) || 0).toLocaleString()}`;
    const incomeRows = visibleReceipts
      .map((r, i) => {
        const evt = isStatusEvent(r);
        const amt = evt
          ? `<span class="hand">📦 Delivery</span>`
          : `<span class="in">${money(r.amount || 0)}</span>`;
        const disc = Number(r.discount || 0) > 0 ? `<span class="due">− ${money(r.discount || 0)}</span>` : "";
        return `<tr>
  <td class="num">${i + 1}</td>
  <td class="wrap">${r.passenger_name || "—"}</td>
  <td class="wrap">${svcLine(r) || r.receipt_id || ""}</td>
  <td class="num">${amt}</td>
  <td class="num">${disc}</td>
</tr>`;
      })
      .join("");
    const expenseRows = expenses
      .map((e, i) => `<tr>
  <td class="num">${i + 1}</td>
  <td class="wrap">${e.category}${e.purpose ? ` — ${e.purpose}` : ""}</td>
  <td class="num out">− ${money(e.amount || 0)}</td>
</tr>`)
      .join("");
    return `<!doctype html><html lang="bn"><head><meta charset="utf-8">
<title>ক্যাশ হ্যান্ডওভার রিপোর্ট- এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্</title>
<style>
  body{font-family:'Noto Sans Bengali',Arial,system-ui,sans-serif;padding:8px;color:#111;margin:0;background:#ffffff}
  .sheet{max-width:640px;margin:0 auto}
  h1{margin:0 0 2px;font-size:16px}
  .meta{color:#555;font-size:11px;margin-bottom:8px}
  .summary{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px;font-size:11px;font-weight:700}
  .summary div{padding:4px 7px;border:1px solid #ddd;border-radius:4px;flex:1;min-width:120px}
  h2{font-size:12.5px;margin:12px 0 4px}
  table{width:100%;border-collapse:collapse;font-size:11px;table-layout:auto;margin-bottom:6px}
  th,td{border-bottom:1px solid #e5e5e5;padding:3px 5px;text-align:left;vertical-align:top;line-height:1.3}
  td.wrap,th.wrap{white-space:normal;word-break:break-word}
  th{background:#f5f5f5;font-weight:600}
  th.num{text-align:right}
  td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .in{color:#059669}.out{color:#b45309}.hand{color:#0284c7}.due{color:#b91c1c}
  tfoot td{font-weight:700;background:#fafafa}
</style></head><body>
<div class="sheet">
  <h1>ক্যাশ হ্যান্ডওভার রিপোর্ট- এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্</h1>
  <div class="meta">${displayName(profile, user)} · ক্লোজিং তারিখ: ${formatDate(closingDate)}</div>
  <div class="summary">
    <div class="in">নগদ আয়: <b>+ ${money(totalReceived)}</b></div>
    <div class="out">ব্যয়: <b>− ${money(totalExpense)}</b></div>
    <div class="due">ডিসকাউন্ট: <b>${money(totalDiscount)}</b></div>
    <div>Net Cash: <b>${money(netCash)}</b></div>
    <div>গণনাকৃত নগদ: <b>${money(declared)}</b></div>
    <div class="${variance >= 0 ? "in" : "out"}">Variance: <b>${variance >= 0 ? "+" : ""}${money(variance)}</b></div>
  </div>
  ${incomeRows ? `<h2>আয়/ডেলিভারি বিবরণ</h2>
  <table>
    <thead><tr><th class="num">#</th><th class="wrap">নাম</th><th class="wrap">সার্ভিস</th><th class="num">আয়</th><th class="num">ডিসকাউন্ট</th></tr></thead>
    <tbody>${incomeRows}</tbody>
  </table>` : ""}
  ${expenseRows ? `<h2>ব্যয় বিবরণ</h2>
  <table>
    <thead><tr><th class="num">#</th><th class="wrap">খাত / উদ্দেশ্য</th><th class="num">পরিমাণ</th></tr></thead>
    <tbody>${expenseRows}</tbody>
  </table>` : ""}
  ${remarks ? `<p style="font-size:11px;color:#555;"><b>মন্তব্য:</b> ${remarks}</p>` : ""}
</div>
</body></html>`;
  };

  const sendToMd = async (): Promise<boolean> => {
    const target = mdEmail.trim();
    if (!target) {
      toast.warning("MD এখনো নোটিফিকেশন ইমেইল সেট করেননি — শুধু MD panel-এ গেছে, ইমেইল যায়নি।");
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
      toast.success(`📧 রিপোর্ট MD-কে ইমেইলে পাঠানো হয়েছে: ${target}`);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ইমেইল পাঠানো যায়নি");
      return false;
    } finally {
      setSendingEmail(false);
    }
  };

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
    await sendToMd();
    setSaving(false);
    setCash("");
    setRemarks("");
    setReloadTick((t) => t + 1);
  };

  const declared = Number(cash) || 0;
  const variance = declared - netCash;

  return (
    <div className="relative z-10 container mx-auto p-3 sm:p-5 space-y-4 max-w-7xl">
      <PageWatermark text="HANDOVER HISTORY" size="sm" />
      {/* Header */}
      <div className="flex items-center gap-3 pb-2 border-b">
        <div className="h-10 w-10 rounded-lg bg-sky-500/15 flex items-center justify-center">
          <HandCoins className="h-5 w-5 text-sky-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold">আমার ক্যাশ হিসাব</h1>
          <p className="text-xs text-muted-foreground">নিজের পেমেন্ট/ডেলিভারি হিসাব MD-কে পাঠানো ও হিস্টোরি</p>
        </div>
      </div>

      {/* Metric chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-lg border bg-emerald-500/10 p-3">
          <div className="flex items-center gap-1 text-[10px] uppercase text-emerald-600 dark:text-emerald-400">
            <TrendingUp className="h-3 w-3" /> নগদ আয়
          </div>
          <div className="text-base font-semibold tabular-nums mt-1">{fmt(totalReceived)}</div>
              <div className="text-[10px] text-muted-foreground">{visibleReceipts.length} item</div>
          {totalMdReceived > 0 && (
            <div className="text-[10px] text-sky-600 dark:text-sky-400 mt-0.5">MD রিসিভ: {fmt(totalMdReceived)} (ব্যালেন্সে নয়)</div>
          )}
        </div>
        <div className="rounded-lg border bg-rose-500/10 p-3">
          <div className="flex items-center gap-1 text-[10px] uppercase text-rose-600 dark:text-rose-400">
            <TrendingDown className="h-3 w-3" /> ব্যয়
          </div>
          <div className="text-base font-semibold tabular-nums mt-1">{fmt(totalExpense)}</div>
          <div className="text-[10px] text-muted-foreground">{expenses.length} expense</div>
        </div>
        <div className="rounded-lg border bg-amber-500/10 p-3">
          <div className="text-[10px] uppercase text-amber-600 dark:text-amber-400">ডিসকাউন্ট</div>
          <div className="text-base font-semibold tabular-nums mt-1">{fmt(totalDiscount)}</div>
          <div className="text-[10px] text-muted-foreground">ক্যাশ নয় — শুধু নোট</div>
        </div>
        <div className="rounded-lg border bg-primary/10 p-3">
          <div className="flex items-center gap-1 text-[10px] uppercase text-primary">
            <Wallet className="h-3 w-3" /> Net Cash
          </div>
          <div className="text-base font-semibold tabular-nums mt-1">{fmt(netCash)}</div>
          <div className="text-[10px] text-muted-foreground">আয় − ব্যয়</div>
        </div>
      </div>

      {/* Submit Handover */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Lock className="h-4 w-4" /> MD-কে হিসাব পাঠান
          </div>
          <p className="text-xs text-muted-foreground">
            আপনার আইডির pending পেমেন্ট, delivery ও delivery but due — Submit to MD দিলে Kaium Khan-এর MD panel-এ যাবে।
          </p>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Closing Date</Label>
              <DateInput value={closingDate} onChange={(e) => setClosingDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Physical Cash Counted (৳) *</Label>
              <Input
                type="number"
                inputMode="numeric"
                placeholder={String(netCash || 0)}
                value={cash}
                onChange={(e) => setCash(e.target.value)}
              />
            </div>
          </div>

          {/* Income detail */}
          <div className="grid lg:grid-cols-2 gap-3">
            <div className="rounded-lg border">
              <div className="px-3 py-2 text-xs font-semibold border-b bg-muted/30">
                আয়/ডেলিভারি বিবরণ — {visibleReceipts.length}
              </div>
              <div className="max-h-48 overflow-y-auto text-sm">
                {loading ? (
                  <div className="p-3 text-muted-foreground">লোড হচ্ছে…</div>
                ) : visibleReceipts.length === 0 ? (
                  <div className="p-3 text-muted-foreground">কোনো pending receipt নেই</div>
                ) : (
                  visibleReceipts.map((r, idx) => {
                    const statusEvt = isStatusEvent(r);
                    const mdRecv = isMdReceivedMethod(r.method) && !statusEvt;
                    return (
                    <div key={r.id} className={`flex items-center justify-between gap-2 px-3 py-1.5 border-b last:border-b-0 row-tint-${idx % 4}`}>
                      <div className="min-w-0">
                        <div className="text-sm truncate">{r.passenger_name || "—"}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {svcLine(r) || (r.receipt_id || r.id.slice(0, 8))}
                        </div>
                        {statusEvt && (
                          <div className="text-[11px] text-violet-600 dark:text-violet-400">
                            {cleanStatusText(r.remarks)} — ডেলিভারি তথ্য
                          </div>
                        )}
                        {mdRecv && (
                          <div className="text-[11px] text-sky-600 dark:text-sky-400">MD রিসিভ · {r.method} — ব্যালেন্সে নয়</div>
                        )}
                      </div>
                      <div className="text-right">
                        {statusEvt ? (
                          <div className="text-[11px] font-semibold text-violet-600 dark:text-violet-400">📦 Delivery</div>
                        ) : (
                          <div className={`text-sm tabular-nums font-semibold ${mdRecv ? "text-sky-600 dark:text-sky-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                            {mdRecv ? "" : "+"}{fmt(Number(r.amount))}
                          </div>
                        )}
                        {Number(r.discount || 0) > 0 && (
                          <div className="text-xs tabular-nums text-amber-600 dark:text-amber-400">
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
                ব্যয় বিবরণ (এই তারিখ পর্যন্ত) — {expenses.length}
              </div>
              <div className="max-h-48 overflow-y-auto text-sm">
                {loading ? (
                  <div className="p-3 text-muted-foreground">লোড হচ্ছে…</div>
                ) : expenses.length === 0 ? (
                  <div className="p-3 text-muted-foreground">কোনো ব্যয় নেই</div>
                ) : (
                  expenses.map((e, idx) => (
                    <div key={e.id} className={`flex items-center justify-between gap-2 px-3 py-1.5 border-b last:border-b-0 row-tint-${idx % 4}`}>
                      <div className="min-w-0">
                        <div className="text-sm truncate">{e.category}{e.purpose ? ` — ${e.purpose}` : ""}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {e.expense_id || e.id.slice(0, 8)} • {formatDateTime(e.created_at || e.entry_date)}
                        </div>
                      </div>
                      <div className="text-sm tabular-nums font-semibold text-rose-600 dark:text-rose-400">
                        −{fmt(Number(e.amount))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {declared > 0 && Math.abs(variance) > 0 && (
            <div className={`flex items-center gap-2 rounded-md p-2 text-xs ${
              variance > 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"
            }`}>
              <AlertTriangle className="h-3.5 w-3.5" />
              Variance: {variance > 0 ? "+" : ""}{fmt(variance)} vs Net Cash
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

          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Mail className="h-3.5 w-3.5" />
            MD email: {mdEmail || "সেট করা নেই"}
          </div>

          <div className="flex justify-end">
            <Button onClick={submit} disabled={saving || sendingEmail || cash.trim() === "" || receipts.length + expenses.length === 0} className="gap-1.5">
              <Lock className="h-4 w-4" />
              {saving || sendingEmail ? "Submitting…" : "Submit to MD"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm font-semibold mb-3">
            <BookOpen className="h-4 w-4" />
            আমার হিসাব বই (Handover History)
          </div>
          <HandoverLedgerInline mode="mine" enabled={!!user?.id} allowCancel onChanged={() => setReloadTick((t) => t + 1)} />
        </CardContent>
      </Card>
    </div>
  );
}
