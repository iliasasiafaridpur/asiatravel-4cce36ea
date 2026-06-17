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

// Emoji icon per service table for the report's service-info block.
const SVC_ICONS: Record<string, string> = {
  tickets: "✈️",
  bmet_cards: "🪪",
  saudi_visas: "🛂",
  kuwait_visas: "🛂",
  others: "🧾",
  agency_ledger: "📒",
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
    const money = (n: number) => `৳&nbsp;${(Number(n) || 0).toLocaleString()}`;
    const now = Date.now();
    const batchIds = new Set(receipts.map((r) => r.id));
    const cashReceipts = totalReceived;
    const mdReceipts = totalMdReceived;

    // Each receipt is rendered as a STACKED CARD (mobile-safe) instead of a
    // wide multi-column table, so nothing gets cut off on a phone screen.
    const incomeCards = visibleReceipts
      .map((r) => {
        const info = r.svc ?? {};
        const sk = serviceKey(r);
        const allForSvc = sk ? (recByService[sk] ?? []) : [];
        const past = allForSvc.filter((x) => !batchIds.has(x.id) && new Date(x.created_at ?? r.entry_date).getTime() < now);
        const previousPaid = past.reduce((s, x) => s + Number(x.amount || 0), 0);
        const lastPast = past.length
          ? past.reduce((a, b) => (new Date(a.created_at ?? "").getTime() > new Date(b.created_at ?? "").getTime() ? a : b))
          : null;
        const totalPaidIncl = allForSvc.reduce((s, x) => s + Number(x.amount || 0), 0);
        const bill = Number(info.bill ?? 0);
        const discount = Number(info.discount ?? 0);
        const due = bill > 0 ? Math.max(0, bill - totalPaidIncl - discount) : 0;
        const dueAfterThis = bill > 0 ? Math.max(0, bill - (previousPaid + Number(r.amount || 0)) - discount) : 0;
        const statusEvt = isStatusEvent(r);
        const mdRecv = isMdReceivedMethod(r.method) && !statusEvt;

        // ---- Passenger service info block (prominent, top of card) ----
        const tbl = r.service_table ?? "";
        const svcTitle = info.service_name || TABLE_LABELS[tbl] || r.service_type || "Service";
        const svcIcon = SVC_ICONS[tbl] || (info.airline ? "✈️" : "🧾");
        const svcMetaBits = [
          info.country || "",
          info.airline ? `${info.airline}${info.flight_date ? ` · ✈ ${formatDate(info.flight_date)}` : ""}` : "",
          info.route || "",
        ].filter(Boolean);
        const svcMeta = svcMetaBits.join(" · ");
        const svcBox = `<div class="svcbox">
    <span class="svcicon">${svcIcon}</span>
    <div class="svcinfo">
      <div class="svctitle">${svcTitle}</div>
      ${svcMeta ? `<div class="svcmeta">${svcMeta}</div>` : ""}
    </div>
  </div>`;

        // key-value rows (label : value) — each on its own line, full width
        const rows: string[] = [];
        if (bill > 0) {
          let billVal = `<b>${money(bill)}</b>`;
          if (discount > 0) billVal += ` <span class="in" style="font-size:12px">(− ${money(discount)} ডিসকাউন্ট)</span>`;
          rows.push(`<tr><td class="k">মোট বিল</td><td class="v">${billVal}</td></tr>`);
        }
        if (info.vendor) {
          rows.push(`<tr><td class="k">ভেন্ডর</td><td class="v muted">${info.vendor}${Number(info.vendor_price ?? 0) > 0 ? ` · ${Math.round(Number(info.vendor_price)).toLocaleString()}` : ""}</td></tr>`);
        }
        if (previousPaid > 0) {
          rows.push(`<tr><td class="k">পূর্বের জমা</td><td class="v"><span class="sky" style="font-weight:600">${money(previousPaid)}</span>${lastPast ? ` <span class="sky" style="font-size:12px">(${formatDate(lastPast.entry_date)}${past.length > 1 ? ` +${past.length - 1}` : ""})</span>` : ""}</td></tr>`);
        }
        const thisVal = statusEvt
          ? `<span class="violet" style="font-weight:700">📦 ${cleanStatusText(r.remarks)}</span>`
          : `<b class="${mdRecv ? "sky" : "in"}" style="font-size:16px">${money(r.amount || 0)}</b>${mdRecv ? ` <span class="sky" style="font-size:12px">(MD · ${r.method})</span>` : ""}`;
        rows.push(`<tr><td class="k">এই বারের জমা</td><td class="v">${thisVal}</td></tr>`);
        if (bill > 0) {
          const dueVal = dueAfterThis <= 0.005
            ? `<span class="in" style="font-weight:700">✓ পরিশোধিত</span>`
            : `<span class="due" style="font-weight:800">${money(dueAfterThis)}</span>`;
          rows.push(`<tr><td class="k">বাকি</td><td class="v">${dueVal}</td></tr>`);
        }

        return `<div class="item">
  <div class="ihead">
    <span class="iname">${r.passenger_name || "—"}</span>
    <span class="idate">${formatDate(r.entry_date)}${r.receipt_id ? ` · <span class="mono">${r.receipt_id}</span>` : ""}</span>
  </div>
  <div class="isub">👤 এজেন্ট: ${info.agent || "Self"}${info.passport ? ` · 🛂 ${info.passport}` : ""}</div>
  ${svcBox}
  <table class="kv"><tbody>${rows.join("")}</tbody></table>
</div>`;
      })
      .join("");

    const expenseCards = expenses
      .map((e) => `<div class="item out-item">
  <div class="ihead">
    <span class="iname">${e.category || "—"}</span>
    <span class="idate">${formatDate(e.entry_date)}</span>
  </div>
  ${e.purpose ? `<div class="isub">${e.purpose}</div>` : ""}
  <table class="kv"><tbody><tr><td class="k">খরচ</td><td class="v"><b class="out" style="font-size:16px">− ${money(e.amount || 0)}</b></td></tr></tbody></table>
</div>`)
      .join("");

    const headTime = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

    return `<!doctype html><html lang="bn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ক্যাশ হ্যান্ডওভার রিপোর্ট- এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্</title>
<style>
  body{font-family:'Noto Sans Bengali','Segoe UI',Arial,sans-serif;margin:0;padding:24px 16px;background:#0a1124;color:#e2e8f0;font-size:15px;-webkit-text-size-adjust:100%}
  .wrap{max-width:920px;margin:0 auto}
  .brand{text-align:center;margin-bottom:18px}
  .brand h1{margin:0;font-size:26px;font-weight:800;color:#5eead4;letter-spacing:.2px}
  .brand p{margin:6px 0 0;font-size:14px;color:#94a3b8}
  .card{border:1px solid #24324d;border-radius:16px;overflow:hidden;background:#0e1830;box-shadow:0 12px 40px -12px rgba(0,0,0,.7)}
  .head{background:#16223d;padding:22px 24px;border-bottom:1px solid #24324d}
  .badge{display:inline-block;background:rgba(251,191,36,.16);color:#fbbf24;border:1px solid rgba(251,191,36,.4);border-radius:999px;padding:6px 16px;font-size:13px;font-weight:700}
  .hamt{display:block;text-align:right;font-size:34px;font-weight:800;color:#5eead4;margin-bottom:8px}
  .hmeta{margin-top:12px;font-size:15px;color:#cbd5e1;line-height:2}
  .hmeta b{color:#f1f5f9}
  .sec{padding:18px 24px 6px;font-size:15px;font-weight:700;color:#cbd5e1;display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px}
  .sec .amt{font-size:14px;color:#94a3b8}
  .body{padding:8px 18px 16px}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
  @media (max-width:640px){.grid{grid-template-columns:1fr}.wrap{max-width:560px}.hamt{font-size:26px}.brand h1{font-size:21px}}
  .item{border:1px solid #1d2a44;border-left:5px solid #2dd4bf;border-radius:12px;background:#0f1a30;padding:14px 16px}
  .out-item{border-left-color:#fbbf24}
  .ihead{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}
  .iname{font-weight:800;font-size:17px;color:#f1f5f9}
  .idate{font-size:12px;color:#8da2bd;white-space:nowrap}
  .isub{font-size:13px;color:#9fb3cf;margin-top:4px}
  .svcbox{display:flex;align-items:center;gap:12px;margin-top:12px;padding:11px 13px;background:linear-gradient(135deg,rgba(45,212,191,.12),rgba(56,189,248,.08));border:1px solid rgba(45,212,191,.28);border-radius:10px}
  .svcicon{font-size:22px;line-height:1;flex-shrink:0}
  .svcinfo{min-width:0}
  .svctitle{font-weight:800;font-size:15px;color:#5eead4;letter-spacing:.2px}
  .svcmeta{font-size:13px;color:#cbd5e1;margin-top:2px;line-height:1.5}
  table.kv{width:100%;border-collapse:collapse;margin-top:12px}
  table.kv td{padding:7px 0;border-top:1px solid #1d2a44;vertical-align:top;line-height:1.5}
  table.kv td.k{color:#8da2bd;font-size:13px;width:42%;white-space:nowrap}
  table.kv td.v{text-align:right;font-size:14px}
  table.kv tr:first-child td{border-top:none}
  .mono{font-family:'Courier New',monospace}
  .in{color:#34d399}.out{color:#fbbf24}.due{color:#fb7185}.sky{color:#38bdf8}.violet{color:#c4b5fd}
  .muted{color:#8da2bd}
  .empty{padding:18px;text-align:center;color:#8da2bd}
  .foot{background:#16223d;padding:16px;border-top:1px solid #24324d;font-size:14px;line-height:1.9}
  .foot b{color:#f1f5f9}
  .totalrow{display:flex;justify-content:space-between;padding:4px 0}
  .note{margin-top:10px;font-size:13px;color:#94a3b8}
</style></head><body>
<div class="wrap">
  <div class="brand">
    <h1>এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্</h1>
    <p>ক্যাশ হ্যান্ডওভার রিপোর্ট · ক্লোজিং তারিখ ${formatDate(closingDate)}</p>
  </div>
  <div class="card">
    <div class="head">
      <span class="hamt">${money(declared)}</span>
      <span class="badge">⏳ এমডিকে পাঠানো হয়েছে — অপেক্ষমান</span>
      <div class="hmeta">
        📅 তারিখ: <b>${formatDate(closingDate)}</b> · সময়: <b>${headTime}</b><br>
        👤 প্রেরক: <b>${displayName(profile, user)}</b><br>
        👥 গ্রহীতা: <b>Kaium Khan (MD)</b>
      </div>
    </div>

    <div class="sec"><span>🧾 আয় / জমার বিবরণ — ${visibleReceipts.length} টি</span><span class="amt">নগদ: ${money(cashReceipts)}${mdReceipts > 0 ? ` · MD: ${money(mdReceipts)}` : ""}</span></div>
    <div class="body">${incomeCards ? `<div class="grid">${incomeCards}</div>` : `<div class="empty">কোনো passenger receipt নেই</div>`}</div>

    ${expenseCards ? `<div class="sec"><span>💸 খরচের বিবরণ — ${expenses.length} টি</span><span class="amt">মোট: ${money(totalExpense)}</span></div>
    <div class="body"><div class="grid">${expenseCards}</div></div>` : ""}

    <div class="foot">
      <div class="totalrow"><span class="muted">নগদ আয়</span><b class="in">${money(cashReceipts)}</b></div>
      ${mdReceipts > 0 ? `<div class="totalrow"><span class="muted">MD রিসিভ</span><b class="sky">${money(mdReceipts)}</b></div>` : ""}
      ${totalExpense > 0 ? `<div class="totalrow"><span class="muted">খরচ</span><b class="out">− ${money(totalExpense)}</b></div>` : ""}
      <div class="totalrow"><span class="muted">জমা (Declared)</span><b style="color:#5eead4">${money(declared)}</b></div>
      <div class="totalrow"><span class="muted">Variance</span><b class="${variance >= 0 ? "in" : "out"}">${variance >= 0 ? "+" : ""}${money(variance)}</b></div>
      ${remarks ? `<div class="note">📝 মন্তব্য: ${remarks}</div>` : ""}
    </div>
  </div>
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
