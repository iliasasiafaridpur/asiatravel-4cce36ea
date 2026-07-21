import { DateInput } from "@/components/ui/date-input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { cacheRead, isOffline, readModuleCache } from "@/lib/offline-cache";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import logoAsset from "@/assets/logo.png.asset.json";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { LookupSelect } from "@/components/LookupSelect";
import { toast } from "sonner";
import { formatDate, isAdvancePayment } from "@/lib/modules";
import { AdvanceBadge } from "@/components/AdvanceBadge";
import { generateNextId } from "@/lib/idgen";
import {
  Wallet, ArrowDownLeft, ArrowUpRight, Receipt, Plus, RefreshCw, Send, Banknote,
  CalendarDays, TrendingUp, TrendingDown, Layers, Printer, MessageSquare, Search, History, X, PencilLine,
  Lock as LockIcon,
} from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRole } from "@/hooks/useRole";
import { isCashMethod, isMdReceivedMethod, isVendorReceivedMethod, DUE_RECEIVE_METHODS, vendorExpenseHitsUserBalance, handoverReducesBalance } from "@/lib/payment-methods";
import { PageWatermark } from "@/components/PageWatermark";
import { printDocHtml, buildFileTitle } from "@/lib/print-export";


export const Route = createFileRoute("/accounts")({
  head: () => ({ meta: [{ title: "আমার হিসাব — My Accounts" }] }),
  component: AccountsPage,
});

const METHODS = [...DUE_RECEIVE_METHODS];
const EXPENSE_CATEGORIES = ["Office", "Transport", "Food", "Stationery", "Bill", "Other"];
const RECEIVERS = ["MD Sir", "Office", "Bank Deposit", "Other"];
const STATUS_EVENT_SOURCES = new Set(["status_event", "status_change", "status-delivery"]);

const today = () => new Date().toISOString().slice(0, 10);
const isStatusEventReceipt = (r: Pick<Recv, "source" | "method">) =>
  STATUS_EVENT_SOURCES.has(String(r.source ?? "")) || String(r.method ?? "").toLowerCase() === "status";
const cleanStatusText = (text?: string | null) => {
  const cleaned = String(text ?? "").replace(/^\s*status\s*:\s*/i, "").trim();
  return cleaned || "Delivery";
};

// Internal accounting notes that should never be shown to the user as a "note".
// e.g. "সার্ভিস/কাস্টমার পেমেন্ট রিসিভ · MD received via Bank Transfer — staff balance neutral"
const INTERNAL_REMARK_RE = /balance[\s-]*neutral|MD received via|MD deposit|vendor received|account adjustment|opening due|সার্ভিস\/কাস্টমার পেমেন্ট রিসিভ|কাস্টমার পেমেন্ট রিসিভ|পেমেন্ট রিসিভ|এজেন্সি পেমেন্ট|এজেন্ট পেমেন্ট/i;
const cleanReceiptRemark = (text?: string | null) => {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  if (INTERNAL_REMARK_RE.test(raw)) return "";
  return raw;
};

// Uniform source labels so a receipt looks identical on the /accounts timeline
// no matter where it was received from (booking popup, agency/vendor ledger,
// extra service, manual). Without this the raw `source` string ("due",
// "agency_ledger_payment", …) leaked into the UI and looked different per source.
const SOURCE_LABELS: Record<string, string> = {
  due: "বুকিং",
  extra_due: "Extra",
  service_form: "সার্ভিস",
  agency_ledger: "এজেন্সি",
  agency_ledger_payment: "এজেন্সি",
};
const friendlySource = (source?: string | null) => SOURCE_LABELS[String(source ?? "").trim()] ?? "";

// Multi-method Due Receive creates one payment_receipts row per method sharing
// the same base receipt_id (…-1, …-2). Grouping key: same booking + same base
// receipt id + same date → treat as ONE batch in the timeline / print.
const receiptBatchKey = (r: { service_table: string | null; service_row_id: string | null; receipt_id: string; entry_date: string }) =>
  `${r.service_table ?? ""}|${r.service_row_id ?? ""}|${(r.receipt_id ?? "").replace(/-\d+$/, "")}|${r.entry_date ?? ""}`;
const uniq = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));

// Agency/vendor ledger mirror rows store verbose service_type strings like
// "Service Receipt: Nazmul-G-gong" / "Agent Receipt: Jahangir QA". Strip the
// bookkeeping prefix so the timeline shows the same clean shape as booking rows.
const cleanServiceType = (text?: string | null) => {
  const s = String(text ?? "").trim();
  const m = s.match(/^(?:Service Receipt|Agent Receipt|Customer\/Sub-Agent[^:]*)\s*:\s*(.+)$/i);
  if (m) return `এজেন্ট: ${m[1].trim()}`;
  return s || "Service";
};

// Ledger rows store the underlying service as a raw table name ("bmet_cards").
// Humanize it so column 3 reads like a real service name everywhere.
const SERVICE_TYPE_LABELS: Record<string, string> = {
  bmet_cards: "BMET Card",
  tickets: "Ticket / টিকিট",
  saudi_visas: "Saudi Visa",
  kuwait_visas: "Kuwait Visa",
  others: "Other Service",
  extra_services: "Extra Service",
};
const humanizeServiceType = (text?: string | null) => {
  const s = String(text ?? "").trim();
  if (!s) return "";
  return SERVICE_TYPE_LABELS[s] ?? s;
};



interface Hand { id: string; handover_id: string; entry_date: string; to_name: string; from_name: string | null; amount: number; method: string; remarks: string | null; from_user: string | null; status?: string | null; submitted_amount?: number | null; confirmed_amount?: number | null; closing_date?: string | null; approved_at?: string | null; approved_by?: string | null; }
interface Exp  { id: string; expense_id: string; entry_date: string; category: string; purpose: string | null; amount: number; remarks: string | null; spent_by: string | null; handover_id?: string | null; linked_source_table?: string | null; linked_source_id?: string | null; }
interface Recv { id: string; receipt_id: string; entry_date: string; service_type: string; service_table: string | null; service_row_id: string | null; ref_id: string | null; passenger_name: string; amount: number; method: string; source: string; remarks: string | null; received_by: string | null; handover_id?: string | null; }

// A submitted handover leaves the staff's drawer the moment it is sent to MD
// (pending) — only an explicitly cancelled/rejected handover does NOT reduce
// the staff's cash balance. So balance drops on submit, and is restored the
// instant the handover is cancelled (deleted) or rejected. Shared helper lives
// in @/lib/payment-methods so every screen agrees (whitespace/casing-safe).

const fmt = (n: number) => `৳ ${(n || 0).toLocaleString()}`;

// Order a set of same-scope timeline items into segments separated by cash
// handovers, in chronological (created) order. A handover then sits as a
// divider between the transactions made BEFORE it (shown above) and the ones
// made AFTER it (shown below). Within each segment the existing display
// grouping is preserved: receipts (আয়) big→small first, then খরচ big→small.
function segmentByHandover<
  T extends { kind: string; date: string; row: { amount?: number | null }; created?: string },
>(items: T[]): T[] {
  const amtOf = (it: T) => Number(it.row?.amount || 0);
  const createdOf = (it: T) =>
    it.created ?? (it.row as { created_at?: string }).created_at ?? it.date;
  const chrono = [...items].sort((a, b) => createdOf(a).localeCompare(createdOf(b)));
  const ordered: T[] = [];
  let bucket: T[] = [];
  const flush = () => {
    const ins = bucket.filter((it) => it.kind === "received").sort((a, b) => amtOf(b) - amtOf(a));
    const outs = bucket.filter((it) => it.kind !== "received").sort((a, b) => amtOf(b) - amtOf(a));
    ordered.push(...ins, ...outs);
    bucket = [];
  };
  for (const it of chrono) {
    if (it.kind === "handover") {
      flush();
      ordered.push(it);
    } else {
      bucket.push(it);
    }
  }
  flush();
  return ordered;
}

const TIMELINE_PRINT_COLGROUP_HTML = `
  <colgroup>
    <col class="c-no"><col class="c-date"><col class="c-name"><col class="c-service"><col class="c-region">
    <col class="c-bill"><col class="c-in"><col class="c-due"><col class="c-prev"><col class="c-out"><col class="c-bal">
  </colgroup>`;

function TimelinePrintColGroup() {
  return (
    <colgroup>
      <col className="c-no" /><col className="c-date" /><col className="c-name" /><col className="c-service" /><col className="c-region" />
      <col className="c-bill" /><col className="c-in" /><col className="c-due" /><col className="c-prev" /><col className="c-out" /><col className="c-bal" />
    </colgroup>
  );
}

const printCellHasText = (value: unknown) => String(value ?? "").replace(/<[^>]*>/g, "").trim().length > 0;

function renderTimelinePrintTextCellsHtml(cells: { className: string; html: string; allowSpan?: boolean }[]) {
  let out = "";
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!printCellHasText(cell.html)) {
      out += `<td class="${cell.className}"></td>`;
      continue;
    }
    let span = 1;
    if (cell.allowSpan !== false) {
      while (i + span < cells.length && !printCellHasText(cells[i + span].html)) span += 1;
    }
    out += `<td class="${cell.className}${span > 1 ? " span-fill" : ""}"${span > 1 ? ` colspan="${span}"` : ""}>${cell.html}</td>`;
    i += span - 1;
  }
  return out;
}

function renderTimelinePrintDataCellsHtml(cells: { className: string; html: string; allowSpan?: boolean }[]) {
  return renderTimelinePrintTextCellsHtml(cells.map((cell, index) => ({
    ...cell,
    // যে কলামের ডান পাশে ফাঁকা জায়গা আছে, সেই জায়গা নিয়ে একই লাইনে লিখবে।
    // কিন্তু পরের কলামে লেখা থাকলে span হবে না, তখন নিজের কলামেই wrap করবে।
    allowSpan: index === cells.length - 1 ? false : cell.allowSpan,
  })));
}

function TimelinePrintTextCells({
  cells,
}: {
  cells: { className: string; content: React.ReactNode; plain: string; allowSpan?: boolean }[];
}) {
  const out: React.ReactNode[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!printCellHasText(cell.plain)) {
      out.push(<td key={i} className={cell.className}></td>);
      continue;
    }
    let span = 1;
    if (cell.allowSpan !== false) {
      while (i + span < cells.length && !printCellHasText(cells[i + span].plain)) span += 1;
    }
    out.push(<td key={i} className={`${cell.className}${span > 1 ? " span-fill" : ""}`} colSpan={span > 1 ? span : undefined}>{cell.content}</td>);
    i += span - 1;
  }
  return <>{out}</>;
}

function TimelinePrintDataCells({
  cells,
}: {
  cells: { className: string; content: React.ReactNode; plain: string; allowSpan?: boolean }[];
}) {
  return (
    <TimelinePrintTextCells
      cells={cells.map((cell, index) => ({
        ...cell,
        allowSpan: index === cells.length - 1 ? false : cell.allowSpan,
      }))}
    />
  );
}

const TIMELINE_PRINT_TABLE_CSS = `
  table{width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed}
  col.c-no{width:2.5%}col.c-date{width:7.5%}col.c-name{width:22%}col.c-service{width:17.5%}col.c-region{width:12.5%}
  col.c-bill{width:6.8%}col.c-in{width:7.2%}col.c-due{width:6.2%}col.c-prev{width:5.5%}col.c-out{width:6.8%}col.c-bal{width:5.5%}
  th,td{border-bottom:1px solid #e5e5e5;padding:2px 3px;text-align:left;vertical-align:top;line-height:1.25;overflow-wrap:anywhere;overflow:hidden}
  td.wrap,th.wrap{white-space:normal;word-break:break-word;overflow-wrap:anywhere}
  th{background:#f5f5f5;font-weight:600}
  th.num{text-align:right;white-space:normal;overflow-wrap:anywhere}
  td.num,th.num{font-size:9.3px;padding-left:1px;padding-right:2px}
  td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:normal;word-break:normal;overflow-wrap:normal}
  td.span-fill{text-align:left;word-break:normal;overflow-wrap:break-word}
  td.num.in{text-align:right}
  td.num.span-fill{text-align:left}
  td.prev,th.prev{text-align:right;white-space:normal;word-break:break-word;overflow-wrap:anywhere;font-size:9px;padding-left:1px;padding-right:2px}
  td.dt,th.dt{white-space:normal;word-break:normal;overflow-wrap:anywhere;padding-left:1px;padding-right:10px;font-size:9.3px;border-right:1px solid #e5e5e5}
  td.dt + td,th.dt + th{padding-left:8px}
  td:first-child,th:first-child{text-align:center;padding-left:1px;padding-right:1px}
  /* একই তারিখের সব সারি এক পেইজে একসাথে থাকবে; জায়গা না হলে পুরো তারিখ পরের পেইজে যাবে।
     তবে এক তারিখের ডাটা এক পেইজে না ধরলে ব্রাউজার নিজেই একাধিক পেইজে ভাগ করবে। */
  thead{display:table-header-group}
  tbody.dategroup{break-inside:avoid;page-break-inside:avoid}
`;

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: React.ComponentType<{ className?: string }>; tone: "primary" | "success" | "warning" | "info" }) {
  const toneMap = {
    primary: "from-primary/15 to-primary/5 text-primary border-primary/20",
    success: "from-emerald-500/15 to-emerald-500/5 text-emerald-600 border-emerald-500/20",
    warning: "from-amber-500/15 to-amber-500/5 text-amber-600 border-amber-500/20",
    info:    "from-sky-500/15 to-sky-500/5 text-sky-600 border-sky-500/20",
  };
  return (
    <div className={`rounded-xl border bg-gradient-to-br ${toneMap[tone]} p-3 sm:p-4 transition-all hover:shadow-md`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] sm:text-xs font-medium opacity-80">{label}</span>
        <Icon className="h-4 w-4 opacity-70" />
      </div>
      <div className="text-lg sm:text-2xl font-bold tabular-nums tracking-tight">{fmt(value)}</div>
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="text-center py-12 text-muted-foreground text-sm">{children}</div>;
}

type BalRow = { name: string; due: number; advance: number };
function BalancePicker({
  loading, rows, selected, onToggle, onAll, onNone, onDueOnly,
}: {
  loading: boolean;
  rows: BalRow[];
  selected: Set<string>;
  onToggle: (name: string) => void;
  onAll: () => void;
  onNone: () => void;
  onDueOnly: () => void;
}) {
  if (loading) return <div className="py-3 text-center text-xs text-muted-foreground">ব্যালেন্স লোড হচ্ছে…</div>;
  if (rows.length === 0) return <div className="py-3 text-center text-xs text-muted-foreground">কোনো হিসাব নেই</div>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={onAll}>সব</Button>
        <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={onDueOnly}>শুধু বাকি</Button>
        <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={onNone}>কিছু না</Button>
        <span className="ml-auto text-[11px] text-muted-foreground">{selected.size}/{rows.length} নির্বাচিত</span>
      </div>
      <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border p-1.5">
        {rows.map((r) => (
          <label key={r.name} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/50">
            <Checkbox checked={selected.has(r.name)} onCheckedChange={() => onToggle(r.name)} />
            <span className="flex-1 truncate">{r.name}</span>
            <span className={`tabular-nums ${r.advance > 0 ? "text-emerald-600" : r.due > 0 ? "text-rose-600" : "text-muted-foreground"}`}>
              {r.advance > 0 ? `অগ্রিম ৳${r.advance.toLocaleString()}` : r.due > 0 ? `বাকি ৳${r.due.toLocaleString()}` : "0"}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}



function AccountsPage() {
  const { user, profile } = useCurrentUser();
  const navigate = useNavigate();
  const { isAdmin, isMd, isStaff, loading: roleLoading } = useRole();
  // "আমার হিসাব" — সব ইউজার (MD/Admin সহ) শুধুমাত্র নিজের এন্ট্রি দেখবে
  const seeAll = false;
  const [received, setReceived] = useState<Recv[]>([]);
  const [handovers, setHandovers] = useState<Hand[]>([]);
  const [expenses, setExpenses] = useState<Exp[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [latestInput, setLatestInput] = useState("10");
  const [dateFrom, setDateFrom] = useState(today());
  const [dateTo, setDateTo] = useState(today());
  const [printOrientation, setPrintOrientation] = useState<"portrait" | "landscape">("portrait");
  const [printPaper, setPrintPaper] = useState<"A4" | "A5" | "Letter" | "Legal">("A4");
  const [printOpen, setPrintOpen] = useState(false);
  
  const [dayFrom, setDayFrom] = useState(today());
  const [dayTo, setDayTo] = useState(today());
  // Optional: limit the daily-closing report to the latest N entries
  const [dayLastN, setDayLastN] = useState("");
  // Optional: dates whose detail rows are hidden (left blank) in the daily-closing
  // print. Balance still flows through them internally; they just don't render.
  const [hiddenDays, setHiddenDays] = useState<string[]>([]);
  // Optional vendor / agency balance sections appended to the print
  const [incVendors, setIncVendors] = useState(false);
  const [incAgencies, setIncAgencies] = useState(false);
  // Optional payment-method breakdown section
  const [incMethods, setIncMethods] = useState(false);
  const [selMethods, setSelMethods] = useState<Set<string>>(new Set());
  const [vendorBals, setVendorBals] = useState<{ name: string; due: number; advance: number }[]>([]);
  const [agencyBals, setAgencyBals] = useState<{ name: string; due: number; advance: number }[]>([]);
  const [selVendors, setSelVendors] = useState<Set<string>>(new Set());
  const [selAgencies, setSelAgencies] = useState<Set<string>>(new Set());
  const [balLoading, setBalLoading] = useState(false);

  const printRef = useRef<HTMLDivElement>(null);
  const reloadSeqRef = useRef(0);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dialog forms
  
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTab, setManualTab] = useState<"income" | "expense">("income");
  const [eForm, setEForm] = useState({ entry_date: today(), category: "Office", purpose: "", amount: "", remarks: "" });
  const [iForm, setIForm] = useState({ entry_date: today(), passenger_name: "", amount: "", method: "Cash", remarks: "" });
  const [savingIncome, setSavingIncome] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);


  const reload = useCallback(async (quiet = false) => {
    if (!user?.id) return;
    const seq = reloadSeqRef.current + 1;
    reloadSeqRef.current = seq;
    if (!quiet) setSyncing(true);

    const parsedLimit = /^\d+$/.test(latestInput.trim()) ? Math.max(parseInt(latestInput.trim(), 10), 1) : 1000;
    let recvQuery = supabase.from("payment_receipts").select("id,receipt_id,entry_date,created_at,service_type,service_table,service_row_id,ref_id,passenger_name,amount,method,source,remarks,received_by,handover_id").not("source", "eq", "discount").not("method", "ilike", "discount").order("created_at", { ascending: false });
    let handQuery = supabase.from("cash_handovers").select("id,handover_id,entry_date,created_at,to_name,from_name,amount,method,remarks,from_user,status,submitted_amount,confirmed_amount,closing_date,approved_at,approved_by").order("created_at", { ascending: false });
    let expQuery  = supabase.from("cash_expenses").select("id,expense_id,entry_date,created_at,category,purpose,amount,remarks,spent_by,handover_id,linked_source_table,linked_source_id").order("created_at", { ascending: false });

    // Load the opening history too. The visible list is still filtered below,
    // but "হাতে আছে" must be the real running cash balance as of dateTo — not
    // only this period's net. Otherwise a previous handover inside today's
    // filter incorrectly reduces today's newly received cash.
    // Upper bound = max(dateTo, dayTo). dateTo scopes the visible timeline, but the
    // daily-closing print scopes by dayTo — if dayTo > dateTo we must still load those
    // extra days' rows, otherwise the closing report silently shows incomplete data.
    const loadUpto = [dateTo, dayTo].filter(Boolean).sort().slice(-1)[0];
    if (loadUpto) {
      recvQuery = recvQuery.lte("entry_date", loadUpto);
      handQuery = handQuery.lte("entry_date", loadUpto);
      expQuery = expQuery.lte("entry_date", loadUpto);
    }
    const historyLimit = Math.max(parsedLimit, 5000);
    recvQuery = recvQuery.limit(historyLimit);
    handQuery = handQuery.limit(historyLimit);
    expQuery = expQuery.limit(historyLimit);

    // Offline: hydrate from the cached snapshots written by "অফলাইনে সেভ".
    if (isOffline()) {
      const mineOnly = <T extends Record<string, unknown>>(rows: T[], cols: string[]) =>
        seeAll ? rows : rows.filter((row) => cols.some((c) => String(row[c] ?? "") === user.id));
      const byDate = <T extends Record<string, unknown>>(rows: T[]) =>
        dateTo ? rows.filter((row) => String(row.entry_date ?? "") <= dateTo) : rows;
      const recvCache = (cacheRead<Recv[]>("payment_receipts") ?? []).filter(
        (row) => String((row as unknown as Record<string, unknown>).source ?? "") !== "discount" &&
          !String((row as unknown as Record<string, unknown>).method ?? "").toLowerCase().includes("discount"),
      );
      if (seq !== reloadSeqRef.current) return;
      setReceived(byDate(mineOnly(recvCache as unknown as Record<string, unknown>[], ["received_by", "created_by"])) as unknown as Recv[]);
      setHandovers(byDate(mineOnly((cacheRead<Hand[]>("cash_handovers") ?? []) as unknown as Record<string, unknown>[], ["from_user", "created_by"])) as unknown as Hand[]);
      setExpenses(byDate(mineOnly((cacheRead<Exp[]>("cash_expenses") ?? []) as unknown as Record<string, unknown>[], ["spent_by", "created_by"])) as unknown as Exp[]);
      setSyncing(false);
      setLoading(false);
      return;
    }

    const [r, h, e] = await Promise.all([
      seeAll ? recvQuery : recvQuery.or(`received_by.eq.${user.id},created_by.eq.${user.id}`),
      seeAll ? handQuery : handQuery.or(`from_user.eq.${user.id},created_by.eq.${user.id}`),
      seeAll ? expQuery  : expQuery.or(`spent_by.eq.${user.id},created_by.eq.${user.id}`),
    ]);


    const err = r.error || h.error || e.error;
    if (seq !== reloadSeqRef.current) return;
    if (err) {
      if (!quiet) toast.error("সিঙ্ক সমস্যা: " + err.message);
    }
    setReceived(r.error ? [] : (((r.data as unknown) as Recv[]) ?? []));
    setHandovers(h.error ? [] : (((h.data as unknown) as Hand[]) ?? []));
    setExpenses(e.error ? [] : (((e.data as unknown) as Exp[]) ?? []));

    setSyncing(false);
    setLoading(false);
  }, [user?.id, seeAll, dateTo, dayTo, latestInput]);

  useEffect(() => {
    void reload(true);
    // Debounce realtime refreshes: any change across the 3 tables (from ANY
    // user) used to trigger an immediate full reload (5000 rows × 3 tables).
    // Bursts of changes caused the UI to freeze. Coalesce them into one reload.
    const scheduleReload = () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => { void reload(true); }, 1200);
    };
    const ch = supabase.channel("my_acct_v1")
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_receipts" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_handovers" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_expenses" }, scheduleReload)
      .subscribe();
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      supabase.removeChannel(ch);
    };
  }, [user?.id, reload]);


  // Filter mode: date range takes priority over latest-N
  const parsedN = /^\d+$/.test(latestInput.trim()) ? parseInt(latestInput.trim(), 10) : NaN;
  const latestN = Number.isFinite(parsedN) && parsedN > 0 ? parsedN : 0;
  const useDateFilter = !!(dateFrom || dateTo);
  const isInvalidInput = !useDateFilter && latestN === 0;
  const inDateRange = useCallback((d: string) => {
    if (!d) return false;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  }, [dateFrom, dateTo]);

  // Service detail map (for timeline secondary text & due display)
   type SvcDetail = {
     country?: string | null; route?: string | null; airline?: string | null;
     service_name?: string | null; passport?: string | null;
     flight_date?: string | null; vendor?: string | null; cost?: number;
      sold?: number; received_total?: number; discount?: number; agent?: string | null;
      delivery_date?: string | null; has_delivery?: boolean;
      srcTable?: string | null; srcId?: string | null;
   };
  const [svcMap, setSvcMap] = useState<Record<string, SvcDetail>>({});

  useEffect(() => {
    const byTable: Record<string, Set<string>> = {};
    for (const r of received) {
      if (!r.service_row_id || !r.service_table) continue;
      (byTable[r.service_table] ||= new Set()).add(r.service_row_id);
    }
    const tableConfigs: Record<string, { cols: string; map: (row: Record<string, unknown>) => SvcDetail }> = {
      tickets: {
        cols: "id,passport,airline,trip_road,flight_date,vendor_bought,agency_sold,sold_price,cost_price,received,discount_amount",
        map: (r) => ({ passport: r.passport as string, airline: r.airline as string, route: r.trip_road as string, flight_date: r.flight_date as string, vendor: r.vendor_bought as string, agent: r.agency_sold as string, cost: Number(r.cost_price ?? 0), sold: Number(r.sold_price ?? 0), received_total: Number(r.received ?? 0), discount: Number(r.discount_amount ?? 0), has_delivery: false }),
      },
      bmet_cards: {
        cols: "id,passport,country_name,vendor_bought,agency_sold,sold_price,cost_price,received_amount,discount_amount,delivery_date",
        map: (r) => ({ passport: r.passport as string, country: r.country_name as string, vendor: r.vendor_bought as string, agent: r.agency_sold as string, cost: Number(r.cost_price ?? 0), sold: Number(r.sold_price ?? 0), received_total: Number(r.received_amount ?? 0), discount: Number(r.discount_amount ?? 0), delivery_date: r.delivery_date as string, has_delivery: true }),
      },
      saudi_visas: {
        cols: "id,passport,vendor_bought,agency_sold,sold_price,cost_price,received_amount,discount_amount,delivery_date",
        map: (r) => ({ passport: r.passport as string, country: "Saudi Arabia", vendor: r.vendor_bought as string, agent: r.agency_sold as string, cost: Number(r.cost_price ?? 0), sold: Number(r.sold_price ?? 0), received_total: Number(r.received_amount ?? 0), discount: Number(r.discount_amount ?? 0), delivery_date: r.delivery_date as string, has_delivery: true }),
      },
      kuwait_visas: {
        cols: "id,passport,vendor_bought,agency_sold,sold_price,cost_price,received,discount_amount,delivery_date",
        map: (r) => ({ passport: r.passport as string, country: "Kuwait", vendor: r.vendor_bought as string, agent: r.agency_sold as string, cost: Number(r.cost_price ?? 0), sold: Number(r.sold_price ?? 0), received_total: Number(r.received ?? 0), discount: Number(r.discount_amount ?? 0), delivery_date: r.delivery_date as string, has_delivery: true }),
      },
      others: {
        cols: "id,passport,service_name,airline,trip_road,flight_date,vendor_bought,agency_sold,sold_price,cost_price,received_amount,discount_amount,delivery_date",
        map: (r) => ({ passport: r.passport as string, service_name: r.service_name as string, airline: r.airline as string, route: r.trip_road as string, flight_date: r.flight_date as string, vendor: r.vendor_bought as string, agent: r.agency_sold as string, cost: Number(r.cost_price ?? 0), sold: Number(r.sold_price ?? 0), received_total: Number(r.received_amount ?? 0), discount: Number(r.discount_amount ?? 0), delivery_date: r.delivery_date as string, has_delivery: true }),
      },
      // Agency-ledger receipts: the receipt points at the ledger row, which holds
      // the customer/agent/bill. Vendor + cost come from a 2nd hop (source_table).
      agency_ledger: {
        cols: "id,agent_name,passenger_name,service_type,country_route,passport,total_bill,received_amount,discount_amount,source_table,source_id",
        map: (r) => ({ passport: r.passport as string, country: r.country_route as string, service_name: humanizeServiceType(r.service_type as string), agent: r.agent_name as string, sold: Number(r.total_bill ?? 0), received_total: Number(r.received_amount ?? 0), discount: Number(r.discount_amount ?? 0), has_delivery: false, srcTable: r.source_table as string, srcId: r.source_id as string }),
      },
      extra_services: {
        cols: "id,passport,service_name,vendor_name,vendor_cost,agency_sold,service_price,received_amount,discount_amount",
        map: (r) => ({ passport: r.passport as string, service_name: r.service_name as string, vendor: r.vendor_name as string, agent: r.agency_sold as string, cost: Number(r.vendor_cost ?? 0), sold: Number(r.service_price ?? 0), received_total: Number(r.received_amount ?? 0), discount: Number(r.discount_amount ?? 0), has_delivery: false }),
      },
    };
    let cancelled = false;
    const offline = isOffline();
    // Pull rows by id either from the network or the offline snapshots.
    const fetchRowsByIds = async (table: string, ids: string[]): Promise<Record<string, unknown>[]> => {
      if (!ids.length) return [];
      if (offline) {
        // module tables -> cache_v2_<table>; agency_ledger/extra_services -> off_<table>
        const snap = table === "agency_ledger" || table === "extra_services"
          ? (cacheRead<Record<string, unknown>[]>(table) ?? [])
          : readModuleCache(table);
        const idSet = new Set(ids);
        return snap.filter((row) => idSet.has(String((row as Record<string, unknown>).id ?? ""))) as Record<string, unknown>[];
      }
      return [];
    };
    (async () => {
      const out: Record<string, SvcDetail> = {};
      await Promise.all(Object.entries(byTable).map(async ([table, ids]) => {
        const cfg = tableConfigs[table]; if (!cfg || ids.size === 0) return;
        const rows = offline
          ? await fetchRowsByIds(table, Array.from(ids))
          : ((await supabase.from(table as never).select(cfg.cols).in("id", Array.from(ids))).data as unknown as Record<string, unknown>[] | null) ?? [];
        for (const row of rows) {
          out[String(row.id)] = cfg.map(row);
        }
      }));
      // 2nd hop: agency-ledger rows reference an underlying booking; fetch its
      // vendor + cost so column 5 (vendor / vendor cost) is filled for ledger receipts.
      const srcByTable: Record<string, Set<string>> = {};
      for (const det of Object.values(out)) {
        if (det.srcTable && det.srcId && det.vendor == null) {
          (srcByTable[det.srcTable] ||= new Set()).add(det.srcId);
        }
      }
      if (Object.keys(srcByTable).length > 0) {
        const vendorById: Record<string, { vendor?: string | null; cost?: number }> = {};
        await Promise.all(Object.entries(srcByTable).map(async ([table, ids]) => {
          const rows = offline
            ? await fetchRowsByIds(table, Array.from(ids))
            : ((await supabase.from(table as never).select("id,vendor_bought,cost_price").in("id", Array.from(ids))).data as unknown as Record<string, unknown>[] | null) ?? [];
          for (const row of rows) {
            vendorById[String(row.id)] = { vendor: row.vendor_bought as string, cost: Number(row.cost_price ?? 0) };
          }
        }));
        for (const det of Object.values(out)) {
          if (det.srcTable && det.srcId && det.vendor == null) {
            const v = vendorById[det.srcId];
            if (v) { det.vendor = v.vendor; det.cost = v.cost; }
          }
        }
      }
      if (!cancelled) setSvcMap(out);
    })();
    return () => { cancelled = true; };
  }, [received]);

  const accountingReceived = useMemo(() => received.filter((r) => !isStatusEventReceipt(r)), [received]);

  // Multi-method Due Receive collapses to ONE displayed row so /accounts shows
  // one line for e.g. TKT-2607-054 even though it was received in Cash + bKash.
  type BatchInfo = {
    parts: Recv[]; anchorId: string; cashAmt: number; mdAmt: number; vendorAmt: number;
    totalAmt: number; methods: string[]; partIds: Set<string>;
  };
  const receiptBatches = useMemo(() => {
    const m = new Map<string, BatchInfo>();
    const rk = (r: Recv) => `${r.entry_date ?? ""}|${(r as Recv & { created_at?: string }).created_at ?? r.entry_date ?? ""}|${r.id}`;
    const anchorRank = new Map<string, string>();
    for (const r of accountingReceived) {
      const k = receiptBatchKey(r);
      let b = m.get(k);
      if (!b) {
        b = { parts: [], anchorId: r.id, cashAmt: 0, mdAmt: 0, vendorAmt: 0, totalAmt: 0, methods: [], partIds: new Set() };
        m.set(k, b);
      }
      b.parts.push(r);
      b.partIds.add(r.id);
      const amt = Number(r.amount || 0);
      b.totalAmt += amt;
      if (isVendorReceivedMethod(r.method)) b.vendorAmt += amt;
      else if (isMdReceivedMethod(r.method)) b.mdAmt += amt;
      else b.cashAmt += amt;
      if (r.method) b.methods.push(r.method);
      const cur = anchorRank.get(k);
      const rank = rk(r);
      if (!cur || rank > cur) { anchorRank.set(k, rank); b.anchorId = r.id; }
    }
    // De-dupe methods list per batch
    for (const b of m.values()) b.methods = uniq(b.methods);
    return m;
  }, [accountingReceived]);

  // Returns per-row payment breakdown. For single-method receipts this mirrors
  // the raw row; for a multi-method batch it aggregates every sibling and marks
  // exactly ONE row as the anchor (the one that actually renders).
  const combinedRecv = useCallback((r: Recv) => {
    const b = receiptBatches.get(receiptBatchKey(r));
    if (b && b.parts.length > 1) {
      return {
        isBatch: true, isAnchor: b.anchorId === r.id, parts: b.parts, partIds: b.partIds,
        cashAmt: b.cashAmt, mdAmt: b.mdAmt, vendorAmt: b.vendorAmt, totalAmt: b.totalAmt, methods: b.methods,
      };
    }
    const amt = Number(r.amount || 0);
    return {
      isBatch: false, isAnchor: true, parts: [r], partIds: new Set([r.id]),
      cashAmt: isCashMethod(r.method) ? amt : 0,
      mdAmt: isMdReceivedMethod(r.method) ? amt : 0,
      vendorAmt: isVendorReceivedMethod(r.method) ? amt : 0,
      totalAmt: amt,
      methods: r.method ? [r.method] : [],
    };
  }, [receiptBatches]);

  const fRecv = useMemo(() => useDateFilter ? accountingReceived.filter(r => inDateRange(r.entry_date)) : accountingReceived.slice(0, latestN), [accountingReceived, latestN, useDateFilter, inDateRange]);
  const fHand = useMemo(() => useDateFilter ? handovers.filter(h => inDateRange(h.entry_date)) : handovers.slice(0, latestN), [handovers, latestN, useDateFilter, inDateRange]);
  const fExp  = useMemo(() => useDateFilter ? expenses.filter(e => inDateRange(e.entry_date)) : expenses.slice(0, latestN), [expenses, latestN, useDateFilter, inDateRange]);
  const isHandoverSubmitted = (h: Hand) => Boolean(h.submitted_amount !== null && h.submitted_amount !== undefined) || Boolean(h.closing_date) || (h.status ?? "approved") === "pending";
  const statusByService = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of received) {
      if (!isStatusEventReceipt(r) || !r.service_table || !r.service_row_id) continue;
      out[`${r.service_table}:${r.service_row_id}`] = cleanStatusText(r.remarks);
    }
    return out;
  }, [received]);
  const hasMoneyReceiptForService = useMemo(() => {
    const out = new Set<string>();
    for (const r of received) {
      if (isStatusEventReceipt(r) || !r.service_table || !r.service_row_id || Number(r.amount || 0) <= 0) continue;
      out.add(`${r.service_table}:${r.service_row_id}`);
    }
    return out;
  }, [received]);
  const displayRecv = useMemo(() => fRecv.filter((r) => {
    if (!isStatusEventReceipt(r) || !r.service_table || !r.service_row_id) return true;
    return !hasMoneyReceiptForService.has(`${r.service_table}:${r.service_row_id}`);
  }), [fRecv, hasMoneyReceiptForService]);

  // Only Cash receipts add to the staff's balance. Non-cash (bKash, Nagad, Md cash…)
  // go straight to MD — kept as entries but excluded from balance.
  const periodIncome = fRecv.reduce((s, r) => s + (isCashMethod(r.method) ? Number(r.amount || 0) : 0), 0);
  const periodMdIncome = fRecv.reduce((s, r) => s + (isMdReceivedMethod(r.method) ? Number(r.amount || 0) : 0), 0);
  const periodVendorIncome = fRecv.reduce((s, r) => s + (isVendorReceivedMethod(r.method) ? Number(r.amount || 0) : 0), 0);
  // Method-wise receive breakdown for the current print scope (list of methods actually used)
  const methodBreakdown = useMemo(() => {
    const map = new Map<string, { method: string; count: number; total: number }>();
    for (const r of fRecv) {
      const m = (r.method ?? "").trim() || "Cash";
      const cur = map.get(m) ?? { method: m, count: 0, total: 0 };
      cur.count += 1;
      cur.total += Number(r.amount || 0);
      map.set(m, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [fRecv]);
  const periodHand   = fHand.filter((h) => handoverReducesBalance(h.status)).reduce((s, h) => s + Number(h.amount || 0), 0);
  const expenseHitsBalance = (e: Exp) =>
    e.linked_source_table === "vendor_ledger" ? vendorExpenseHitsUserBalance(e.category) : true;
  const periodExp    = fExp.reduce((s, e) => s + (expenseHitsBalance(e) ? Number(e.amount || 0) : 0), 0);
  // A vendor payment made by a non-cash method (Bank Transfer, MD Sir Deposit,
  // bKash…) does NOT leave the staff's cash drawer — only Cash-method vendor
  // payments reduce cash-in-hand. Manual/office expenses always reduce it.
  const balance = useMemo(() => {
    // "হাতে আছে" = cash balance AS OF dateTo. Rows may now be loaded past dateTo
    // (to feed the daily-closing print's dayTo range), so cap here to keep the
    // card accurate regardless of the wider load window.
    const upto = (d?: string) => !dateTo || String(d ?? "") <= dateTo;
    const cashIn = received.reduce((s, r) => s + (upto(r.entry_date) && isCashMethod(r.method) ? Number(r.amount || 0) : 0), 0);
    const cashOut = handovers
      .filter((h) => upto(h.entry_date) && handoverReducesBalance(h.status))
      .reduce((s, h) => s + Number(h.amount || 0), 0);
    const spent = expenses.reduce((s, e) => s + (upto(e.entry_date) && expenseHitsBalance(e) ? Number(e.amount || 0) : 0), 0);
    return cashIn - cashOut - spent;
  }, [received, handovers, expenses, dateTo]);

  // Build full chronological timeline (all data) with running balance from 0
  type TLItem =
    | { kind: "received"; date: string; row: Recv }
    | { kind: "handover"; date: string; row: Hand }
    | { kind: "expense";  date: string; row: Exp };

  const fullAsc = useMemo<(TLItem & { running: number; created: string })[]>(() => {
    const items: (TLItem & { created: string })[] = [
      ...accountingReceived.map((r) => ({ kind: "received" as const, date: r.entry_date, row: r, created: (r as Recv & { created_at?: string }).created_at ?? r.entry_date })),
      ...handovers.map((h) => ({ kind: "handover" as const, date: h.entry_date, row: h, created: (h as Hand & { created_at?: string }).created_at ?? h.entry_date })),
      ...expenses.map((e) => ({ kind: "expense"  as const, date: e.entry_date, row: e, created: (e as Exp & { created_at?: string }).created_at ?? e.entry_date })),
    ];
    items.sort((a, b) => (a.date === b.date ? a.created.localeCompare(b.created) : a.date.localeCompare(b.date)));
    let bal = 0;
    return items.map((it) => {
      // Non-cash (MD-received) income does NOT change the running balance.
      if (it.kind === "received") bal += isCashMethod((it.row as Recv).method) ? Number(it.row.amount) : 0;
      else if (it.kind === "handover") bal -= handoverReducesBalance(it.row.status) ? Number(it.row.amount) : 0;
      else bal -= expenseHitsBalance(it.row as Exp) ? Number(it.row.amount) : 0;
      return { ...it, running: bal };
    });
  }, [accountingReceived, handovers, expenses]);

  // Distinct dates within the daily-closing date filter — used to let the user
  // tick which dates' details to leave blank in the print.
  const rangeDates = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const it of fullAsc) {
      if (dayFrom && it.date < dayFrom) continue;
      if (dayTo && it.date > dayTo) continue;
      set.add(it.date);
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [fullAsc, dayFrom, dayTo]);

  // Drop hidden dates that fall outside the current range when it changes.
  useEffect(() => {
    setHiddenDays((prev) => prev.filter((d) => rangeDates.includes(d)));
  }, [rangeDates]);

  const timeline = useMemo<(TLItem & { running: number })[]>(() => {
    const desc = [...fullAsc].reverse().filter((it) => {
      if (it.kind !== "received") return true;
      const r = it.row as Recv;
      if (!isStatusEventReceipt(r) || !r.service_table || !r.service_row_id) return true;
      return !hasMoneyReceiptForService.has(`${r.service_table}:${r.service_row_id}`);
    });
    if (useDateFilter) return desc.filter(it => inDateRange(it.date));
    if (latestN === 0) return [];
    return desc.slice(0, latestN);
  }, [fullAsc, latestN, useDateFilter, inDateRange, hasMoneyReceiptForService]);

  // Print rows — receipts (আয়) big→small then খরচ, but split into segments by
  // cash handover: each handover sits chronologically between the transactions
  // before it and after it (not lumped at the very bottom anymore).
  // Running balance is SCOPED to these printed entries only (starts from 0).
  const printAscRows = useMemo<{ it: TLItem & { running: number }; running: number }[]>(() => {
    const ordered = segmentByHandover(timeline as (TLItem & { running: number; created?: string })[]);
    let bal = 0;
    return ordered.map((it) => {
      if (it.kind === "received") bal += isCashMethod((it.row as Recv).method) ? Number((it.row as Recv).amount) : 0;
      else if (it.kind === "handover") bal -= handoverReducesBalance((it.row as Hand).status) ? Number((it.row as Hand).amount) : 0;
      else bal -= expenseHitsBalance(it.row as Exp) ? Number((it.row as Exp).amount) : 0;
      return { it, running: bal };
    });
  }, [timeline]);


  // Save expense
  const saveExpense = async () => {
    if (savingExpense) return;
    if (!user?.id) return toast.error("লগ-ইন করুন");
    const amt = Number(eForm.amount);
    if (!amt || amt <= 0) return toast.error("সঠিক টাকার পরিমাণ দিন");
    setSavingExpense(true);
    try {
      const { data: idData, error: idErr } = await supabase.rpc("next_module_id" as never, { _prefix: "EXP", _table: "cash_expenses", _column: "expense_id" } as never);
      if (idErr) return toast.error(idErr.message);
      const { error } = await supabase.from("cash_expenses").insert({
        expense_id: idData as unknown as string,
        entry_date: eForm.entry_date,
        spent_by: user.id,
        spent_by_name: displayName(profile, user),
        category: eForm.category,
        purpose: eForm.purpose || null,
        amount: amt,
        remarks: eForm.remarks || null,
        created_by: user.id,
      });
      if (error) return toast.error(error.message);
      toast.success("✓ খরচ সংরক্ষিত");
      setEForm({ entry_date: today(), category: "Office", purpose: "", amount: "", remarks: "" });
      setManualOpen(false);
      void reload(true);
    } finally {
      setSavingExpense(false);
    }
  };

  // Save manual income (payment_receipts with source="manual")
  const saveManualIncome = async () => {
    if (savingIncome) return;
    if (!user?.id) return toast.error("লগ-ইন করুন");
    const amt = Number(iForm.amount);
    if (!amt || amt <= 0) return toast.error("সঠিক টাকার পরিমাণ দিন");
    setSavingIncome(true);
    try {
      const receiptId = await generateNextId({
        key: "_rcpt", label: "", short: "", table: "payment_receipts",
        idColumn: "receipt_id", idPrefix: "RCPT", monthlyId: true, fields: [],
      });
      const me = displayName(profile, user);
      const { error } = await supabase.from("payment_receipts").insert({
        receipt_id: receiptId,
        entry_date: iForm.entry_date,
        service_type: "Manual",
        service_table: null,
        service_row_id: null,
        ref_id: null,
        passenger_name: iForm.passenger_name || "Manual Entry",
        amount: amt,
        method: iForm.method,
        source: "manual",
        remarks: iForm.remarks || null,
        received_by: user.id,
        received_by_name: me,
        created_by: user.id,
      } as never);
      if (error) return toast.error(error.message);
      toast.success("✓ আয় সংরক্ষিত");
      setIForm({ entry_date: today(), passenger_name: "", amount: "", method: "Cash", remarks: "" });
      setManualOpen(false);
      void reload(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingIncome(false);
    }
  };

  const deleteHand = async (id: string): Promise<void> => {
    const { data, error } = await supabase.from("cash_handovers").delete().eq("id", id).select("id").maybeSingle();
    if (error) { toast.error(error.message); return; }
    if (!data) { toast.error("ডিলেট হয়নি — অনুমতি বা রেকর্ড মিলছে না"); return; }
    toast.success("ডিলেট সম্পন্ন");
    void reload(true);
  };
  const deleteRecv = async (id: string): Promise<void> => {
    const { error } = await supabase.rpc("delete_payment_receipt_and_revert" as never, { _receipt_id: id } as never);
    if (error) {
      toast.error("ডিলেট ব্যর্থ: " + error.message);
      return;
    }

    toast.success("ডিলেট সম্পন্ন");
    await reload(true);
  };
  const deleteExp = async (id: string): Promise<void> => {
    const { data, error } = await supabase.from("cash_expenses").delete().eq("id", id).select("id").maybeSingle();
    if (error) { toast.error(error.message); return; }
    if (!data) { toast.error("ডিলেট হয়নি — অনুমতি বা রেকর্ড মিলছে না"); return; }
    toast.success("ডিলেট সম্পন্ন");
    void reload(true);
  };

  // CSS @page size keyword for the chosen paper
  const PAPER_CSS: Record<string, string> = { A4: "A4", A5: "A5", Letter: "letter", Legal: "legal" };
  const escHtml = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Load vendor + agency balances for the print selection list
  const loadPartyBalances = useCallback(async () => {
    setBalLoading(true);
    try {
      let v: { data: unknown };
      let a: { data: unknown };
      if (isOffline()) {
        v = { data: cacheRead("bal_vendor") ?? [] };
        a = { data: cacheRead("bal_agent") ?? [] };
      } else {
        [v, a] = await Promise.all([
          supabase.rpc("get_vendor_balances" as never),
          supabase.rpc("get_agent_balances" as never),
        ]);
      }
      const rank = (r: { due: number; advance: number }) => (r.advance > 0 ? 0 : r.due > 0 ? 1 : 2);
      const srt = (x: { name: string; due: number; advance: number }, y: { name: string; due: number; advance: number }) => {
        const rr = rank(x) - rank(y);
        if (rr !== 0) return rr;
        const xv = x.advance > 0 ? x.advance : x.due;
        const yv = y.advance > 0 ? y.advance : y.due;
        return yv - xv;
      };
      const vrows = (((v.data as unknown) as { vendor_name: string; balance_due: number; advance_balance: number }[]) ?? [])
        .map((r) => ({ name: String(r.vendor_name ?? ""), due: Number(r.balance_due ?? 0), advance: Number(r.advance_balance ?? 0) }))
        .filter((r) => r.name && r.name.trim().toLowerCase() !== "self")
        .sort(srt);
      const arows = (((a.data as unknown) as { agent_name: string; balance_due: number; advance_balance: number }[]) ?? [])
        .map((r) => ({ name: String(r.agent_name ?? ""), due: Number(r.balance_due ?? 0), advance: Number(r.advance_balance ?? 0) }))
        .filter((r) => r.name && r.name.trim().toLowerCase() !== "self")
        .sort(srt);
      setVendorBals(vrows);
      setAgencyBals(arows);
      // default-select every party that has a non-zero balance
      setSelVendors(new Set(vrows.filter((r) => r.due > 0 || r.advance > 0).map((r) => r.name)));
      setSelAgencies(new Set(arows.filter((r) => r.due > 0 || r.advance > 0).map((r) => r.name)));
    } finally {
      setBalLoading(false);
    }
  }, []);

  // Build an appended balance section (vendor / agency) for the print
  const buildBalanceSection = (title: string, rows: { name: string; due: number; advance: number }[]): string => {
    if (!rows.length) return "";
    const body = rows.map((r, i) => {
      const bal = r.advance > 0
        ? `<span class="in">অগ্রিম ${fmt(r.advance)}</span>`
        : r.due > 0
          ? `<span class="due">বাকি ${fmt(r.due)}</span>`
          : `<span style="color:#888">0</span>`;
      return `<tr><td>${i + 1}</td><td class="wrap">${escHtml(r.name)}</td><td class="num">${bal}</td></tr>`;
    }).join("");
    const totalDue = rows.reduce((s, r) => s + (r.due > 0 ? r.due : 0), 0);
    const totalAdv = rows.reduce((s, r) => s + (r.advance > 0 ? r.advance : 0), 0);
    return `<div style="margin-top:12px;break-inside:avoid">
      <div style="font-weight:800;font-size:12px;margin-bottom:3px;border-bottom:1.5px solid #111;padding-bottom:2px">${title}</div>
      <table>
        <thead><tr><th>#</th><th>নাম</th><th class="num">ব্যালেন্স</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><td colspan="2">মোট — বাকি / অগ্রিম</td><td class="num"><span class="due">${fmt(totalDue)}</span> / <span class="in">${fmt(totalAdv)}</span></td></tr></tfoot>
      </table>
    </div>`;
  };

  // Method-wise receive breakdown section for the print (selection-aware)
  const buildMethodSection = (): string => {
    const rows = methodBreakdown.filter((m) => selMethods.has(m.method));
    if (!rows.length) return "";
    const body = rows.map((r, i) =>
      `<tr><td>${i + 1}</td><td class="wrap">${escHtml(r.method)}</td><td class="num">${r.count}</td><td class="num"><span class="in">${fmt(r.total)}</span></td></tr>`
    ).join("");
    const totalCount = rows.reduce((s, r) => s + r.count, 0);
    const totalAmt = rows.reduce((s, r) => s + r.total, 0);
    return `<div style="margin-top:12px;break-inside:avoid">
      <div style="font-weight:800;font-size:12px;margin-bottom:3px;border-bottom:1.5px solid #111;padding-bottom:2px">পেমেন্ট রিসিভ মেথড অনুযায়ী হিসাব</div>
      <table>
        <thead><tr><th>#</th><th>মেথড</th><th class="num">সংখ্যা</th><th class="num">পরিমাণ</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><td colspan="2">মোট</td><td class="num">${totalCount}</td><td class="num"><span class="in">${fmt(totalAmt)}</span></td></tr></tfoot>
      </table>
    </div>`;
  };

  // Combined optional vendor + agency sections (selection-aware)
  const partySectionsHtml = (): string => {
    let out = "";
    if (incVendors) out += buildBalanceSection("Vendor (ভেন্ডর) ব্যালেন্স", vendorBals.filter((r) => selVendors.has(r.name)));
    if (incAgencies) out += buildBalanceSection("Agency (এজেন্সি) ব্যালেন্স", agencyBals.filter((r) => selAgencies.has(r.name)));
    if (incMethods) out += buildMethodSection();
    return out;
  };

  // Print timeline
  const buildTimelineHtml = (): string | null => {
    const node = printRef.current;
    if (!node) return null;
    const periodLabel = useDateFilter
      ? `${dateFrom || "শুরু"} → ${dateTo || "এখন"}`
      : `সর্বশেষ ${latestN} লেনদেন`;
    const totals = timeline.reduce(
      (acc, it) => {
        const amt = Number((it.row as { amount: number }).amount || 0);
        if (it.kind === "received") {
          if (isCashMethod((it.row as Recv).method)) acc.inAmt += amt;
          else if (isVendorReceivedMethod((it.row as Recv).method)) acc.vendorAmt += amt;
          else acc.mdAmt += amt;
        }
        else if (it.kind === "handover") acc.outAmt += handoverReducesBalance((it.row as Hand).status) ? amt : 0;
        else acc.outAmt += expenseHitsBalance(it.row as Exp) ? amt : 0;
        return acc;
      },
      { inAmt: 0, outAmt: 0, mdAmt: 0, vendorAmt: 0 },
    );
    // Balance shown on the print is SCOPED to the filtered entries (net of the
    // printed lines only), so it never carries the historical 38,000 balance.
    const scopedBalance = totals.inAmt - totals.outAmt;
    const printedAt = new Date();
    const stamp = `${formatDate(today())} · ${printedAt.toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" })}`;
    const printedBy = displayName(profile, user);
    return `<!doctype html><html><head><meta charset="utf-8"><title>আজকের হিসাব- এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্</title>
<style>
  @page{size:${PAPER_CSS[printPaper]} ${printOrientation};margin:8mm 5mm 24mm 5mm}
  body{font-family:'Noto Sans Bengali',system-ui,sans-serif;padding:4px;color:#111;margin:0;position:relative}
  body::before{content:"";position:fixed;inset:0;z-index:9999;pointer-events:none;background-image:url("${window.location.origin}${logoAsset.url}");background-repeat:no-repeat;background-position:center;background-size:55%;opacity:0.06;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .brand{display:flex;justify-content:space-between;align-items:flex-end;gap:8px;border-bottom:2px solid #111;padding-bottom:4px;margin-bottom:6px}
  .brand .co{font-size:16px;font-weight:800}
  .brand .tag{font-size:10px;color:#555}
  .brand .sub{font-size:10px;color:#555;line-height:1.45;text-align:right;white-space:nowrap}
  .summary{display:flex;gap:5px;margin-bottom:6px;font-size:11px;font-weight:700;flex-wrap:wrap}
  .summary div{padding:3px 6px;border:1px solid #ddd;border-radius:4px;flex:1;min-width:90px}
  ${TIMELINE_PRINT_TABLE_CSS}
  .in{color:#059669}.out{color:#b45309}.hand{color:#0284c7}.due{color:#b91c1c}.vendor{color:#ea580c}
  tfoot td{font-weight:700;background:#fafafa}
  .finalbox{margin-top:8px;padding:6px 10px;border:2px solid #0369a1;border-radius:6px;background:#eef6ff;font-size:13px;font-weight:800;color:#0369a1;text-align:right}
  .printfooter{position:fixed;bottom:0;left:0;right:0;font-size:9px;color:#666;border-top:1px solid #ddd;padding:2px 4px;display:flex;justify-content:space-between}
  .printfooter .pageno::before{content:"পৃষ্ঠা " counter(page) " / " counter(pages)}
  @media print{body{padding:2px;padding-bottom:36px}}
</style></head><body>
<div class="brand">
  <div><div class="co">এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্</div><div class="tag">আজকের হিসাব — সম্পূর্ণ হিসাব প্রিন্ট</div></div>
  <div class="sub">সময়সীমা: ${periodLabel}<br>প্রিন্ট: ${stamp}<br>প্রিন্ট করেছেন: ${printedBy}<br>মোট ${timeline.length} এন্ট্রি</div>
</div>
<div class="summary">
  <div class="in">নগদ আয়: <b>+ ${fmt(totals.inAmt)}</b></div>
  ${totals.mdAmt > 0 ? `<div class="hand">MD রিসিভ: <b>${fmt(totals.mdAmt)}</b></div>` : ""}
  ${totals.vendorAmt > 0 ? `<div class="vendor">Vendor Rece: <b>${fmt(totals.vendorAmt)}</b></div>` : ""}
  <div class="out">খরচ/জমা: <b>− ${fmt(totals.outAmt)}</b></div>
  <div>নিট ব্যালেন্স: <b>${fmt(scopedBalance)}</b></div>
</div>
${node.innerHTML.replace(
  "<table>",
  `<table>${TIMELINE_PRINT_COLGROUP_HTML}`,
).replace(
  "</table>",
  `<tbody class="dategroup"><tr><td colspan="6" style="font-weight:700">Total</td>` +
  `<td class="num in" style="font-weight:700">+ ${fmt(totals.inAmt)}</td>` +
  `<td></td>` +
  `<td></td>` +
  `<td class="num out" style="font-weight:700">− ${fmt(totals.outAmt)}</td>` +
  `<td class="num" style="font-weight:700">${fmt(scopedBalance)}</td></tr></tbody></table>`
)}
<div class="finalbox">সর্বশেষ ক্লোজিং ব্যালেন্স: ${fmt(scopedBalance)}</div>
${partySectionsHtml()}
<div style="height:24px"></div>
<div class="printfooter"><span>এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্ · ${stamp}</span><span class="pageno"></span></div>
</body></html>`;
  };

  const handlePrint = () => {
    const html = buildTimelineHtml();
    if (!html) return;
    const period = useDateFilter
      ? `${dateFrom || "শুরু"}_to_${dateTo || today()}`
      : today();
    const docTitle = buildFileTitle("Accounts", "Summary", period);
    try {
      printDocHtml(html, docTitle);
      setPrintOpen(false);
    } catch {
      toast.error("পপ-আপ ব্লক হয়েছে");
    }
  };




  // Detailed range print: SAME layout/columns/text as the normal print, but
  // limited to a chosen date range AND with each day's CLOSING balance shown
  // after that day's transactions, then the next date's transactions below.
  const buildDetailRowHtml = (
    it: TLItem & { running: number },
    running: number,
    i: number,
    blank = false,
    seq?: number,
  ): string => {
    const isIn = it.kind === "received";
    const isHand = it.kind === "handover";
    const r = it.row as Recv; const h = it.row as Hand; const e = it.row as Exp;
    const statusEvt = isIn && isStatusEventReceipt(r);
    const batch = isIn && !statusEvt ? combinedRecv(r) : null;
    // Non-anchor sibling of a multi-method batch → don't render a row.
    if (batch && !batch.isAnchor) return "";
    const rawAmt = Number(isIn ? r.amount : isHand ? h.amount : e.amount);
    const amt = batch ? batch.totalAmt : rawAmt;
    const isMulti = !!batch && batch.isBatch;
    const cashAmt = batch?.cashAmt ?? 0;
    const mdAmt = batch?.mdAmt ?? 0;
    const vendorAmt = batch?.vendorAmt ?? 0;
    const mdRecv = isIn && !isMulti && isMdReceivedMethod(r.method) && !statusEvt;
    const vendorRecv = isIn && !isMulti && isVendorReceivedMethod(r.method) && !statusEvt;
    const svc = isIn && r.service_row_id ? svcMap[r.service_row_id] : undefined;
    const agencyFirst = (() => {
      const a = String(svc?.agent ?? "").trim();
      if (!a || a.toLowerCase() === "self") return "";
      return a.split(/\s+/)[0];
    })();
    const baseName = isIn ? r.passenger_name : isHand ? `ক্যাশ হ্যান্ডওভার: ${h.from_name ?? "প্রেরক"} → ${h.to_name}` : (e.purpose || e.category);
    const name = isIn && agencyFirst ? `${baseName} (${agencyFirst})` : baseName;
    const service = statusEvt ? `📦 ${cleanStatusText(r.remarks)}` : isIn ? (svc?.service_name || cleanServiceType(r.service_type)) : isHand ? "ক্যাশ হ্যান্ডওভার" : "খরচ";
    let region = "";
    if (isIn && svc) {
      if (r.service_table === "tickets") {
        region = [svc.route, svc.airline].filter(Boolean).join(" · ");
      } else if (r.service_table === "others") {
        region = [svc.airline, svc.route, svc.flight_date ? `✈ ${formatDate(svc.flight_date)}` : ""].filter(Boolean).join(" · ");
      } else if (svc.country) {
        region = svc.country;
      }
    }
    const discAmt = isIn && svc ? Number(svc.discount ?? 0) : 0;
    const grossBill = isIn && svc && typeof svc.sold === "number" ? svc.sold : null;
    const totalBill = grossBill !== null ? grossBill : null;
    const isAdvance = isIn && !!svc?.has_delivery && isAdvancePayment(r.entry_date, svc?.delivery_date);
    const advLines: string[] = [];
    let sumPrev = 0;
    let lastAdvDate = "";
    if (isIn && r.service_row_id) {
      const curDate = r.entry_date;
      const excludeIds = batch ? batch.partIds : new Set([r.id]);
      const prior = received.filter(p =>
        p.service_row_id === r.service_row_id &&
        !excludeIds.has(p.id) &&
        (p.entry_date < curDate || (p.entry_date === curDate && p.id < r.id))
      );
      for (const p of prior) {
        const pv = Number(p.amount || 0);
        sumPrev += pv;
        if (!lastAdvDate || p.entry_date > lastAdvDate) lastAdvDate = p.entry_date;
      }
      if (sumPrev > 0.005) advLines.push(`(৳${sumPrev.toLocaleString()}-Adv-${formatDate(lastAdvDate)})`);
    }
    if (discAmt > 0.005) advLines.push(`${fmt(discAmt)} Discount`);
    const due = totalBill !== null && isIn ? Math.max(0, totalBill - amt - sumPrev - discAmt) : null;
    const cls = isHand ? "hand" : "out";
    const methodStr = isMulti ? batch!.methods.join(" + ") : (r.method || "");
    const incomeText = isIn
      ? (statusEvt ? "Delivery" :
         isMulti
           ? `+ ${fmt(amt)}` +
              (cashAmt > 0 ? `<div class="in" style="font-size:0.85em">নগদ ${fmt(cashAmt)}</div>` : "") +
              (mdAmt > 0 ? `<div class="hand" style="font-size:0.85em">MD ${fmt(mdAmt)}</div>` : "") +
              (vendorAmt > 0 ? `<div class="vendor" style="font-size:0.85em">Vendor ${fmt(vendorAmt)}</div>` : "")
           : vendorRecv ? `(Vendor) ${fmt(amt)}`
           : mdRecv ? `(MD) ${fmt(amt)}`
           : `+ ${fmt(amt)}`)
      : "";
    const amtCls = isMulti ? "in" : vendorRecv ? "vendor" : mdRecv ? "hand" : "in";
    const textCellsHtml = renderTimelinePrintDataCellsHtml([
      { className: "wrap", html: name ?? "" },
      { className: "wrap", html: `${service}${isIn && !statusEvt && methodStr ? ` · ${methodStr}` : ""}` },
      { className: "wrap", html: `${region}${mdRecv ? " · MD রিসিভ" : ""}${vendorRecv ? " · Vendor Rece" : ""}` },
      { className: "num", html: totalBill !== null ? fmt(totalBill) : "" },
      { className: `num ${amtCls}`, html: `${incomeText}${!statusEvt && isAdvance ? " (Adv)" : ""}` },
      { className: "num due", html: due !== null && due > 0.005 ? `Due-${due.toLocaleString()}` : "" },
      { className: "prev", html: advLines.map(t => `<div>${t}</div>`).join("") },
      { className: `num ${cls}`, html: !isIn ? `− ${fmt(rawAmt)}` : "" },
      { className: "num", html: fmt(running), allowSpan: false },
    ]);
    return `<tr class="row-tint-${i % 4}${blank ? " blank" : ""}">` +
      `<td>${seq ?? i + 1}</td>` +
      `<td class="dt">${formatDate(it.date)}</td>` +
      textCellsHtml +
      `</tr>`;
  };

  const buildRangeClosingHtml = (): string | null => {
    if (dayFrom && dayTo && dayFrom > dayTo) {
      toast.error("শুরুর তারিখ শেষ তারিখের পরে হতে পারে না");
      return null;
    }

    // Collect ranged rows. Running balance is the TRUE cumulative balance from
    // the very beginning (carried in via "আগের জের"), so each day's closing is
    // the real cash in hand at end of that day.
    const rows: (TLItem & { running: number })[] = [];
    let opening = 0; // closing of the last day before dayFrom
    for (const it of fullAsc) {
      if (it.kind === "received") {
        const r = it.row as Recv;
        if (isStatusEventReceipt(r) && r.service_table && r.service_row_id &&
            hasMoneyReceiptForService.has(`${r.service_table}:${r.service_row_id}`)) continue;
      }
      if (dayFrom && it.date < dayFrom) { opening = it.running; continue; }
      if (dayTo && it.date > dayTo) continue;
      rows.push(it);
    }

    // Optional: keep only the latest N entries. The "আগের জের" (opening) then
    // becomes the true cumulative balance just before the first kept entry, so
    // every day's closing balance stays correct.
    const lastN = Math.floor(Number(dayLastN));
    if (Number.isFinite(lastN) && lastN > 0 && rows.length > lastN) {
      opening = rows[rows.length - lastN - 1].running;
      rows.splice(0, rows.length - lastN);
    }

    // Within each date: receipts (জমা) first then খরচ/handover, larger amount
    // first in each group. Recompute running balance from the carried opening
    // (use fresh objects so the memoized fullAsc rows are never mutated).
    {
      const amtOf = (it: TLItem) => Number((it.row as { amount?: number }).amount || 0);
      const dateOrder: string[] = [];
      const byDate = new Map<string, (TLItem & { running: number })[]>();
      for (const it of rows) {
        if (!byDate.has(it.date)) { byDate.set(it.date, []); dateOrder.push(it.date); }
        byDate.get(it.date)!.push(it);
      }
      const reordered: (TLItem & { running: number })[] = [];
      for (const d of dateOrder) {
        const grp = byDate.get(d)!;
        for (const it of segmentByHandover(grp)) reordered.push({ ...it });
      }
      let bal = opening;
      for (const it of reordered) {
        if (it.kind === "received") bal += isCashMethod((it.row as Recv).method) ? amtOf(it) : 0;
        else if (it.kind === "handover") bal -= handoverReducesBalance((it.row as Hand).status) ? amtOf(it) : 0;
        else bal -= expenseHitsBalance(it.row as Exp) ? amtOf(it) : 0;
        it.running = bal;
      }
      rows.splice(0, rows.length, ...reordered);
    }

    const totals = rows.reduce(
      (acc, it) => {
        const amt = Number((it.row as { amount: number }).amount || 0);
        if (it.kind === "received") {
          if (isCashMethod((it.row as Recv).method)) acc.inAmt += amt;
          else if (isVendorReceivedMethod((it.row as Recv).method)) acc.vendorAmt += amt;
          else acc.mdAmt += amt;
        }
        else if (it.kind === "handover") acc.outAmt += handoverReducesBalance((it.row as Hand).status) ? amt : 0;
        else acc.outAmt += expenseHitsBalance(it.row as Exp) ? amt : 0;
        return acc;
      },
      { inAmt: 0, outAmt: 0, mdAmt: 0, vendorAmt: 0 },
    );
    const finalClosing = rows.length ? rows[rows.length - 1].running : opening;
    const periodLabel = `${dayFrom || "শুরু"} → ${dayTo || "এখন"}`;

    // Body: each transaction row, plus a CLOSING row after the last entry of
    // every distinct date, then the next date's rows continue below.
    let bodyHtml = "";
    if (rows.length === 0) {
      bodyHtml = `<tbody><tr><td colspan="11" style="text-align:center;color:#888;padding:18px">এই সময়ে কোনো লেনদেন নেই</td></tr></tbody>`;
    } else {
      const hiddenSet = new Set(hiddenDays);
      let dayIn = 0;
      let dayMd = 0;
      let dayOut = 0;
      let daySeq = 0;
      let dayCount = 0;
      for (let i = 0; i < rows.length; i++) {
        const it = rows[i];
        const isHidden = hiddenSet.has(it.date);
        const prev = rows[i - 1];
        let isSibling = false;
        if (it.kind === "received") {
          const rr = it.row as Recv;
          if (!isStatusEventReceipt(rr)) {
            const b = combinedRecv(rr);
            if (b.isBatch && !b.isAnchor) isSibling = true;
          }
        }
        if (!prev || prev.date !== it.date) daySeq = 0;
        if (!isSibling) daySeq += 1;
        if (!prev || prev.date !== it.date) bodyHtml += `<tbody class="dategroup">`;
        const amt = Number((it.row as { amount: number }).amount || 0);
        if (it.kind === "received") {
          const rr = it.row as Recv;
          if (!isStatusEventReceipt(rr)) {
            const b = combinedRecv(rr);
            if (!b.isBatch || b.isAnchor) {
              dayCount += 1;
              if (b.isBatch) {
                dayIn += b.cashAmt;
                dayMd += b.mdAmt;
              } else if (isCashMethod(rr.method)) {
                dayIn += amt;
              } else if (isMdReceivedMethod(rr.method)) {
                dayMd += amt;
              }
            }
          }
        } else if (it.kind === "handover") {
          if (!isSibling) dayCount += 1;
          if (handoverReducesBalance((it.row as Hand).status)) dayOut += amt;
        } else {
          if (!isSibling) dayCount += 1;
          if (expenseHitsBalance(it.row as Exp)) dayOut += amt;
        }
        if (!isSibling) bodyHtml += buildDetailRowHtml(it, it.running, i, isHidden, daySeq);
        const next = rows[i + 1];
        if (!next || next.date !== it.date) {
          const cashLeft = dayIn - dayOut;
          bodyHtml +=
            `<tr class="dayclose${isHidden ? " blank" : ""}">` +
            `<td colspan="11">📅 ${formatDate(it.date)} — দিনের ক্লোজিং = ` +
            `মোট লেনদেন (${dayCount})   ` +
            `<span class="in">নগদ ${fmt(dayIn)}</span> − ` +
            `<span class="hand">MD ${fmt(dayMd)}</span> − ` +
            `<span class="out">মোট খরচ ${fmt(dayOut)}</span> = ` +
            `<span>CASH ${fmt(cashLeft)}</span>` +
            `</td>` +
            `</tr>` +
            `</tbody>`;
          dayIn = 0;
          dayMd = 0;
          dayOut = 0;
          dayCount = 0;
        }
      }
    }

    const printedAt = new Date();
    const stamp = `${formatDate(today())} · ${printedAt.toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" })}`;
    const printedBy = displayName(profile, user);

    return `<!doctype html><html><head><meta charset="utf-8"><title>আজকের হিসাব- এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্</title>
<style>
  @page{size:${PAPER_CSS[printPaper]} ${printOrientation};margin:8mm 5mm 24mm 5mm}
  body{font-family:'Noto Sans Bengali',system-ui,sans-serif;padding:4px;color:#111;margin:0;position:relative}
  body::before{content:"";position:fixed;inset:0;z-index:9999;pointer-events:none;background-image:url("${window.location.origin}${logoAsset.url}");background-repeat:no-repeat;background-position:center;background-size:55%;opacity:0.06;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .brand{display:flex;justify-content:space-between;align-items:flex-end;gap:8px;border-bottom:2px solid #111;padding-bottom:4px;margin-bottom:6px}
  .brand .co{font-size:16px;font-weight:800}
  .brand .tag{font-size:10px;color:#555}
  .brand .sub{font-size:10px;color:#555;line-height:1.45;text-align:right;white-space:nowrap}
  .summary{display:flex;gap:5px;margin-bottom:6px;font-size:11px;font-weight:700;flex-wrap:wrap}
  .summary div{padding:3px 6px;border:1px solid #ddd;border-radius:4px;flex:1;min-width:90px}
  ${TIMELINE_PRINT_TABLE_CSS}
  .in{color:#059669}.out{color:#b45309}.hand{color:#0284c7}.due{color:#b91c1c}.vendor{color:#ea580c}
  tr.dayclose td{background:#eef6ff;font-weight:700;color:#0369a1;border-bottom:2px solid #bcdcff}
  /* মার্ক করা তারিখ: জায়গাটা ঠিক একই উচ্চতায় থাকবে কিন্তু সম্পূর্ণ সাদা/অদৃশ্য —
     যাতে একই কাগজ আবার বসিয়ে ঐ ফাঁকা জায়গায় পরের দিনের তথ্য প্রিন্ট করা যায়। */
  tr.blank td{visibility:hidden;background:transparent!important;border-color:transparent!important;color:transparent!important}
  tfoot td{font-weight:700;background:#fafafa}
  .finalbox{margin-top:8px;padding:6px 10px;border:2px solid #0369a1;border-radius:6px;background:#eef6ff;font-size:13px;font-weight:800;color:#0369a1;text-align:right}
  .printfooter{position:fixed;bottom:0;left:0;right:0;font-size:9px;color:#666;border-top:1px solid #ddd;padding:2px 4px;display:flex;justify-content:space-between}
  .printfooter .pageno::before{content:"পৃষ্ঠা " counter(page) " / " counter(pages)}
  @media print{body{padding:2px;padding-bottom:36px}}
</style></head><body>
<div class="brand">
  <div><div class="co">এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্</div><div class="tag">তারিখভিত্তিক দৈনিক ক্লোজিং রিপোর্ট</div></div>
  <div class="sub">সময়সীমা: ${periodLabel}<br>প্রিন্ট: ${stamp}<br>প্রিন্ট করেছেন: ${printedBy}<br>মোট ${rows.length} এন্ট্রি</div>
</div>
<div class="summary">
  <div>আগের জের: <b>${fmt(opening)}</b></div>
  <div class="in">নগদ আয়: <b>+ ${fmt(totals.inAmt)}</b></div>
  ${totals.mdAmt > 0 ? `<div class="hand">MD রিসিভ: <b>${fmt(totals.mdAmt)}</b></div>` : ""}
  ${totals.vendorAmt > 0 ? `<div class="vendor">Vendor Rece: <b>${fmt(totals.vendorAmt)}</b></div>` : ""}
  <div class="out">খরচ/জমা: <b>− ${fmt(totals.outAmt)}</b></div>
  <div>সর্বশেষ ক্লোজিং: <b>${fmt(finalClosing)}</b></div>
</div>
<table>
  ${TIMELINE_PRINT_COLGROUP_HTML}
  <thead>
    <tr>
      <th>#</th><th class="dt">তারিখ</th>
      <th>নাম</th><th>সার্ভিস</th><th>দেশ/রোড</th>
      <th class="num">মোট বিল</th>
      <th class="num">আয়</th>
      <th class="num">বাকি</th>
      <th class="prev">Adv:/ discu:</th>
      <th class="num">খরচ/জমা</th>
      <th class="num">ব্যালেন্স</th>
    </tr>
  </thead>
  ${bodyHtml}
</table>
<div class="finalbox">সর্বশেষ ক্লোজিং ব্যালেন্স: ${fmt(finalClosing)}</div>
${partySectionsHtml()}
<div style="height:28px"></div>
<div class="printfooter"><span>এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্ · ${stamp}</span><span class="pageno"></span></div>
</body></html>`;
  };

  const handleRangeClosingPrint = () => {
    const html = buildRangeClosingHtml();
    if (!html) return;
    const docTitle = buildFileTitle(
      "Accounts",
      "Daily_Closing",
      `${dateFrom || "শুরু"}_to_${dateTo || today()}`,
    );
    try {
      printDocHtml(html, docTitle);
      setPrintOpen(false);
    } catch {
      toast.error("পপ-আপ ব্লক হয়েছে");
    }
  };



  if (roleLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  // TEMP: Admin has full master access — no redirect.

  return (
    <div className="relative z-10 space-y-4 max-w-6xl mx-auto pb-8">
      <PageWatermark text="ACCOUNTS" size="sm" />
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Wallet className="h-6 w-6 text-primary" />
            আমার হিসাব
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" />
            {formatDate(today())} · {displayName(profile, user)}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void reload(false)} disabled={syncing} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Sync</span>
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        <StatCard label="হাতে আছে" value={balance} icon={Wallet} tone="primary" />
        <StatCard label="নগদ আয় (ব্যালেন্সে)" value={periodIncome} icon={TrendingUp} tone="success" />
        <StatCard label="MD-কে জমা/পাঠানো" value={periodHand} icon={Send} tone="info" />
        <StatCard label="মোট খরচ" value={periodExp} icon={TrendingDown} tone="warning" />
      </div>

      {/* Action Bar */}
      <Card className="overflow-hidden">
        <CardContent className="p-3 flex flex-wrap items-center gap-2 justify-between">
          <div className="flex items-center gap-2 flex-wrap flex-1 min-w-[220px]">
            {/* Latest-N input */}
            <div className="relative flex-1 min-w-[180px] max-w-[260px] group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={latestInput}
                disabled={useDateFilter}
                onChange={(e) => setLatestInput(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="সংখ্যা (যেমন: 5)"
                className="h-10 pl-9 pr-20 text-sm font-medium tabular-nums bg-gradient-to-br from-card to-muted/40 border-primary/20 focus-visible:ring-primary/40 focus-visible:border-primary/50 shadow-sm rounded-xl disabled:opacity-50"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1 pointer-events-none">
                <History className="h-3 w-3" />
                সর্বশেষ
              </span>
            </div>

            {/* Date range */}
            <div className="flex items-center gap-1.5 flex-1 basis-full sm:basis-auto min-w-[240px]">
              <div className="relative flex-1">
                <CalendarDays className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <DateInput
                  
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-10 pl-8 text-xs tabular-nums bg-gradient-to-br from-card to-muted/40 border-sky-500/20 focus-visible:ring-sky-500/40 shadow-sm rounded-xl"
                  aria-label="শুরুর তারিখ"
                />
              </div>
              <span className="text-muted-foreground text-xs">→</span>
              <div className="relative flex-1">
                <CalendarDays className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <DateInput
                  
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-10 pl-8 text-xs tabular-nums bg-gradient-to-br from-card to-muted/40 border-sky-500/20 focus-visible:ring-sky-500/40 shadow-sm rounded-xl"
                  aria-label="শেষ তারিখ"
                />
              </div>
              {useDateFilter && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0"
                  onClick={() => { setDateFrom(""); setDateTo(""); }}
                  aria-label="তারিখ ফিল্টার মুছুন"
                  title="তারিখ ফিল্টার মুছুন"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* Quick: Today */}
            {(() => {
              const t = today();
              const isToday = useDateFilter && dateFrom === t && dateTo === t;
              return (
                <Button
                  type="button"
                  size="sm"
                  variant={isToday ? "default" : "outline"}
                  onClick={() => {
                    if (isToday) { setDateFrom(""); setDateTo(""); }
                    else { setDateFrom(t); setDateTo(t); }
                  }}
                  className="h-9 gap-1.5 rounded-xl text-xs font-semibold shrink-0"
                  title="আজকের লেনদেন"
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  আজকের গুলো
                </Button>
              );
            })()}

            {/* Active badge */}
            <div className="hidden md:flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary text-[11px] font-semibold whitespace-nowrap">
              {useDateFilter
                ? `${timeline.length} এন্ট্রি · তারিখ`
                : isInvalidInput ? "ফিল্টার নেই" : `${timeline.length} সর্বশেষ`}
            </div>
          </div>
          <div className="flex gap-2">
            {(isStaff || isAdmin || isMd) && (
              <Button asChild size="sm" variant="outline" className="gap-1.5 h-9">
                <Link to="/my-handover">
                  <LockIcon className="h-4 w-4" /> আমার ক্যাশ হিসাব
                </Link>
              </Button>
            )}


            <Dialog open={manualOpen} onOpenChange={setManualOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="secondary" className="gap-1.5 h-9">
                  <PencilLine className="h-4 w-4" /> ম্যানুয়াল এন্ট্রি
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>ম্যানুয়াল এন্ট্রি</DialogTitle>
                  <DialogDescription>সরাসরি আয় বা খরচ যোগ করুন।</DialogDescription>
                </DialogHeader>
                <Tabs value={manualTab} onValueChange={(v) => setManualTab(v as "income" | "expense")}>
                  <TabsList className="grid grid-cols-2 w-full">
                    <TabsTrigger value="income" className="gap-1.5"><ArrowDownLeft className="h-3.5 w-3.5" />ম্যানুয়ালী আয় যোগ</TabsTrigger>
                    <TabsTrigger value="expense" className="gap-1.5"><ArrowUpRight className="h-3.5 w-3.5" />ম্যানুয়ালী খরচ যোগ</TabsTrigger>
                  </TabsList>

                  <TabsContent value="income" className="space-y-3 mt-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">তারিখ</Label>
                        <DateInput value={iForm.entry_date} onChange={(e) => setIForm({ ...iForm, entry_date: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs">মাধ্যম</Label>
                        <LookupSelect kind="payment_method" defaults={METHODS} value={iForm.method} onChange={(v) => setIForm({ ...iForm, method: v })} />
                      </div>
                    </div>
                    {isMdReceivedMethod(iForm.method) && (
                      <div className="rounded-md border border-sky-500/40 bg-sky-500/10 p-2 text-[11px] text-sky-700 dark:text-sky-300">
                        ⚠️ এই টাকা সরাসরি MD-এর কাছে যাবে — আপনার ক্যাশ ব্যালেন্সে যোগ হবে না, শুধু এন্ট্রি থাকবে ({iForm.method})।
                      </div>
                    )}
                    <div>
                      <Label className="text-xs">উৎস / নাম</Label>
                      <Input placeholder="যেমন: কাস্টমার নাম বা উৎস" value={iForm.passenger_name} onChange={(e) => setIForm({ ...iForm, passenger_name: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">পরিমাণ (৳)</Label>
                      <Input type="number" inputMode="numeric" placeholder="0" value={iForm.amount} onChange={(e) => setIForm({ ...iForm, amount: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">মন্তব্য</Label>
                      <Textarea rows={2} placeholder="ঐচ্ছিক" value={iForm.remarks} onChange={(e) => setIForm({ ...iForm, remarks: e.target.value })} />
                    </div>
                    <DialogFooter>
                      <Button onClick={saveManualIncome} disabled={savingIncome} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"><Plus className="h-4 w-4" />{savingIncome ? "সংরক্ষণ হচ্ছে..." : "আয় সংরক্ষণ"}</Button>
                    </DialogFooter>
                  </TabsContent>

                  <TabsContent value="expense" className="space-y-3 mt-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">তারিখ</Label>
                        <DateInput value={eForm.entry_date} onChange={(e) => setEForm({ ...eForm, entry_date: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs">ক্যাটাগরি</Label>
                        <LookupSelect kind="expense_category" defaults={EXPENSE_CATEGORIES} value={eForm.category} onChange={(v) => setEForm({ ...eForm, category: v })} />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">উদ্দেশ্য</Label>
                      <Input placeholder="যেমন: চা-নাস্তা, স্ট্যাম্প" value={eForm.purpose} onChange={(e) => setEForm({ ...eForm, purpose: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">পরিমাণ (৳)</Label>
                      <Input type="number" inputMode="numeric" placeholder="0" value={eForm.amount} onChange={(e) => setEForm({ ...eForm, amount: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">মন্তব্য</Label>
                      <Textarea rows={2} placeholder="ঐচ্ছিক" value={eForm.remarks} onChange={(e) => setEForm({ ...eForm, remarks: e.target.value })} />
                    </div>
                    <DialogFooter>
                      <Button onClick={saveExpense} disabled={savingExpense} className="gap-1.5"><Plus className="h-4 w-4" />{savingExpense ? "সংরক্ষণ হচ্ছে..." : "খরচ সংরক্ষণ"}</Button>
                    </DialogFooter>
                  </TabsContent>
                </Tabs>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      {/* Period summary strip */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border bg-card p-2.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">আয়</p>
          <p className="text-base sm:text-lg font-bold text-emerald-600 tabular-nums">{fmt(periodIncome)}</p>
        </div>
        <div className="rounded-lg border bg-card p-2.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">MD-কে জমা/পাঠানো</p>
          <p className="text-base sm:text-lg font-bold text-sky-600 tabular-nums">{fmt(periodHand)}</p>
        </div>
        <div className="rounded-lg border bg-card p-2.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">খরচ</p>
          <p className="text-base sm:text-lg font-bold text-amber-600 tabular-nums">{fmt(periodExp)}</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="timeline" className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-9">
          <TabsTrigger value="timeline" className="text-xs gap-1"><Layers className="h-3.5 w-3.5" />Timeline</TabsTrigger>
          <TabsTrigger value="income"   className="text-xs gap-1"><ArrowDownLeft className="h-3.5 w-3.5" />আয়</TabsTrigger>
          <TabsTrigger value="expense"  className="text-xs gap-1"><Receipt className="h-3.5 w-3.5" />খরচ</TabsTrigger>
          <TabsTrigger value="handover" className="text-xs gap-1"><ArrowUpRight className="h-3.5 w-3.5" />MD-কে পাঠানো</TabsTrigger>
        </TabsList>

        {/* Timeline */}
        <TabsContent value="timeline" className="mt-3 space-y-3">
          {/* Timeline header strip with count + print */}
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="text-xs text-muted-foreground">
              {isInvalidInput
                ? <span className="text-amber-600 font-medium">⚠ সঠিক সংখ্যা বা তারিখ দিন</span>
                : useDateFilter
                ? <>{dateFrom || "শুরু"} → {dateTo || "এখন"} · <b className="text-foreground">{timeline.length}</b> লেনদেন</>
                : <>সর্বশেষ <b className="text-foreground">{timeline.length}</b> লেনদেন</>}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={timeline.length === 0}
                className="h-8 text-xs gap-1.5"
                onClick={() => { setPrintOpen(true); void loadPartyBalances(); setSelMethods(new Set(methodBreakdown.map((m) => m.method))); }}
              >
                <Printer className="h-3.5 w-3.5" /> প্রিন্ট অপশন
              </Button>

              <Dialog open={printOpen} onOpenChange={setPrintOpen}>
                <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                      <Printer className="h-4 w-4" /> প্রিন্ট অপশন — আয়-ব্যয়ের সারাংশ
                    </DialogTitle>
                    <DialogDescription>
                      পেপার সাইজ ও অরিয়েন্টেশন বেছে নিন। চাইলে নির্দিষ্ট Vendor ও Agency-র ব্যালেন্স মার্ক করে রিপোর্টের সাথে যুক্ত করুন।
                    </DialogDescription>
                  </DialogHeader>

                  {/* paper + orientation */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">পেপার সাইজ</Label>
                      <Select value={printPaper} onValueChange={(v) => setPrintPaper(v as typeof printPaper)}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="A4">A4 (210×297mm)</SelectItem>
                          <SelectItem value="A5">A5 (148×210mm)</SelectItem>
                          <SelectItem value="Letter">Letter (8.5×11in)</SelectItem>
                          <SelectItem value="Legal">Legal (8.5×14in)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">অরিয়েন্টেশন</Label>
                      <Select value={printOrientation} onValueChange={(v) => setPrintOrientation(v as "portrait" | "landscape")}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="portrait">Portrait</SelectItem>
                          <SelectItem value="landscape">Landscape</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Vendor balances */}
                  <div className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Vendor ব্যালেন্স যুক্ত করুন</Label>
                      <Switch checked={incVendors} onCheckedChange={setIncVendors} />
                    </div>
                    {incVendors && (
                      <BalancePicker
                        loading={balLoading}
                        rows={vendorBals}
                        selected={selVendors}
                        onToggle={(name) => setSelVendors((prev) => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; })}
                        onAll={() => setSelVendors(new Set(vendorBals.map((r) => r.name)))}
                        onNone={() => setSelVendors(new Set())}
                        onDueOnly={() => setSelVendors(new Set(vendorBals.filter((r) => r.due > 0).map((r) => r.name)))}
                      />
                    )}
                  </div>

                  {/* Agency balances */}
                  <div className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Agency ব্যালেন্স যুক্ত করুন</Label>
                      <Switch checked={incAgencies} onCheckedChange={setIncAgencies} />
                    </div>
                    {incAgencies && (
                      <BalancePicker
                        loading={balLoading}
                        rows={agencyBals}
                        selected={selAgencies}
                        onToggle={(name) => setSelAgencies((prev) => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; })}
                        onAll={() => setSelAgencies(new Set(agencyBals.map((r) => r.name)))}
                        onNone={() => setSelAgencies(new Set())}
                        onDueOnly={() => setSelAgencies(new Set(agencyBals.filter((r) => r.due > 0).map((r) => r.name)))}
                      />
                    )}
                  </div>

                  {/* Payment receive method breakdown */}
                  <div className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">পেমেন্ট রিসিভ মেথড যুক্ত করুন</Label>
                      <Switch checked={incMethods} onCheckedChange={setIncMethods} />
                    </div>
                    {incMethods && (
                      methodBreakdown.length === 0 ? (
                        <div className="py-3 text-center text-xs text-muted-foreground">এই সময়ে কোনো রিসিভ নেই</div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setSelMethods(new Set(methodBreakdown.map((m) => m.method)))}>সব</Button>
                            <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setSelMethods(new Set())}>কিছু না</Button>
                            <span className="ml-auto text-[11px] text-muted-foreground">{selMethods.size}/{methodBreakdown.length} নির্বাচিত</span>
                          </div>
                          <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border p-1.5">
                            {methodBreakdown.map((m) => (
                              <label key={m.method} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/50">
                                <Checkbox
                                  checked={selMethods.has(m.method)}
                                  onCheckedChange={() => setSelMethods((prev) => { const n = new Set(prev); if (n.has(m.method)) n.delete(m.method); else n.add(m.method); return n; })}
                                />
                                <span className="flex-1 truncate">{m.method}</span>
                                <span className="text-muted-foreground tabular-nums">{m.count} টি</span>
                                <span className="text-emerald-600 tabular-nums">৳{m.total.toLocaleString()}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )
                    )}
                  </div>


                  {/* Daily closing range */}
                  <div className="space-y-2 rounded-lg border p-3">
                    <Label className="flex items-center gap-1.5 text-sm font-medium">
                      <CalendarDays className="h-4 w-4" /> তারিখভিত্তিক দৈনিক ক্লোজিং রিপোর্ট
                    </Label>
                    <p className="text-[11px] text-muted-foreground">প্রতিদিনের ক্লোজিং ব্যালেন্সসহ — উপরের পেপার/Vendor/Agency সেটিংস এতেও প্রযোজ্য।</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">শুরুর তারিখ</Label>
                        <DateInput value={dayFrom} onChange={(e) => setDayFrom(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">শেষ তারিখ</Label>
                        <DateInput value={dayTo} onChange={(e) => setDayTo(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">সর্বশেষ হিসাবের সংখ্যা (ঐচ্ছিক)</Label>
                      <Input
                        type="number"
                        min={1}
                        inputMode="numeric"
                        placeholder="যেমন: ৫০ — খালি রাখলে সব এন্ট্রি"
                        value={dayLastN}
                        onChange={(e) => setDayLastN(e.target.value)}
                      />
                      <p className="text-[10px] text-muted-foreground">তারিখ ফিল্টারের ভেতরে শুধু সর্বশেষ এই কয়টি এন্ট্রি প্রিন্ট হবে; আগের জের ঠিক রেখে ক্লোজিং হিসাব হবে।</p>
                    </div>
                    {rangeDates.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">আগে প্রিন্ট হওয়া তারিখ (মার্ক করুন → জায়গা সাদা থাকবে)</Label>
                          {hiddenDays.length > 0 && (
                            <button
                              type="button"
                              className="text-[10px] text-primary underline"
                              onClick={() => setHiddenDays([])}
                            >
                              সব আনমার্ক
                            </button>
                          )}
                        </div>
                        <div className="max-h-40 overflow-y-auto rounded-md border p-2 grid grid-cols-2 gap-1">
                          {rangeDates.map((d) => {
                            const checked = hiddenDays.includes(d);
                            return (
                              <label
                                key={d}
                                className="flex items-center gap-1.5 text-[11px] cursor-pointer rounded px-1 py-0.5 hover:bg-muted"
                              >
                                <input
                                  type="checkbox"
                                  className="h-3.5 w-3.5"
                                  checked={checked}
                                  onChange={(e) =>
                                    setHiddenDays((prev) =>
                                      e.target.checked ? [...prev, d] : prev.filter((x) => x !== d),
                                    )
                                  }
                                />
                                <span className={checked ? "line-through text-muted-foreground" : ""}>
                                  {formatDate(d)}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        <p className="text-[10px] text-muted-foreground">মার্ক করা তারিখের তথ্য প্রিন্টে অদৃশ্য থাকবে, কিন্তু ঠিক একই উচ্চতার <b>সাদা জায়গা</b> থেকে যাবে — তাই একই কাগজ আবার বসিয়ে ঐ ফাঁকা জায়গায় পরের দিনের তথ্য প্রিন্ট করা যাবে। ব্যালেন্স হিসাব ভিতরে ঠিক থাকবে।</p>
                      </div>
                    )}
                    <Button variant="secondary" onClick={handleRangeClosingPrint} className="w-full gap-1.5">
                      <Printer className="h-4 w-4" /> দৈনিক ক্লোজিং প্রিন্ট
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <Card><CardContent className="p-0">
            {loading ? <EmptyRow>লোড হচ্ছে...</EmptyRow>
              : isInvalidInput ? (
                <div className="text-center py-16 px-4 space-y-3">
                  <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 grid place-items-center">
                    <Search className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">সংখ্যা লিখুন</p>
                    <p className="text-xs text-muted-foreground mt-1">কতগুলো সর্বশেষ লেনদেন দেখতে চান? উপরের বক্সে একটি সংখ্যা (যেমন: ৫, ১০, ২৫) লিখুন।</p>
                  </div>
                </div>
              )
              : timeline.length === 0 ? <EmptyRow>কোনো লেনদেন পাওয়া যায়নি</EmptyRow>
              : <div className="divide-y">
                {timeline.map((it, idx) => {
                  const isIn = it.kind === "received";
                  const isHand = it.kind === "handover";
                  const r = it.row as Recv; const h = it.row as Hand; const e = it.row as Exp;
                  const statusEvt = isIn && isStatusEventReceipt(r);
                  // Multi-method Due Receive → collapse siblings into a single visible row.
                  const batch = isIn && !statusEvt ? combinedRecv(r) : null;
                  if (batch && !batch.isAnchor) return null;
                  const rawAmt = Number(isIn ? r.amount : isHand ? h.amount : e.amount);
                  const amt = batch ? batch.totalAmt : rawAmt;
                  const isPendingHand = isHand && (h.status ?? "approved") === "pending";
                  const cashAmt = batch?.cashAmt ?? 0;
                  const mdAmt = batch?.mdAmt ?? 0;
                  const vendorAmt = batch?.vendorAmt ?? 0;
                  const isMulti = !!batch && batch.isBatch;
                  const isMdRecv = isIn && !statusEvt && !isMulti && isMdReceivedMethod(r.method);
                  const isVendorRecv = isIn && !statusEvt && !isMulti && isVendorReceivedMethod(r.method);
                  const tone = statusEvt ? "text-violet-600" : isIn ? "text-emerald-600" : isHand ? "text-sky-600" : "text-amber-600";
                  const amountTone = isVendorRecv ? "text-orange-500 dark:text-orange-400" : isMdRecv ? "text-indigo-500 dark:text-indigo-400" : tone;
                  const bgTone = statusEvt ? "bg-violet-500/10 border-violet-500/20" : isIn ? "bg-emerald-500/10 border-emerald-500/20" : isHand ? "bg-sky-500/10 border-sky-500/20" : "bg-amber-500/10 border-amber-500/20";
                  const kindLabel = statusEvt ? "Delivery" : isIn ? "আয়" : isHand ? (isPendingHand ? "Pending Handover" : "জমা") : "ব্যয়";
                  const name = isIn
                    ? (r.passenger_name || (r.source === "manual" ? "ম্যানুয়াল আয়" : "—"))
                    : isHand
                    ? (`${h.from_name ?? "প্রেরক"} → ${h.to_name || "প্রাপক"}`)
                    : (e.category || "খরচ");

                  const svc = isIn && r.service_row_id ? svcMap[r.service_row_id] : undefined;
                  const servicePrimary = isIn
                    ? (r.source === "manual"
                        ? (r.remarks || "ম্যানুয়াল আয়")
                        : (svc?.service_name || cleanServiceType(r.service_type)))
                    : isHand
                    ? "জমা / Handover"
                    : (e.purpose || "—");

                  const svcLines: string[] = [];
                  if (isIn && svc) {
                    if (r.service_table === "tickets") {
                      if (svc.route) svcLines.push(svc.route);
                      if (svc.airline) svcLines.push(svc.airline);
                      if (svc.flight_date) svcLines.push(`✈ ${formatDate(svc.flight_date)}`);
                    } else if (r.service_table === "others") {
                      if (svc.airline) svcLines.push(svc.airline);
                      if (svc.route) svcLines.push(svc.route);
                      if (svc.flight_date) svcLines.push(`✈ ${formatDate(svc.flight_date)}`);
                    } else if (svc.country) {
                      svcLines.push(svc.country);
                    }
                  }
                  const linkedStatus = isIn && !statusEvt && r.service_table && r.service_row_id
                    ? statusByService[`${r.service_table}:${r.service_row_id}`]
                    : "";
                  const methodDisplay = isIn && !statusEvt
                    ? (batch && batch.methods.length ? batch.methods.join(" + ") : (r.method || ""))
                    : "";
                  const discountTotal = isIn && svc && typeof svc.discount === "number" ? svc.discount : 0;
                  const dueLeft = isIn && svc && typeof svc.sold === "number" && typeof svc.received_total === "number"
                    ? svc.sold - svc.received_total - discountTotal : null;

                  const totalBill = isIn && svc && typeof svc.sold === "number" ? svc.sold : null;
                  const totalPaid = isIn && svc && typeof svc.received_total === "number" ? svc.received_total : null;
                  const isAdvance = isIn && !!svc?.has_delivery && isAdvancePayment(r.entry_date, svc?.delivery_date);

                  return (
                    <div key={`${it.kind}-${(it.row as { id: string }).id}`} className={`row-tint-${idx % 4} grid grid-cols-[0.7fr_1fr_1.1fr_0.85fr_0.9fr_auto] gap-2 sm:gap-3 p-2.5 sm:p-3 transition-colors items-start`}>
                      {/* Col 1: Type + date */}
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                          <span className={`px-1.5 py-px rounded-full border ${bgTone} ${tone} font-medium`}>{kindLabel}</span>
                          {isMulti && <span className="px-1 py-px rounded border text-[10px] font-medium text-primary border-primary/30 bg-primary/10">{batch!.parts.length} মেথড</span>}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-0.5">
                          <CalendarDays className="h-2.5 w-2.5" />{formatDate(it.date)}
                        </p>
                        {isIn && r.ref_id && <p className="text-xs text-muted-foreground mt-0.5">Ref: <span className="font-mono">{r.ref_id}</span></p>}
                      </div>


                      {/* Col 2 (NEW): Name + Passport */}
                      <div className="min-w-0">
                        <p className="font-semibold text-sm leading-tight break-words">{name}</p>
                        {isIn && svc?.passport && (
                          <p className="text-xs text-muted-foreground mt-0.5 font-mono break-words">{svc.passport}</p>
                        )}
                      </div>


                      {/* Col 2: Service + secondary (no due here) */}
                      <div className="min-w-0">
                        <p className="font-medium text-sm leading-tight break-words">{servicePrimary}</p>
                        {svcLines.map((line, i) => (
                          <p key={i} className="text-xs text-muted-foreground mt-0.5 leading-snug break-words">
                            {line}
                          </p>
                        ))}
                        {linkedStatus && (
                          <p className="text-xs text-violet-600 dark:text-violet-400 mt-0.5 leading-snug break-words">
                            📦 {linkedStatus}
                          </p>
                        )}
                        {isPendingHand && (
                          <p className="text-xs text-amber-600 mt-0.5 leading-snug break-words">
                            MD approval pending
                          </p>
                        )}
                        {(() => {
                          const rawRemark = isIn ? r.remarks : isHand ? h.remarks : e.remarks;
                          const shownRemark = isIn ? cleanReceiptRemark(rawRemark) : rawRemark;
                          return !statusEvt && shownRemark ? (
                            <p className="text-xs text-muted-foreground/90 mt-1 flex items-start gap-1">
                              <MessageSquare className="h-2.5 w-2.5 mt-0.5 shrink-0" />
                              <span className="break-words">{shownRemark}</span>
                            </p>
                          ) : null;
                        })()}
                      </div>

                      {/* Col 3 (NEW): মোট বিল / মোট জমা / বাকি */}
                      <div className="min-w-0 text-xs space-y-0.5">
                        {totalBill !== null ? (
                          <>
                            <p className="text-muted-foreground">মোট বিল: <span className="font-semibold text-foreground tabular-nums">{fmt(totalBill)}</span></p>
                            {totalPaid !== null && (
                              <p className="text-muted-foreground">মোট জমা: <span className="font-semibold text-emerald-600 tabular-nums">{fmt(totalPaid)}</span></p>
                            )}
                            {discountTotal > 0 && (
                              <p className="text-muted-foreground">Discount: <span className="font-semibold text-amber-600 tabular-nums">{fmt(discountTotal)}</span></p>
                            )}
                            {dueLeft !== null && (
                              <p className="text-muted-foreground">বাকি: <span className={`font-semibold tabular-nums ${dueLeft > 0.005 ? "text-rose-600" : "text-emerald-600"}`}>{fmt(dueLeft)}</span></p>
                            )}
                          </>
                        ) : (
                          <p className="text-muted-foreground/50">—</p>
                        )}
                      </div>

                      {/* Col 4: Agent + Vendor + cost */}
                      <div className="min-w-0">
                        {isIn && svc?.agent && (
                          <p className="text-sm font-semibold leading-tight break-words text-foreground">{svc.agent}</p>
                        )}
                        {isIn && svc?.vendor ? (
                          <>
                            <p className={`text-xs font-medium leading-tight break-words ${svc?.agent ? "mt-0.5 text-muted-foreground" : ""}`}>{svc.vendor}</p>
                            {typeof svc.cost === "number" && svc.cost > 0 && (
                              <p className="text-xs text-muted-foreground tabular-nums mt-0.5">{fmt(svc.cost)}</p>
                            )}
                          </>
                        ) : (
                          !svc?.agent && <p className="text-xs text-muted-foreground/50">—</p>
                        )}
                      </div>

                      {/* Col 4: Amount + Balance */}
                      <div className="text-right shrink-0">
                        <p className={`font-bold tabular-nums whitespace-nowrap text-sm ${amountTone}`}>
                          {statusEvt ? cleanStatusText(r.remarks) : <>{isAdvance ? <><AdvanceBadge advance /> </> : null}{isIn ? "+" : "−"} {fmt(amt)}</>}
                        </p>
                        {isPendingHand && <p className="text-[10px] text-amber-600 whitespace-nowrap">Balance থেকে বাদ হয়নি</p>}
                        {isMulti ? (
                          <div className="mt-0.5 space-y-px text-[10px] leading-tight whitespace-nowrap">
                            {cashAmt > 0 && <p className="text-emerald-600 dark:text-emerald-400">নগদ · {fmt(cashAmt)}</p>}
                            {mdAmt > 0 && <p className="text-indigo-500 dark:text-indigo-400">MD · {fmt(mdAmt)} <span className="text-muted-foreground">({batch!.parts.filter(p => isMdReceivedMethod(p.method)).map(p => p.method).join(", ")})</span></p>}
                            {vendorAmt > 0 && <p className="text-orange-500 dark:text-orange-400">Vendor · {fmt(vendorAmt)}</p>}
                          </div>
                        ) : (
                          <>
                            {isMdRecv && (
                              <p className="text-[10px] text-indigo-500 dark:text-indigo-400 whitespace-nowrap leading-tight">MD রিসিভ · {r.method}</p>
                            )}
                            {isVendorRecv && (
                              <p className="text-[10px] text-orange-500 dark:text-orange-400 whitespace-nowrap leading-tight">Vendor Rece</p>
                            )}
                            {isIn && !statusEvt && methodDisplay && !isMdRecv && !isVendorRecv && (
                              <p className="text-[10px] text-muted-foreground whitespace-nowrap leading-tight">💳 {methodDisplay}</p>
                            )}
                          </>
                        )}
                        <p className="text-[10px] text-primary tabular-nums whitespace-nowrap mt-1 font-medium">
                          ব্যালেন্স
                        </p>
                        <p className="text-[11px] tabular-nums whitespace-nowrap font-semibold text-primary">
                          {fmt(it.running)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>}
          </CardContent></Card>

          {/* Hidden printable HTML table */}
          <div ref={printRef} className="hidden">
            <table>
              <thead>
                <tr>
                  <th>#</th><th className="dt">তারিখ</th>
                  <th>নাম</th><th>সার্ভিস</th><th>দেশ/রোড</th>
                  <th className="num">মোট বিল</th>
                  <th className="num">আয়</th>
                  <th className="num">বাকি</th>
                  <th className="prev">Adv:/ discu:</th>
                  <th className="num">খরচ/জমা</th>
                  <th className="num">ব্যালেন্স</th>
                </tr>
              </thead>
              {(() => {
                // একই তারিখের সব সারি একটি <tbody class="dategroup"> এ — যাতে
                // এক তারিখের হিসাব দুই পেইজে ভাগ না হয় (গ্লোবাল ইনডেক্স অপরিবর্তিত)।
                const dateGroups: { date: string; rows: { entry: (typeof printAscRows)[number]; gi: number }[] }[] = [];
                printAscRows.forEach((entry, gi) => {
                  const last = dateGroups[dateGroups.length - 1];
                  if (!last || last.date !== entry.it.date) dateGroups.push({ date: entry.it.date, rows: [] });
                  dateGroups[dateGroups.length - 1].rows.push({ entry, gi });
                });
                return dateGroups.map((g) => (
                  <tbody className="dategroup" key={g.date}>
                {g.rows.map(({ entry, gi }) => {
                  const { it, running } = entry;
                  const i = gi;
                  const isIn = it.kind === "received";
                  const isHand = it.kind === "handover";
                  const r = it.row as Recv; const h = it.row as Hand; const e = it.row as Exp;
                  const statusEvt = isIn && isStatusEventReceipt(r);
                  // Multi-method Due Receive → skip sibling rows, aggregate at the anchor.
                  const batch = isIn && !statusEvt ? combinedRecv(r) : null;
                  if (batch && !batch.isAnchor) return null;
                  const rawAmt = Number(isIn ? r.amount : isHand ? h.amount : e.amount);
                  const amt = batch ? batch.totalAmt : rawAmt;
                  const isMulti = !!batch && batch.isBatch;
                  const cashAmt = batch?.cashAmt ?? 0;
                  const mdAmt = batch?.mdAmt ?? 0;
                  const vendorAmt = batch?.vendorAmt ?? 0;
                  const mdRecv = isIn && !isMulti && isMdReceivedMethod(r.method) && !statusEvt;
                  const vendorRecv = isIn && !isMulti && isVendorReceivedMethod(r.method) && !statusEvt;
                  const svc = isIn && r.service_row_id ? svcMap[r.service_row_id] : undefined;
                  const agencyFirst = (() => {
                    const a = String(svc?.agent ?? "").trim();
                    if (!a || a.toLowerCase() === "self") return "";
                    return a.split(/\s+/)[0];
                  })();
                  const baseName = isIn ? r.passenger_name : isHand ? `ক্যাশ হ্যান্ডওভার: ${h.from_name ?? "প্রেরক"} → ${h.to_name}` : (e.purpose || e.category);
                  const name = isIn && agencyFirst ? `${baseName} (${agencyFirst})` : baseName;
                  const service = statusEvt ? `📦 ${cleanStatusText(r.remarks)}` : isIn ? (svc?.service_name || cleanServiceType(r.service_type)) : isHand ? "ক্যাশ হ্যান্ডওভার" : "খরচ";
                  let region = "";
                  if (isIn && svc) {
                    if (r.service_table === "tickets") {
                      region = [svc.route, svc.airline].filter(Boolean).join(" · ");
                    } else if (r.service_table === "others") {
                      region = [svc.airline, svc.route, svc.flight_date ? `✈ ${formatDate(svc.flight_date)}` : ""].filter(Boolean).join(" · ");
                    } else if (svc.country) {
                      region = svc.country;
                    }
                  }
                  const discAmt = isIn && svc ? Number(svc.discount ?? 0) : 0;
                  const grossBill = isIn && svc && typeof svc.sold === "number" ? svc.sold : null;
                  const totalBill = grossBill !== null ? grossBill : null;
                  const isAdvance = isIn && !!svc?.has_delivery && isAdvancePayment(r.entry_date, svc?.delivery_date);
                  const advLines: { text: string }[] = [];
                  let sumPrev = 0;
                  let lastAdvDate = "";
                  if (isIn && r.service_row_id) {
                    const curDate = r.entry_date;
                    const excludeIds = batch ? batch.partIds : new Set([r.id]);
                    const prior = received.filter(p =>
                      p.service_row_id === r.service_row_id &&
                      !excludeIds.has(p.id) &&
                      (p.entry_date < curDate || (p.entry_date === curDate && p.id < r.id))
                    );
                    for (const p of prior) {
                      const pv = Number(p.amount || 0);
                      sumPrev += pv;
                      if (!lastAdvDate || p.entry_date > lastAdvDate) lastAdvDate = p.entry_date;
                    }
                    if (sumPrev > 0.005) advLines.push({ text: `(৳${sumPrev.toLocaleString()}-Adv-${formatDate(lastAdvDate)})` });
                  }
                  if (discAmt > 0.005) advLines.push({ text: `${fmt(discAmt)} Discount` });
                  const due = totalBill !== null && isIn ? Math.max(0, totalBill - amt - sumPrev - discAmt) : null;
                  const cls = isHand ? "hand" : "out";
                  const methodStr = isMulti ? batch!.methods.join(" + ") : (r.method || "");
                  const serviceText = `${service}${isIn && !statusEvt && methodStr ? ` · ${methodStr}` : ""}`;
                  const regionText = `${region}${mdRecv ? " · MD রিসিভ" : ""}${vendorRecv ? " · Vendor Rece" : ""}`;
                  // Amount cell — for multi-method batches, show a per-method breakdown.
                  const amtContent = isIn
                    ? (statusEvt ? "Delivery" :
                       isMulti ? (
                         <>
                           <div>+ {fmt(amt)}</div>
                           {cashAmt > 0 && <div style={{ fontSize: "0.85em" }}>নগদ {fmt(cashAmt)}</div>}
                           {mdAmt > 0 && <div style={{ fontSize: "0.85em" }}>MD {fmt(mdAmt)}</div>}
                           {vendorAmt > 0 && <div style={{ fontSize: "0.85em" }}>Vendor {fmt(vendorAmt)}</div>}
                         </>
                       ) :
                       vendorRecv ? `(Vendor) ${fmt(amt)}` :
                       mdRecv ? `(MD) ${fmt(amt)}` :
                       `+ ${fmt(amt)}`)
                    : "";
                  const amtPlain = isIn
                    ? (statusEvt ? "Delivery" :
                       isMulti ? `+ ${fmt(amt)} [${[cashAmt > 0 ? `নগদ ${fmt(cashAmt)}` : "", mdAmt > 0 ? `MD ${fmt(mdAmt)}` : "", vendorAmt > 0 ? `Vendor ${fmt(vendorAmt)}` : ""].filter(Boolean).join(" · ")}]` :
                       vendorRecv ? `(Vendor) ${fmt(amt)}` :
                       mdRecv ? `(MD) ${fmt(amt)}` :
                       `+ ${fmt(amt)}`)
                    : "";
                  const amtCls = isMulti ? "in" : vendorRecv ? "vendor" : mdRecv ? "hand" : "in";
                  return (
                    <tr key={`p-${it.kind}-${(it.row as { id: string }).id}`} className={`row-tint-${i % 4}`}>
                      <td>{i + 1}</td>
                      <td className="dt">{formatDate(it.date)}</td>
                      <TimelinePrintDataCells
                        cells={[
                          { className: "wrap", content: name, plain: name ?? "" },
                          { className: "wrap", content: serviceText, plain: serviceText },
                          { className: "wrap", content: regionText, plain: regionText },
                          { className: "num", content: totalBill !== null ? fmt(totalBill) : "", plain: totalBill !== null ? fmt(totalBill) : "" },
                          { className: `num ${amtCls}`, content: <>{amtContent}{!statusEvt && isAdvance ? " (Adv)" : ""}</>, plain: `${amtPlain}${!statusEvt && isAdvance ? " (Adv)" : ""}` },
                          { className: "num due", content: due !== null && due > 0.005 ? `Due-${due.toLocaleString()}` : "", plain: due !== null && due > 0.005 ? `Due-${due.toLocaleString()}` : "" },
                          { className: "prev", content: advLines.map((l, idx) => <div key={idx}>{l.text}</div>), plain: advLines.map((l) => l.text).join(" ") },
                          { className: `num ${cls}`, content: !isIn ? `− ${fmt(rawAmt)}` : "", plain: !isIn ? `− ${fmt(rawAmt)}` : "" },
                          { className: "num", content: fmt(running), plain: fmt(running), allowSpan: false },
                        ]}
                      />
                    </tr>
                  );
                })}
                  </tbody>
                ));
              })()}
            </table>
          </div>
        </TabsContent>

        {/* Income */}
        <TabsContent value="income" className="mt-3">
          <Card><CardContent className="p-0">
            {displayRecv.length === 0 ? <EmptyRow>এই সময়সীমায় কোনো আয় নেই</EmptyRow>
              : <div>
                {displayRecv.map((r, idx) => {
                  const svc = r.service_row_id ? svcMap[r.service_row_id] : undefined;
                  const bits: string[] = [];
                  if (svc) {
                    if (r.service_table === "tickets") {
                      if (svc.route) bits.push(svc.route);
                      if (svc.airline) bits.push(svc.airline);
                      if (svc.flight_date) bits.push(`✈ ${formatDate(svc.flight_date)}`);
                    } else if (r.service_table === "others") {
                      if (svc.service_name) bits.push(svc.service_name);
                      if (svc.airline) bits.push(svc.airline);
                      if (svc.route) bits.push(svc.route);
                      if (svc.flight_date) bits.push(`✈ ${formatDate(svc.flight_date)}`);
                    } else if (svc.country) {
                      bits.push(svc.country);
                    }
                  }
                  const statusEvt = isStatusEventReceipt(r);
                  const mdRecv = isMdReceivedMethod(r.method) && !statusEvt;
                  const vendorRecv = isVendorReceivedMethod(r.method) && !statusEvt;
                  const isAdvance = !!svc?.has_delivery && isAdvancePayment(r.entry_date, svc?.delivery_date) && !statusEvt;
                  return (
                    <div key={r.id} className={`row-tint-${idx % 4} flex items-start gap-3 p-3`}>
                      <div className={`shrink-0 h-9 w-9 rounded-full grid place-items-center border ${vendorRecv ? "bg-orange-500/10 text-orange-600 border-orange-500/20" : mdRecv ? "bg-sky-500/10 text-sky-600 border-sky-500/20" : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"}`}>
                        <ArrowDownLeft className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="font-semibold text-sm truncate">{r.passenger_name}</p>
                          <p className={`font-bold tabular-nums text-sm whitespace-nowrap ${statusEvt ? "text-violet-600" : vendorRecv ? "text-orange-600" : mdRecv ? "text-sky-600" : "text-emerald-600"}`}>{statusEvt ? cleanStatusText(r.remarks) : <>{isAdvance ? <><AdvanceBadge advance /> </> : null}+ {fmt(Number(r.amount))}</>}</p>
                        </div>
                         <p className="text-xs text-muted-foreground break-words">
                           {cleanServiceType(r.service_type)}{!statusEvt && r.method ? <> · 💳 {r.method}</> : null}{bits.length > 0 && <> · {bits.join(" · ")}</>}
                         </p>
                         {mdRecv && (
                           <p className="text-[11px] text-sky-600 dark:text-sky-400 mt-0.5">MD রিসিভ — ব্যালেন্সে যোগ হয়নি</p>
                         )}
                         {vendorRecv && (
                           <p className="text-[11px] text-orange-600 dark:text-orange-400 mt-0.5">Vendor Rece — ব্যালেন্সে যোগ হয়নি</p>
                         )}
                       </div>
                       <ConfirmDeleteButton allowOwner onConfirm={() => deleteRecv(r.id)} description={`আয় ${r.receipt_id} ডিলেট করতে চান?`} />
                     </div>
                   );
                 })}
               </div>}
           </CardContent></Card>
         </TabsContent>

        {/* Expense */}
        <TabsContent value="expense" className="mt-3">
          <Card><CardContent className="p-0">
            {fExp.length === 0 ? <EmptyRow>এই সময়সীমায় কোনো খরচ নেই</EmptyRow>
              : <div>
                {fExp.map((e, idx) => {
                  return (
                  <div key={e.id} className={`row-tint-${idx % 4} flex items-start gap-3 p-3`}>
                    <div className="shrink-0 h-9 w-9 rounded-full grid place-items-center bg-amber-500/10 text-amber-600 border border-amber-500/20">
                      <Receipt className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-semibold text-sm truncate">{e.purpose || e.category}</p>
                        <p className="font-bold text-amber-600 tabular-nums text-sm whitespace-nowrap">− {fmt(Number(e.amount))}</p>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {e.category} · {formatDate(e.entry_date)} · <span className="font-mono">{e.expense_id}</span>
                      </p>
                      {e.remarks && <p className="text-xs text-muted-foreground/80 mt-0.5 truncate">{e.remarks}</p>}
                    </div>
                    <ConfirmDeleteButton allowOwner onConfirm={() => deleteExp(e.id)} description={`খরচ ${e.expense_id} ডিলেট করতে চান?`} />
                  </div>
                );
                })}
              </div>}
          </CardContent></Card>
        </TabsContent>

        {/* Handover */}
        <TabsContent value="handover" className="mt-3">
          <Card><CardContent className="p-0">
            {fHand.length === 0 ? <EmptyRow>এই সময়সীমায় কোনো জমা নেই</EmptyRow>
              : <div>
                {fHand.map((h, idx) => {
                  const submitted = isHandoverSubmitted(h);
                  const status = h.status ?? "approved";
                  const isApproved = status === "approved";
                  const isPending = status === "pending";
                  const isRejected = status === "rejected";

                  // Icon + Bengali label
                  let statusIcon = "📤";
                  let statusLabel = "এমডিকে পাঠানো হয়েছে";
                  let statusCls = "text-sky-700 dark:text-sky-300 bg-sky-500/10 border-sky-500/30";
                  if (isApproved) {
                    statusIcon = "✅";
                    statusLabel = "এমডি বুঝে নিয়েছেন";
                    statusCls = "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/30";
                  } else if (isRejected) {
                    statusIcon = "❌";
                    statusLabel = "এমডি ফেরত দিয়েছেন";
                    statusCls = "text-rose-700 dark:text-rose-300 bg-rose-500/10 border-rose-500/30";
                  } else if (isPending) {
                    statusIcon = "📤";
                    statusLabel = "এমডিকে পাঠানো হয়েছে";
                  }

                  // Approved details
                  const approvedAt = (h as Hand & { approved_at?: string | null }).approved_at;
                  const approvedTime = approvedAt
                    ? new Date(approvedAt).toLocaleString("en-GB", {
                        day: "2-digit", month: "2-digit", year: "numeric",
                        hour: "2-digit", minute: "2-digit", hour12: true,
                      })
                    : null;

                  return (
                  <div key={h.id} className={`row-tint-${idx % 4} flex items-start gap-3 p-3`}>
                    <div className="shrink-0 h-9 w-9 rounded-full grid place-items-center bg-sky-500/10 text-sky-600 border border-sky-500/20">
                      <Send className="h-4 w-4" />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        sessionStorage.setItem("highlight-handover", h.id);
                        void navigate({ to: "/my-handover" });
                      }}
                      className="flex-1 min-w-0 text-left rounded-md transition-colors hover:bg-red-500/10 focus:outline-none focus:ring-1 focus:ring-red-500 -m-1 p-1"
                      title="এই হিসাবটি আমার ক্যাশ হিস্টোরিতে দেখুন"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="font-semibold text-sm truncate">{h.from_name ?? "প্রেরক"} → {h.to_name}</p>
                        <p className="font-bold text-sky-600 tabular-nums text-sm whitespace-nowrap">− {fmt(Number(h.amount))}</p>
                      </div>
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                        <Banknote className="h-3 w-3" />{h.method} · {formatDate(h.entry_date)} · <span className="font-mono">{h.handover_id}</span>
                      </p>
                      <div className={`mt-1.5 inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-semibold ${statusCls}`}>
                        <span>{statusIcon}</span><span>{statusLabel}</span>
                      </div>
                      {isApproved && (
                        <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1 font-medium">
                          {approvedTime
                            ? <>তারিখ ও সময়: <b>{approvedTime}</b> · 👤 cash handover গ্রহীতা: <b>MD (Elias)</b></>
                            : <>👤 cash handover গ্রহীতা: <b>MD (Elias)</b></>}
                        </p>
                      )}
                      {h.remarks && <p className="text-xs text-muted-foreground/80 mt-0.5 truncate">{h.remarks}</p>}
                    </button>
                    <ConfirmDeleteButton allowOwner onConfirm={() => deleteHand(h.id)} description={`জমা ${h.handover_id} ডিলেট করতে চান?`} />
                  </div>
                );
                })}
              </div>}
          </CardContent></Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}
