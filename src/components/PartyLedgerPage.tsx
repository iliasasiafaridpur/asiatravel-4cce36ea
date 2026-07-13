import { Fragment, useEffect, useId, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, moduleByKey } from "@/lib/modules";
import { partySerialCode } from "@/lib/format";
import { methodLabel } from "@/lib/payment-methods";
import { cacheRead, isOffline, readModuleCache } from "@/lib/offline-cache";
import { LedgerPage } from "@/components/LedgerPage";
import { NewPartyDialog } from "@/components/NewPartyDialog";
import { SettleModeBadge } from "@/components/SettleModeBadge";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { useRole } from "@/hooks/useRole";
import { PageWatermark } from "@/components/PageWatermark";
import logoAsset from "@/assets/logo.png.asset.json";
import { printDocHtml, buildFileTitle } from "@/lib/print-export";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Phone,
  PhoneCall,
  MessageCircle,
  MapPin,
  Pencil,
  Check,
  X,
  Plus,
  ArrowLeft,
  ChevronsUpDown,
  Receipt,
  Wallet,
  TrendingUp,
  TrendingDown,
  Printer,
  ChevronDown,
  ChevronRight,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { generateNextId } from "@/lib/idgen";
import { useCurrentUser } from "@/hooks/useCurrentUser";


type LedgerRow = Record<string, unknown> & { id: string };
type LedgerReceipt = {
  id: string;
  receipt_id: string | null;
  entry_date: string | null;
  service_type: string | null;
  service_table: string | null;
  service_row_id: string | null;
  ref_id: string | null;
  passenger_name: string | null;
  amount: number;
  method: string | null;
  source: string | null;
  remarks: string | null;
  received_by_name: string | null;
  created_at: string | null;
  ledgerRowId: string;
};
type Contact = {
  phone?: string | null;
  phone_labels?: string | null;
  address?: string | null;
  settle_mode?: string | null;
  serial_no?: number | null;
  full_name?: string | null;
  notes?: string | null;
};
type ContactId = { id: string };
type SrcInfo = {
  displayId?: string | null;
  countDate?: string | null;
  airline?: string | null;
  country?: string | null;
  cancelled?: boolean;
  cancelReason?: string | null;
  cancelDate?: string | null;
};

const fmtMoney = (n: number) => `৳${Number(n || 0).toLocaleString()}`;

/** Today's date as a pure ISO (YYYY-MM-DD) string, no TZ conversion surprises. */
const todayISO = () => new Date().toISOString().slice(0, 10);

/** Whole-day difference between two pure ISO dates (toISO − fromISO). */
function daysBetween(fromISO?: string | null, toISO?: string | null): number | null {
  if (!fromISO || !toISO) return null;
  const a = new Date(`${fromISO}T00:00:00`);
  const b = new Date(`${toISO}T00:00:00`);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** Aging colour band for an outstanding bill: green ≤7, amber 8–30, red >30. */
function ageBand(days: number | null): { text: string; cls: string } {
  if (days == null) return { text: "—", cls: "text-muted-foreground" };
  if (days <= 7) return { text: `${days} দিন`, cls: "text-emerald-600" };
  if (days <= 30) return { text: `${days} দিন`, cls: "text-amber-600" };
  return { text: `${days} দিন`, cls: "text-rose-600 font-semibold" };
}

/** Normalize a phone number to a wa.me-compatible international format (default BD +880). */
function waNumber(raw: string): string {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "880" + d.slice(1);
  return d;
}

export function PartyLedgerPage({
  kind,
  name,
  autoPayTarget,
}: {
  kind: "customer" | "vendor";
  name: string;
  /** When set, auto-open the payment dialog pre-targeting this party on mount. */
  autoPayTarget?: string;
}) {
  const isCustomer = kind === "customer";
  const table = isCustomer ? "agency_ledger" : "vendor_ledger";
  const groupField = isCustomer ? "agent_name" : "vendor_name";
  const billCol = isCustomer ? "total_bill" : "total_payable";
  const paidCol = isCustomer ? "received_amount" : "paid_amount";
  const contactsTable = isCustomer ? "agents" : "vendors";
  const backTo = isCustomer ? "/agency-ledger" : "/vendor-ledger";
  const navigate = useNavigate();
  const { user } = useCurrentUser();

  // Manual vendor income / expense entry (vendor ledger only).
  const [manualKind, setManualKind] = useState<"income" | "expense" | null>(null);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualForm, setManualForm] = useState<{
    vendor: string;
    amount: string;
    date: string;
    note: string;
  }>({ vendor: "", amount: "", date: new Date().toISOString().slice(0, 10), note: "" });


  // Full list of parties for the dropdown search filter (top-right).
  const [partyList, setPartyList] = useState<string[]>([]);
  const [partyRefresh, setPartyRefresh] = useState(0);
  const { canApprove } = useRole();
  const handleDeleteParty = async (partyName: string) => {
    const { error } = await supabase.from(contactsTable as never).delete().eq("name", partyName);
    if (error) { toast.error("ডিলিট ব্যর্থ: " + error.message); return; }
    toast.success(`"${partyName}" তালিকা থেকে মুছে ফেলা হয়েছে`);
    setPartyRefresh((v) => v + 1);
  };
  /**
   * Reverse (delete) one or more agency "পেমেন্ট গ্রহণ" instalments. Each target
   * either points at a concrete payment_receipts row (rowId) or, for cash that
   * was never mirrored into a receipt, at the agency_ledger bill row + amount.
   * The DB helper lowers the underlying booking's received amount and lets the
   * existing triggers clean up the cash mirror / handover.
   */
  const deleteAgentPayments = async (
    targets: { rowId?: string; ledgerRowId?: string; amount: number }[],
  ) => {
    for (const t of targets) {
      if (!t.rowId && !t.ledgerRowId) continue;
      const { error } = await supabase.rpc("delete_agent_payment" as never, {
        _receipt_id: t.rowId ?? null,
        _ledger_row_id: t.rowId ? null : (t.ledgerRowId ?? null),
        _amount: t.amount,
      } as never);
      if (error) {
        toast.error("পেমেন্ট গ্রহণ ডিলিট ব্যর্থ: " + error.message);
        return;
      }
    }
    toast.success("পেমেন্ট গ্রহণ ডিলিট হয়েছে");
    await load();
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(!!autoPayTarget);
  // Filter text for the on-page party list (shown when no party is selected).
  const [listFilter, setListFilter] = useState("");
  // Live balance rows for the on-page list (same data as Agent/Vendor List pages).
  const [balances, setBalances] = useState<
    { name: string; serial?: number | null; settle_mode?: string | null; bill: number; paid: number; due: number; advance: number }[]
  >([]);
  // Pagination for the ledger statement table.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  // Per-ledger statement filters (search + date range).
  const [stmtSearch, setStmtSearch] = useState("");
  const [stmtFrom, setStmtFrom] = useState("");
  const [stmtTo, setStmtTo] = useState("");
  // Service-type filter for the ledger statement ("" = all).
  const [stmtService, setStmtService] = useState("");
  // Flexible ledger print dialog state.
  const [printOpen, setPrintOpen] = useState(false);
  const [printMode, setPrintMode] = useState<"all" | "due" | "range" | "bill">("all");
  // Address-label (খাম/কুরিয়ার ঠিকানা) print state.
  const [addrOpen, setAddrOpen] = useState(false);
  const [addrSize, setAddrSize] = useState<"a4" | "a5" | "a6" | "a7">("a5");
  // Orientation: খামের লেখা উপর-নিচ (portrait) নাকি ডান-বাম (landscape)।
  const [addrOrient, setAddrOrient] = useState<"portrait" | "landscape">("landscape");
  // প্রেরক (From/Sender) — খামের মত প্রেরকের তথ্য দেখানোর অপশন।
  // এন্ট্রি করা প্রেরকের তথ্য localStorage-এ থেকে যায়, নিজে থেকে মুছে না।
  const readStore = (key: string, fallback: string) => {
    if (typeof window === "undefined") return fallback;
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : v;
  };
  const [addrShowSender, setAddrShowSender] = useState(
    () => readStore("addr_show_sender", "1") === "1"
  );
  const [senderName, setSenderName] = useState(() =>
    readStore("addr_sender_name", "এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্")
  );
  const [senderAddr, setSenderAddr] = useState(() => readStore("addr_sender_addr", ""));
  const [senderPhone, setSenderPhone] = useState(() => readStore("addr_sender_phone", ""));
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("addr_show_sender", addrShowSender ? "1" : "0");
  }, [addrShowSender]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("addr_sender_name", senderName);
  }, [senderName]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("addr_sender_addr", senderAddr);
  }, [senderAddr]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("addr_sender_phone", senderPhone);
  }, [senderPhone]);
  const [printFrom, setPrintFrom] = useState("");
  const [printTo, setPrintTo] = useState("");

  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [receiptRows, setReceiptRows] = useState<LedgerReceipt[]>([]);
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  // Authoritative balance row (matches the list page exactly).
  const [summary, setSummary] = useState<{ bill: number; paid: number; due: number; advance: number }>(
    { bill: 0, paid: 0, due: 0, advance: 0 },
  );
  // Vendor source-file details keyed by source_id (module id, real count date,
  // and extra description fields like airline / country).
  const [srcMap, setSrcMap] = useState<Map<string, SrcInfo>>(new Map());

  const [displayName, setDisplayName] = useState<string>(name);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  // Bill-by-bill: which bill row's payment history is expanded ("" = none).
  const [expandedBill, setExpandedBill] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; fullName: string; phones: string[]; phoneLabels: string[]; address: string; settleMode: "total" | "one_by_one" }>({
    name: "",
    fullName: "",
    phones: [""],
    phoneLabels: [""],
    address: "",
    settleMode: "total",
  });

  // সেট না থাকলে: এজেন্সি (customer) ডিফল্ট one_by_one, ভেন্ডর ডিফল্ট total।
  const settleModeRaw = (contact?.settle_mode ?? "").trim();
  const settleMode =
    (settleModeRaw || (isCustomer ? "one_by_one" : "total")) === "one_by_one"
      ? "one_by_one"
      : "total";

  useEffect(() => {
    setDisplayName(name);
    setEditing(false);
  }, [name]);

  // Load the full party list (contacts + any names appearing in the ledger) for
  // the dropdown search filter beside the page title.
  useEffect(() => {
    let cancelled = false;
    const loadParties = async () => {
      let contactsData: { name?: string }[] | null;
      let ledgerData: Record<string, unknown>[] | null;
      if (isOffline()) {
        contactsData = cacheRead<{ name?: string }[]>(contactsTable) ?? [];
        ledgerData = cacheRead<Record<string, unknown>[]>(table) ?? [];
      } else {
        const [contactsRes, ledgerRes] = await Promise.all([
          supabase.from(contactsTable as never).select("name").limit(5000),
          supabase.from(table as never).select(groupField).limit(5000),
        ]);
        contactsData = contactsRes.data as { name?: string }[] | null;
        ledgerData = ledgerRes.data as Record<string, unknown>[] | null;
      }
      const set = new Set<string>();
      for (const r of contactsData ?? []) {
        const n = String(r.name ?? "").trim();
        if (n) set.add(n);
      }
      for (const r of ledgerData ?? []) {
        const n = String(r[groupField] ?? "").trim();
        if (n) set.add(n);
      }
      if (!cancelled) {
        setPartyList(
          Array.from(set)
            .filter((n) => (isCustomer ? n.trim().toLowerCase() !== "self" : true))
            .sort((a, b) => a.localeCompare(b)),
        );
      }
    };
    void loadParties();
    return () => {
      cancelled = true;
    };
  }, [contactsTable, table, groupField, isCustomer, partyRefresh]);

  // Load live balances (same RPC the Agent/Vendor List pages use) for the
  // on-page list shown when no party is selected.
  const rtId = useId();
  useEffect(() => {
    if (name) return;
    let cancelled = false;
    const loadBalances = async () => {
      let data: unknown;
      let contactsRows: { name?: string | null; serial_no?: number | null; settle_mode?: string | null }[];
      if (isOffline()) {
        data = cacheRead<Record<string, unknown>[]>(isCustomer ? "bal_agent" : "bal_vendor") ?? [];
        contactsRows = cacheRead<{ name?: string | null; serial_no?: number | null; settle_mode?: string | null }[]>(contactsTable) ?? [];
      } else {
        const [balRes, contactsRes] = await Promise.all([
          supabase.rpc((isCustomer ? "get_agent_balances" : "get_vendor_balances") as never),
          supabase.from(contactsTable as never).select("name,serial_no,settle_mode").limit(5000),
        ]);
        data = balRes.data;
        contactsRows = (contactsRes.data as unknown as { name?: string | null; serial_no?: number | null; settle_mode?: string | null }[]) ?? [];
      }
      const serialByName = new Map(
        (contactsRows
          .map((c) => [String(c.name ?? "").trim().toLowerCase(), c.serial_no ?? null] as const)
          .filter(([n]) => Boolean(n))),
      );
      const modeByName = new Map(
        (contactsRows
          .map((c) => [String(c.name ?? "").trim().toLowerCase(), (c.settle_mode ?? "") as string] as const)
          .filter(([n]) => Boolean(n))),
      );
      const nameKey = isCustomer ? "agent_name" : "vendor_name";
      const billKey = isCustomer ? "total_bill" : "total_payable";
      const paidKey = isCustomer ? "total_received" : "total_paid";
      const list = ((data as unknown as Record<string, unknown>[]) ?? [])
        .map((b) => {
          const partyName = String(b[nameKey] ?? "").trim();
          return {
          name: partyName,
          serial: serialByName.get(partyName.toLowerCase()) ?? null,
          settle_mode: modeByName.get(partyName.toLowerCase()) ?? "",
          bill: Number(b[billKey] ?? 0),
          paid: Number(b[paidKey] ?? 0),
          due: Number(b.balance_due ?? 0),
          advance: Number(b.advance_balance ?? 0),
          };
        })
        // "Self" is not a real agency/customer — never list it.
        .filter((b) => b.name.trim().toLowerCase() !== "self");
      if (!cancelled) setBalances(list);
    };
    void loadBalances();
    const ch = supabase
      .channel(`party_bal_rt_${table}_${rtId}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, () => void loadBalances())
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [isCustomer, table, name, rtId, partyRefresh]);




  // Phone numbers with their per-number labels (aligned by index). The label
  // string is comma-separated and aligned with the phone string by position.
  const phoneList = (() => {
    const nums = (contact?.phone ?? "").split(",").map((p) => p.trim());
    const labels = (contact?.phone_labels ?? "").split(",").map((l) => l.trim());
    return nums
      .map((ph, i) => ({ phone: ph, label: labels[i] ?? "" }))
      .filter((x) => x.phone);
  })();

  // Last payment (পরিশোধ/গ্রহণ) — newest ledger row with a positive paid amount.
  const lastPayment = useMemo(() => {
    let best: { date: string; amount: number } | null = null;
    const paymentSource = isCustomer && receiptRows.length > 0 ? receiptRows : rows;
    for (const r of paymentSource) {
      const amt = isCustomer && "amount" in r
        ? Number((r as LedgerReceipt).amount ?? 0)
        : Number((r as Record<string, unknown>)[paidCol] ?? 0);
      if (!(amt > 0)) continue;
      // গ্রহণ/পরিশোধের আসল তারিখ payment_date; না থাকলে entry_date।
      const rec = r as Record<string, unknown>;
      const date = String(rec.payment_date ?? rec.entry_date ?? "");
      if (!best || date >= best.date) best = { date, amount: amt };
    }
    return best;
  }, [rows, receiptRows, paidCol, isCustomer]);

  const serialCode =
    contact?.serial_no != null
      ? partySerialCode(isCustomer ? "agent" : "vendor", contact.serial_no)
      : null;

  const applySrcMap = async (ledgerRows: LedgerRow[], offline: boolean) => {
    const map = new Map<string, SrcInfo>();
    // table -> [columns to select], with a normalizer for each row.
    const specs: Record<string, { cols: string; map: (r: Record<string, unknown>) => SrcInfo }> = {
      bmet_cards: {
        cols: "id,bmet_id,received_date,country_name,cancelled,cancel_reason,cancel_date",
        map: (r) => ({ displayId: r.bmet_id as string, countDate: r.received_date as string, country: r.country_name as string, cancelled: Boolean(r.cancelled), cancelReason: r.cancel_reason as string, cancelDate: r.cancel_date as string }),
      },
      saudi_visas: {
        cols: "id,saudi_id,received_date,cancelled,cancel_reason,cancel_date",
        map: (r) => ({ displayId: r.saudi_id as string, countDate: r.received_date as string, cancelled: Boolean(r.cancelled), cancelReason: r.cancel_reason as string, cancelDate: r.cancel_date as string }),
      },
      kuwait_visas: {
        cols: "id,kuwait_id,received_date,cancelled,cancel_reason,cancel_date",
        map: (r) => ({ displayId: r.kuwait_id as string, countDate: r.received_date as string, cancelled: Boolean(r.cancelled), cancelReason: r.cancel_reason as string, cancelDate: r.cancel_date as string }),
      },
      tickets: {
        cols: "id,ticket_id,airline,entry_date,cancelled,cancel_reason,cancel_date",
        map: (r) => ({ displayId: r.ticket_id as string, airline: r.airline as string, countDate: r.entry_date as string, cancelled: Boolean(r.cancelled), cancelReason: r.cancel_reason as string, cancelDate: r.cancel_date as string }),
      },
    };
    const byTable: Record<string, string[]> = {};
    for (const r of ledgerRows) {
      const src = String(r.source_table ?? "");
      const sid = String(r.source_id ?? "");
      if (sid && specs[src]) (byTable[src] ||= []).push(sid);
    }
    if (offline) {
      // Hydrate source info from the offline module snapshots (cache_v2_<table>).
      for (const [tbl, ids] of Object.entries(byTable)) {
        const cached = readModuleCache(tbl);
        const idSet = new Set(ids);
        for (const row of cached) {
          const rid = String((row as Record<string, unknown>).id ?? "");
          if (idSet.has(rid)) map.set(rid, specs[tbl].map(row as Record<string, unknown>));
        }
      }
    } else {
      await Promise.all(
        Object.entries(byTable).map(async ([tbl, ids]) => {
          if (!ids.length) return;
          const { data } = await supabase.from(tbl as never).select(specs[tbl].cols).in("id", ids);
          for (const row of (data as Record<string, unknown>[] | null) ?? []) {
            map.set(String(row.id), specs[tbl].map(row));
          }
        }),
      );
    }
    setSrcMap(map);
  };

  const receiptSelect =
    "id,receipt_id,entry_date,service_type,service_table,service_row_id,ref_id,passenger_name,amount,method,source,remarks,received_by_name,created_at";

  const isCountableReceipt = (r: Record<string, unknown>) => {
    const amount = Number(r.amount ?? 0);
    if (!(amount > 0)) return false;
    const source = String(r.source ?? "").trim().toLowerCase();
    const method = String(r.method ?? "").trim().toLowerCase();
    if (["discount", "status_event", "status_change", "status-delivery"].includes(source)) return false;
    if (method === "discount" || method === "status") return false;
    return true;
  };

  const loadAgencyReceipts = async (ledgerRows: LedgerRow[]) => {
    if (!isCustomer || ledgerRows.length === 0) {
      setReceiptRows([]);
      return;
    }

    const ledgerIds = ledgerRows.map((r) => String(r.id)).filter(Boolean);
    const sourceToLedgerIds = new Map<string, string[]>();
    const sourceIdsByTable = new Map<string, string[]>();
    for (const r of ledgerRows) {
      const srcTable = String(r.source_table ?? "").trim();
      const srcId = String(r.source_id ?? "").trim();
      if (!srcTable || !srcId) continue;
      const key = `${srcTable}:${srcId}`;
      sourceToLedgerIds.set(key, [...(sourceToLedgerIds.get(key) ?? []), String(r.id)]);
      sourceIdsByTable.set(srcTable, [...(sourceIdsByTable.get(srcTable) ?? []), srcId]);
    }

    const queries: Promise<{ data: unknown[] | null; error: unknown }>[] = [];
    if (ledgerIds.length > 0) {
      queries.push(
        supabase
          .from("payment_receipts" as never)
          .select(receiptSelect)
          .eq("service_table", "agency_ledger")
          .in("service_row_id", ledgerIds) as unknown as Promise<{ data: unknown[] | null; error: unknown }>,
      );
    }
    for (const [srcTable, ids] of sourceIdsByTable.entries()) {
      const uniqueIds = Array.from(new Set(ids));
      if (!uniqueIds.length) continue;
      queries.push(
        supabase
          .from("payment_receipts" as never)
          .select(receiptSelect)
          .eq("service_table", srcTable)
          .in("service_row_id", uniqueIds) as unknown as Promise<{ data: unknown[] | null; error: unknown }>,
      );
    }

    const results = await Promise.all(queries);
    const seen = new Set<string>();
    const rawReceipts: LedgerReceipt[] = [];
    for (const res of results) {
      for (const raw of (res.data as Record<string, unknown>[] | null) ?? []) {
        if (!isCountableReceipt(raw)) continue;
        const serviceTable = String(raw.service_table ?? "");
        const serviceRowId = String(raw.service_row_id ?? "");
        const source = String(raw.source ?? "").trim().toLowerCase();
        const ledgerTargets = serviceTable === "agency_ledger"
          ? [serviceRowId]
          : (sourceToLedgerIds.get(`${serviceTable}:${serviceRowId}`) ?? []);
        for (const ledgerRowId of ledgerTargets) {
          const key = `${raw.id}:${ledgerRowId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rawReceipts.push({
            id: String(raw.id ?? ""),
            receipt_id: raw.receipt_id ? String(raw.receipt_id) : null,
            entry_date: raw.entry_date ? String(raw.entry_date) : null,
            service_type: raw.service_type ? String(raw.service_type) : null,
            service_table: serviceTable || null,
            service_row_id: serviceRowId || null,
            ref_id: raw.ref_id ? String(raw.ref_id) : null,
            passenger_name: raw.passenger_name ? String(raw.passenger_name) : null,
            amount: Number(raw.amount ?? 0),
            method: raw.method ? String(raw.method) : null,
            source: raw.source ? String(raw.source) : null,
            remarks: raw.remarks ? String(raw.remarks) : null,
            received_by_name: raw.received_by_name ? String(raw.received_by_name) : null,
            created_at: raw.created_at ? String(raw.created_at) : null,
            ledgerRowId,
          });
        }
      }
    }

    // Normalize receipts per ledger row so a direct source receipt and its
    // agency-ledger mirror can never be shown twice. Prefer real source
    // receipts; use agency mirror receipts only for the uncovered cash amount.
    const ledgerById = new Map(ledgerRows.map((r) => [String(r.id), r]));
    const grouped = new Map<string, LedgerReceipt[]>();
    for (const rec of rawReceipts) {
      grouped.set(rec.ledgerRowId, [...(grouped.get(rec.ledgerRowId) ?? []), rec]);
    }
    const next: LedgerReceipt[] = [];
    const receiptPriority = (r: LedgerReceipt) => {
      const src = String(r.source ?? "").trim().toLowerCase();
      // The database can keep an automatic service_form mirror and a real due /
      // agency receipt for the same booking. For the passbook ledger, show the
      // real payment first; otherwise the old booking-date mirror can consume
      // the whole paid cap and display the wrong receive date/receiver.
      if (src === "service_form") return 3;
      if (src === "agency_ledger" || src === "agency_ledger_payment") return 2;
      return 1;
    };
    const byDate = (a: LedgerReceipt, b: LedgerReceipt) => {
      const p = receiptPriority(a) - receiptPriority(b);
      if (p !== 0) return p;
      return `${a.entry_date ?? ""}|${a.created_at ?? ""}`.localeCompare(`${b.entry_date ?? ""}|${b.created_at ?? ""}`);
    };
    for (const [ledgerRowId, list] of grouped.entries()) {
      const ledgerRow = ledgerById.get(ledgerRowId);
      const cashCap = Math.max(0, Number(ledgerRow?.[paidCol] ?? 0));
      if (cashCap <= 0) continue;
      let remaining = cashCap;
      const direct = list.filter((r) => String(r.service_table ?? "") !== "agency_ledger").sort(byDate);
      const mirrors = list.filter((r) => String(r.service_table ?? "") === "agency_ledger").sort(byDate);
      for (const rec of [...direct, ...mirrors]) {
        if (remaining <= 0.0001) break;
        const amt = Math.min(Number(rec.amount ?? 0), remaining);
        if (amt <= 0) continue;
        next.push({ ...rec, amount: amt });
        remaining -= amt;
      }
    }
    next.sort((a, b) => `${a.entry_date ?? ""}|${a.created_at ?? ""}`.localeCompare(`${b.entry_date ?? ""}|${b.created_at ?? ""}`));
    setReceiptRows(next);
  };

  const setSummaryFromBalRows = (balRows: Record<string, unknown>[]) => {
    const nameKey = isCustomer ? "agent_name" : "vendor_name";
    const billKey = isCustomer ? "total_bill" : "total_payable";
    const paidKey = isCustomer ? "total_received" : "total_paid";
    const mine = balRows.find((b) => String(b[nameKey] ?? "") === displayName);
    setSummary({
      bill: Number(mine?.[billKey] ?? 0),
      paid: Number(mine?.[paidKey] ?? 0),
      due: Number(mine?.balance_due ?? 0),
      advance: Number(mine?.advance_balance ?? 0),
    });
  };

  const mergeContactRows = (contactRows: Contact[]): Contact | null =>
    contactRows.length
      ? {
          phone: contactRows.find((c) => c.phone)?.phone ?? null,
          phone_labels: contactRows.find((c) => c.phone)?.phone_labels ?? null,
          address: contactRows.find((c) => c.address)?.address ?? null,
          // স্পষ্ট মান থাকলে তা-ই রাখি; না থাকলে null রেখে দিই যাতে উপরের
          // kind-ভিত্তিক ডিফল্ট (এজেন্সি→one_by_one, ভেন্ডর→total) প্রয়োগ হয়।
          settle_mode: contactRows.some((c) => c.settle_mode === "one_by_one")
            ? "one_by_one"
            : contactRows.some((c) => c.settle_mode === "total")
              ? "total"
              : null,
          serial_no: contactRows.find((c) => c.serial_no != null)?.serial_no ?? null,
          full_name: contactRows.find((c) => c.full_name)?.full_name ?? null,
          notes: contactRows.find((c) => c.notes)?.notes ?? null,
        }
      : null;

  // Offline fallback: rebuild everything from the cached snapshots written by
  // the "অফলাইনে সেভ" button.
  const loadFromCache = async () => {
    const allLedger = cacheRead<LedgerRow[]>(table) ?? [];
    const ledgerRows = allLedger
      .filter((r) => String((r as Record<string, unknown>)[groupField] ?? "") === displayName)
      .sort((a, b) => {
        const da = String((a as Record<string, unknown>).entry_date ?? "");
        const db = String((b as Record<string, unknown>).entry_date ?? "");
        if (da !== db) return da < db ? -1 : 1;
        const ca = String((a as Record<string, unknown>).created_at ?? "");
        const cb = String((b as Record<string, unknown>).created_at ?? "");
        return ca < cb ? -1 : ca > cb ? 1 : 0;
      });
    setRows(ledgerRows);
    setReceiptRows([]);

    const allContacts = cacheRead<Contact[]>(contactsTable) ?? [];
    const mine = allContacts.filter(
      (c) => String((c as unknown as Record<string, unknown>).name ?? "") === displayName,
    );
    setContact(mergeContactRows(mine));

    const balRows = cacheRead<Record<string, unknown>[]>(isCustomer ? "bal_agent" : "bal_vendor") ?? [];
    setSummaryFromBalRows(balRows);

    await applySrcMap(ledgerRows, true);
  };

  const load = async () => {
    setLoading(true);
    if (isOffline()) {
      await loadFromCache();
      setLoading(false);
      return;
    }
    try {
      const [ledgerRes, contactRes, balRes] = await Promise.all([
        supabase
          .from(table as never)
          .select("*")
          .eq(groupField, displayName)
          .order("entry_date", { ascending: true })
          .order("created_at", { ascending: true })
          .limit(1000),
        supabase
          .from(contactsTable as never)
          .select("phone,phone_labels,address,settle_mode,serial_no,full_name,notes")
          .eq("name", displayName)
          .order("settle_mode", { ascending: true })
          .limit(10),

        supabase.rpc((isCustomer ? "get_agent_balances" : "get_vendor_balances") as never),
      ]);
      if (ledgerRes.error) throw ledgerRes.error;
      const ledgerRows = (ledgerRes.data as unknown as LedgerRow[]) ?? [];
      setRows(ledgerRows);
      await loadAgencyReceipts(ledgerRows);
      // Duplicate-tolerant: a name should map to one contact, but if stale
      // duplicates ever exist, merge them so an explicit "এক একটা বিল" choice
      // and any saved phone/address are never lost.
      const contactRows = (contactRes.data as Contact[] | null) ?? [];
      setContact(mergeContactRows(contactRows));

      // Pick this party's authoritative balance row.
      const balRows = (balRes.data as unknown as Record<string, unknown>[]) ?? [];
      setSummaryFromBalRows(balRows);

      await applySrcMap(ledgerRows, false);
    } catch {
      // Network failed mid-session — fall back to the offline snapshot.
      await loadFromCache();
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!displayName) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayName, table]);

  type BillPay = {
    date: string;
    amt: number;
    method: string;
    /** payment_receipts.id (uuid) when this instalment maps to a real receipt. */
    rowId?: string;
    /** agency_ledger row id this instalment settled. */
    ledgerRowId?: string;
    /** true = a real cash receipt that can be reversed/deleted (customer only). */
    deletable?: boolean;
  };

  const vendorPaymentAlloc = useMemo(() => {
    const cashByPaymentLog = new Map<string, number>();
    const coveredByBill = new Map<string, number>();
    const paymentsByBill = new Map<string, BillPay[]>();
    if (isCustomer) return { cashByPaymentLog, coveredByBill, paymentsByBill };

    // PAYMENT rows keep the original per-bill allocation history. If a source
    // bill's vendor cost is later corrected downward, the bill's paid_amount is
    // capped by the database, but old alloc_detail can still contain the higher
    // historical amount. Clamp allocations to the bill's current paid_amount so
    // the running ledger always reconciles with the authoritative balance.
    const remainingByBill = new Map<string, number>();
    for (const r of rows) {
      const svc = String(r.service_type ?? "").toUpperCase();
      if (svc === "PAYMENT" || svc === "ADVANCE") continue;
      remainingByBill.set(String(r.id), Math.max(0, Number(r[paidCol] ?? 0)));
    }

    const paymentRows = rows
      .filter((r) => String(r.service_type ?? "").toUpperCase() === "PAYMENT")
      .sort((a, b) => {
        const ak = `${String(a.payment_date ?? a.entry_date ?? "")}|${String(a.created_at ?? "")}|${String(a.ledger_id ?? "")}`;
        const bk = `${String(b.payment_date ?? b.entry_date ?? "")}|${String(b.created_at ?? "")}|${String(b.ledger_id ?? "")}`;
        return ak.localeCompare(bk);
      });

    for (const r of paymentRows) {
      const det = (r as Record<string, unknown>).alloc_detail as
        | { items?: Array<{ id?: string; amt?: number }> }
        | null;
      const pdate = String(r.payment_date ?? r.entry_date ?? "");
      const method = String(r.payment_method ?? "");
      let logCash = 0;
      for (const it of det?.items ?? []) {
        const bid = String(it?.id ?? "");
        const requested = Math.max(0, Number(it?.amt ?? 0));
        if (!bid || requested <= 0) continue;
        const hasCap = remainingByBill.has(bid);
        const take = hasCap ? Math.min(requested, Math.max(0, remainingByBill.get(bid) ?? 0)) : requested;
        if (take <= 0) continue;
        if (hasCap) remainingByBill.set(bid, Math.max(0, (remainingByBill.get(bid) ?? 0) - take));
        logCash += take;
        coveredByBill.set(bid, (coveredByBill.get(bid) ?? 0) + take);
        const arr = paymentsByBill.get(bid) ?? [];
        arr.push({ date: pdate, amt: take, method });
        paymentsByBill.set(bid, arr);
      }
      cashByPaymentLog.set(String(r.id), logCash);
    }

    return { cashByPaymentLog, coveredByBill, paymentsByBill };
  }, [rows, paidCol, isCustomer]);


  const beginEdit = () => {
    const nums = (contact?.phone ?? "").split(",").map((p) => p.trim());
    const labels = (contact?.phone_labels ?? "").split(",").map((l) => l.trim());
    const pairs = nums
      .map((ph, i) => ({ phone: ph, label: labels[i] ?? "" }))
      .filter((x) => x.phone);
    setForm({
      name: displayName,
      fullName: contact?.full_name ?? "",
      phones: pairs.length ? pairs.map((p) => p.phone) : [""],
      phoneLabels: pairs.length ? pairs.map((p) => p.label) : [""],
      address: contact?.address ?? "",
      settleMode,
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    const newName = form.name.trim();
    if (!newName) {
      toast.error("নাম খালি রাখা যাবে না");
      return;
    }
    setSaving(true);
    const oldName = displayName;
    const codeCol = isCustomer ? "agent_code" : "vendor_code";
    // Keep phone numbers and their labels aligned by index; drop empty numbers.
    const phonePairs = form.phones
      .map((p, i) => ({ phone: p.trim(), label: (form.phoneLabels[i] ?? "").replace(/,/g, " ").trim() }))
      .filter((x) => x.phone);
    const phoneStr = phonePairs.map((p) => p.phone).join(", ") || null;
    const phoneLabelsStr = phonePairs.some((p) => p.label)
      ? phonePairs.map((p) => p.label).join(", ")
      : null;
    const { data: existingBeforeRename } = await supabase
      .from(contactsTable as never)
      .select("id")
      .eq("name", oldName)
      .limit(1)
      .maybeSingle();
    const existingId = (existingBeforeRename as ContactId | null)?.id;

    if (newName !== oldName && oldName) {
      const { error: renameErr } = await supabase.rpc("rename_party", {
        p_kind: kind,
        p_old_name: oldName,
        p_new_name: newName,
      });
      if (renameErr) {
        setSaving(false);
        toast.error("নাম পরিবর্তন ব্যর্থ: " + renameErr.message);
        return;
      }
    }

    const fullNameVal = form.fullName.trim() || null;
    let err = null;
    if (existingId) {
      const { error } = await supabase
        .from(contactsTable as never)
        .update({ name: newName, full_name: fullNameVal, phone: phoneStr, phone_labels: phoneLabelsStr, address: form.address.trim() || null, settle_mode: form.settleMode } as never)
        .eq("id", existingId);
      err = error;
    } else {
      const { data: existingAfterRename } = await supabase
        .from(contactsTable as never)
        .select("id")
        .eq("name", newName)
        .limit(1)
        .maybeSingle();
      const newExistingId = (existingAfterRename as ContactId | null)?.id;
      if (newExistingId) {
        const { error } = await supabase
          .from(contactsTable as never)
          .update({ name: newName, full_name: fullNameVal, phone: phoneStr, phone_labels: phoneLabelsStr, address: form.address.trim() || null, settle_mode: form.settleMode } as never)
          .eq("id", newExistingId);
        err = error;
      } else {
        const code = `${isCustomer ? "AG" : "VN"}-${Date.now().toString().slice(-6)}`;
        const { error } = await supabase
          .from(contactsTable as never)
          .insert({ [codeCol]: code, name: newName, full_name: fullNameVal, phone: phoneStr, phone_labels: phoneLabelsStr, address: form.address.trim() || null, settle_mode: form.settleMode } as never);
        err = error;
      }
    }

    setSaving(false);
    if (err) {
      toast.error("সংরক্ষণ ব্যর্থ: " + err.message);
      return;
    }
    setContact((c) => ({ ...(c ?? {}), full_name: fullNameVal, phone: phoneStr, phone_labels: phoneLabelsStr, address: form.address.trim() || null, settle_mode: form.settleMode }));
    setDisplayName(newName);
    setEditing(false);
    toast.success("তথ্য সংরক্ষণ হয়েছে");
  };

  // Keep the note draft in sync with the loaded contact (unless actively editing it).
  useEffect(() => {
    if (!noteEditing) setNoteDraft(contact?.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact?.notes]);

  const saveNote = async () => {
    setNoteSaving(true);
    const noteVal = noteDraft.trim() || null;
    const codeCol = isCustomer ? "agent_code" : "vendor_code";
    const { data: existing } = await supabase
      .from(contactsTable as never)
      .select("id")
      .eq("name", displayName)
      .limit(1)
      .maybeSingle();
    const existingId = (existing as ContactId | null)?.id;
    let err = null;
    if (existingId) {
      const { error } = await supabase
        .from(contactsTable as never)
        .update({ notes: noteVal } as never)
        .eq("id", existingId);
      err = error;
    } else {
      const code = `${isCustomer ? "AG" : "VN"}-${Date.now().toString().slice(-6)}`;
      const { error } = await supabase
        .from(contactsTable as never)
        .insert({ [codeCol]: code, name: displayName, notes: noteVal } as never);
      err = error;
    }
    setNoteSaving(false);
    if (err) {
      toast.error("নোট সংরক্ষণ ব্যর্থ: " + err.message);
      return;
    }
    setContact((c) => ({ ...(c ?? {}), notes: noteVal }));
    setNoteEditing(false);
    toast.success("নোট সংরক্ষণ হয়েছে");
  };

  const openManual = (k: "income" | "expense") => {
    setManualForm({
      vendor: name || "",
      amount: "",
      date: new Date().toISOString().slice(0, 10),
      note: "",
    });
    setManualKind(k);
  };

  const saveManual = async () => {
    const vendor = manualForm.vendor.trim();
    const amount = Number(manualForm.amount);
    if (!vendor) {
      toast.error("Vendor নির্বাচন করুন");
      return;
    }
    if (!amount || amount <= 0) {
      toast.error("সঠিক পরিমাণ লিখুন");
      return;
    }
    setManualSaving(true);
    const mod = moduleByKey("vendor-ledger")!;
    const ledgerId = await generateNextId(mod, manualForm.date);
    const note = manualForm.note.trim();

    // আয় (income): vendor refund / bonus — treated as a vendor advance (+),
    //   added to the vendor's balance, balance-neutral on the cash box.
    // ব্যায় (expense): extra charge owed to the vendor (void/date-change, etc.) —
    //   recorded as an additional payable (−).
    const payload =
      manualKind === "income"
        ? {
            ledger_id: ledgerId,
            entry_date: manualForm.date,
            payment_date: manualForm.date,
            vendor_name: vendor,
            service_type: "ADVANCE",
            total_payable: 0,
            paid_amount: amount,
            payment_method: "adjustment",
            remarks: note ? `আয়: ${note}` : "আয় (ম্যানুয়াল)",
            created_by: user?.id ?? null,
          }
        : {
            ledger_id: ledgerId,
            entry_date: manualForm.date,
            vendor_name: vendor,
            service_type: "ম্যানুয়াল ব্যায়",
            total_payable: amount,
            paid_amount: 0,
            remarks: note || "ব্যায় (ম্যানুয়াল)",
            created_by: user?.id ?? null,
          };

    const { error } = await supabase
      .from("vendor_ledger" as never)
      .insert(payload as never);
    setManualSaving(false);
    if (error) {
      toast.error("সংরক্ষণ ব্যর্থ: " + error.message);
      return;
    }
    toast.success(manualKind === "income" ? "আয় এন্ট্রি যুক্ত হয়েছে" : "ব্যায় এন্ট্রি যুক্ত হয়েছে");
    setManualKind(null);
    if (displayName) void load();
  };



  // Build the running statement (chronological). Mirrors get_agent_balances /
  // get_vendor_balances so the final running balance reconciles with the summary.
  const statement = useMemo(() => {
    type Stmt = {
      id: string;
      ledgerId: string;
      date: string;
      service: string;
      description: string;
      previous: number;
      deposit: number;
      credit: number;
      balance: number;
      advance: number;
      isPayment: boolean;
      // agency side: source work not yet received from vendor / not delivery-ready
      incomplete?: boolean;
      // source booking soft-cancelled (বাতিল কাজ) — shown greyed, financials kept
      cancelled?: boolean;
      cancelReason?: string | null;
      cancelDate?: string | null;
      // Reversible cash-receipt targets behind a "পেমেন্ট গ্রহণ" / advance row.
      paymentTargets?: { rowId?: string; ledgerRowId?: string; amount: number }[];
    };

    // VENDOR: uniform ledger for every vendor.
    //  • Deposit/Payment (money paid to vendor) increases the balance (+).
    //  • Credit (vendor cost) decreases the balance (−).
    //  • Final balance: positive = I overpaid (Adv), negative = vendor owed (V Due).
    if (!isCustomer) {
      const moduleLabel: Record<string, string> = {
        bmet_cards: "BMET Card",
        saudi_visas: "Saudi Visa",
        kuwait_visas: "Kuwait Visa",
        tickets: "Ticket",
      };
      // 1) Prepare each visible row with its effective count-date and fields.
      type Prep = Omit<Stmt, "previous" | "balance"> & { sortKey: string; cash: number; bill: number };
      const prepped: Prep[] = [];
      for (const r of rows) {
        const svc = String(r.service_type ?? "").toUpperCase();
        // 'PAYMENT' rows are the green payment record. The money they paid is
        // removed from each covered bill's Payment column (via coveredByBill)
        // and shown here once, so totals still reconcile.
        const isPaymentLog = svc === "PAYMENT";
        const isDeposit = svc === "ADVANCE";
        const src = String(r.source_table ?? "");
        const sid = String(r.source_id ?? "");
        const info = srcMap.get(sid);
        // Delivery items (BMET/Saudi/Kuwait) count only once received.
        const sourced = src === "bmet_cards" || src === "saudi_visas" || src === "kuwait_visas";
        const counts = !sourced || Boolean(info?.countDate);
        if (!isDeposit && !isPaymentLog && !counts) continue;


        const rawPaid = Number(r[paidCol] ?? 0);
        let cash: number;
        let displayPaid: number;
        let bill: number;
        if (isPaymentLog) {
          // Green Payment row: count exactly what it allocated to bills so it
          // cancels the covered portion removed from those bills; show the
          // currently effective amount paid.
          cash = vendorPaymentAlloc.cashByPaymentLog.get(String(r.id)) ?? 0;
          displayPaid = cash;
          bill = 0;
        } else if (isDeposit) {
          cash = rawPaid;
          displayPaid = rawPaid;
          bill = 0;
        } else {
          // Bill row: show its cost as Credit. Only the portion of paid_amount
          // NOT already shown on a green Payment row appears in the Payment
          // column (e.g. direct / Vendor-Received settlements that have no log).
          const covered = vendorPaymentAlloc.coveredByBill.get(String(r.id)) ?? 0;
          const net = Math.max(0, rawPaid - covered);
          cash = net;
          displayPaid = net;
          bill = Number(r[billCol] ?? 0);
        }

        // Date: deposit -> payment date; delivery item -> received date; else entry date.
        const date = isDeposit
          ? String(r.payment_date ?? r.entry_date ?? "")
          : isPaymentLog
            ? String(r.payment_date ?? r.entry_date ?? "")
          : String(info?.countDate ?? r.entry_date ?? "");

        // Module id from the source record so the full id shows.
        const idText = (sourced || src === "tickets" || src === "extra_services") && info?.displayId
          ? String(info.displayId)
          : String(r.ledger_id ?? "");

        // Service type label.
        let service: string;
        if (isDeposit || isPaymentLog) service = "Payment";
        else if (moduleLabel[src]) service = moduleLabel[src];
        else service = String(r.service_type ?? "—");

        // Description: passenger + trip/airline (ticket) or country (bmet).
        const route = String(r.country_route ?? "").trim();
        const parts: string[] = [];
        const pax = String(r.passenger_name ?? "").trim();
        if (pax) parts.push(pax);
        if (src === "tickets") {
          if (route) parts.push(route);
          if (info?.airline) parts.push(String(info.airline));
        } else if (src === "bmet_cards") {
          if (info?.country || route) parts.push(String(info?.country ?? route));
        } else if (route) {
          parts.push(route);
        }
        const desc = parts.join(" · ") || String(r.remarks ?? "").trim();

        prepped.push({
          id: String(r.id),
          ledgerId: idText,
          date,
          service,
          description: desc,
          deposit: displayPaid,
          credit: bill,
          advance: 0,
          cash,
          bill,
          isPayment: isDeposit || isPaymentLog,
          cancelled: Boolean(info?.cancelled),
          cancelReason: info?.cancelReason ?? null,
          cancelDate: info?.cancelDate ?? null,
          sortKey: `${date || "0000-00-00"}|${String(r.created_at ?? "")}`,
        });
      }

      // 2) Chronological order so the running balance is meaningful.
      prepped.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

      // 3) Running balance: deposit (+), credit (−).
      let bal = 0;
      const out: Stmt[] = prepped.map((p) => {
        const prev = bal;
        bal = prev + p.cash - p.bill;
        return {
          id: p.id,
          ledgerId: p.ledgerId,
          date: p.date,
          service: p.service,
          description: p.description,
          previous: prev,
          deposit: p.deposit,
          credit: p.credit,
          balance: bal,
          advance: 0,
          isPayment: p.isPayment,
          cancelled: p.cancelled,
          cancelReason: p.cancelReason,
          cancelDate: p.cancelDate,
        };
      });

      // 4) Latest entry on top.
      return out.reverse();
    }

    // CUSTOMER: show real receipt entries on their actual receive dates. The
    // bill row carries the bill/discount/advance-applied math; payment_receipts
    // rows carry cash receive history so a later payment no longer appears as if
    // it was received on the original bill date.
    const receiptsByLedger = new Map<string, LedgerReceipt[]>();
    const receiptSumByLedger = new Map<string, number>();
    for (const rec of receiptRows) {
      const arr = receiptsByLedger.get(rec.ledgerRowId) ?? [];
      arr.push(rec);
      receiptsByLedger.set(rec.ledgerRowId, arr);
      receiptSumByLedger.set(rec.ledgerRowId, (receiptSumByLedger.get(rec.ledgerRowId) ?? 0) + Number(rec.amount ?? 0));
    }

    let bal = 0;
    let adv = 0;
    type Prep = Omit<Stmt, "previous" | "balance"> & { sortKey: string; deltaBalance: number; advanceDelta: number };
    const prepped: Prep[] = [];
    // Collect every "Payment Receive" (cash actually received from the agent) so
    // multiple receipts landing on the SAME date are shown as ONE combined
    // payment-receive row (e.g. all the 21 Jun / 4 Jul receipts merge into one).
    type PayItem = { date: string; amount: number; method: string; passenger: string; receiver: string; receiptId: string; createdAt: string; rowId: string; ledgerRowId: string };
    const payItems: PayItem[] = [];
    for (const r of rows) {
      const svc = String(r.service_type ?? "").toUpperCase();
      if (svc === "PAYMENT") continue;
      const advRow = svc === "ADVANCE";
      const cash = Number(r[paidCol] ?? 0);
      const applied = Number(r.advance_applied ?? 0);
      const bill = Number(r[billCol] ?? 0);
      const discount = Number(r.discount_amount ?? 0);
      const ledgerRowId = String(r.id);
      const receiptTotal = receiptSumByLedger.get(ledgerRowId) ?? 0;
      const unreceiptedCash = advRow ? 0 : Math.max(0, cash - receiptTotal);

      // কাজ এখনো সম্পন্ন হয়নি? BMET/Saudi/Kuwait এন্ট্রি যা ভেন্ডর থেকে এখনো
      // received হয়নি (received_date নেই) সেগুলো অসম্পূর্ণ — ধূসর দেখানো হবে।
      const cSrc = String(r.source_table ?? "");
      const cSourced =
        cSrc === "bmet_cards" || cSrc === "saudi_visas" || cSrc === "kuwait_visas";
      const cInfo = srcMap.get(String(r.source_id ?? ""));
      const incomplete = !advRow && cSourced && !cInfo?.countDate;
      // তারিখ: টিকিট → Issue (entry) date, BMET/ভিসা → ভেন্ডর থেকে received date
      // (দুটোই srcMap.countDate থেকে আসে); সোর্স তারিখ না থাকলে লেজার entry_date।
      // পেমেন্ট (advance) হলে গ্রহণের তারিখ।
      const cDate = advRow
        ? String(r.payment_date ?? r.entry_date ?? "")
        : String(cInfo?.countDate ?? r.entry_date ?? "");
      // আইডি: সোর্স মডিউলের আসল আইডি (TKT-…, bmet_id, saudi_id, kuwait_id)
      // থাকলে সেটি, না থাকলে লেজারের নিজের আইডি।
      const cId = cInfo?.displayId ? String(cInfo.displayId) : String(r.ledger_id ?? "");
      prepped.push({
        id: ledgerRowId,
        ledgerId: cId,
        date: cDate,
        service: advRow ? "Payment" : String(r.service_type ?? "—"),
        description: String(r.passenger_name ?? "").trim(),
        // পাসবই লজিক: advance/জমা রো "ডিপোজিট" হিসেবে চলমান বাকি (Balance)
        // সরাসরি কমায়; আর প্রতিটি বিল তার পুরো নিট পরিমাণ (বিল − ডিসকাউন্ট)
        // "Credit" হিসেবে বাকি বাড়ায়। এভাবে জমা করা advance পরের বিলে
        // স্বয়ংক্রিয়ভাবে সমন্বয় হয়ে বাকি পরিশোধ হয়ে যায় দেখা যায়। (আগে
        // advance_applied বিল থেকে বাদ দেওয়ায় জমাটা বাকির সাথে মিলত না।)
        deposit: advRow ? cash : 0,
        credit: advRow ? 0 : bill - discount,
        advance: 0,
        isPayment: advRow,
        incomplete,
        cancelled: !advRow && Boolean(cInfo?.cancelled),
        cancelReason: cInfo?.cancelReason ?? null,
        cancelDate: cInfo?.cancelDate ?? null,
        // Advance/opening deposit rows can be reversed via their ledger row.
        paymentTargets: advRow && cash > 0 ? [{ ledgerRowId, amount: cash }] : undefined,
        sortKey: `${cDate || "0000-00-00"}|${String(r.created_at ?? "")}|0`,
        deltaBalance: advRow ? -cash : bill - discount,
        advanceDelta: advRow ? cash : -applied,

      });

      if (!advRow) {
        for (const rec of receiptsByLedger.get(ledgerRowId) ?? []) {
          payItems.push({
            date: String(rec.entry_date ?? r.payment_date ?? r.entry_date ?? ""),
            amount: Number(rec.amount ?? 0),
            method: String(rec.method ?? "").trim(),
            passenger: String(rec.passenger_name ?? r.passenger_name ?? "").trim(),
            receiver: String(rec.received_by_name ?? "").trim(),
            receiptId: String(rec.receipt_id ?? rec.ref_id ?? r.ledger_id ?? ""),
            createdAt: String(rec.created_at ?? ""),
            rowId: String(rec.id ?? ""),
            ledgerRowId,
          });
        }
        if (unreceiptedCash > 0.0001) {
          payItems.push({
            date: String(r.payment_date ?? r.entry_date ?? ""),
            amount: unreceiptedCash,
            method: String(r.payment_method ?? "Cash").trim() || "Cash",
            passenger: String(r.passenger_name ?? "").trim(),
            receiver: String((r as Record<string, unknown>).received_by_name ?? "").trim(),
            receiptId: String(r.ledger_id ?? ""),
            createdAt: String(r.updated_at ?? r.created_at ?? ""),
            rowId: "",
            ledgerRowId,
          });
        }
      }
    }

    // Merge every payment received on the SAME calendar date into ONE
    // "Payment Receive" row. All methods are shown; a single receipt keeps its
    // passenger/method detail, several receipts show the count + methods.
    const payByDate = new Map<string, PayItem[]>();
    for (const p of payItems) {
      const arr = payByDate.get(p.date) ?? [];
      arr.push(p);
      payByDate.set(p.date, arr);
    }
    for (const [date, items] of payByDate.entries()) {
      const amount = items.reduce((s, i) => s + i.amount, 0);
      if (amount <= 0.0001) continue;
      const methods = Array.from(new Set(items.map((i) => i.method).filter(Boolean)));
      const earliest = items.map((i) => i.createdAt).filter(Boolean).sort()[0] ?? "";
      // "মোট বিলের হিসাব" (total) ledger: the payment-receive row shows ONLY
      // "পেমেন্ট গ্রহণ" + the method(s) — no passenger / receiver detail.
      const description = `পেমেন্ট গ্রহণ${methods.length ? ` · ${methods.join(", ")}` : ""}`;
      const ledgerId = items.length > 1 ? `${items.length}টি রসিদ` : items[0].receiptId;
      prepped.push({
        id: `receipt-day-${date}`,
        ledgerId,
        date,
        service: "Payment Receive",
        description,
        deposit: amount,
        credit: 0,
        advance: 0,
        isPayment: true,
        sortKey: `${date || "0000-00-00"}|${earliest}|1`,
        deltaBalance: -amount,
        advanceDelta: 0,
        paymentTargets: items
          .filter((i) => i.amount > 0 && (i.rowId || i.ledgerRowId))
          .map((i) => ({ rowId: i.rowId || undefined, ledgerRowId: i.ledgerRowId || undefined, amount: i.amount })),
      });
    }

    prepped.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    const out: Stmt[] = prepped.map((p) => {
      const prev = bal;
      bal = prev + p.deltaBalance;
      adv = Math.max(adv + p.advanceDelta, 0);
      return {
        id: p.id,
        ledgerId: p.ledgerId,
        date: p.date,
        service: p.service,
        description: p.description,
        previous: prev,
        deposit: p.deposit,
        credit: p.credit,
        balance: bal,
        advance: Math.max(adv, 0),
        isPayment: p.isPayment,
        incomplete: p.incomplete,
        cancelled: p.cancelled,
        cancelReason: p.cancelReason,
        cancelDate: p.cancelDate,
        paymentTargets: p.paymentTargets,
      };
    });
    // Latest entry on top (same as the vendor ledger).
    return out.reverse();
  }, [rows, receiptRows, billCol, paidCol, isCustomer, srcMap, vendorPaymentAlloc]);

  // Per-bill breakdown for "এক একটা বিল" (Bill-by-Bill) parties. Each booking is
  // shown with its own বাকি / আংশিক / পরিশোধিত status so one-by-one settlement is
  // crystal clear.
  type BillItem = {
    id: string;
    ledgerId: string;
    date: string;
    service: string;
    description: string;
    /** Passenger name only (shown first + bold in bill-by-bill print). */
    passenger: string;
    /** Trip/route/country only, without the passenger name. */
    route: string;
    bill: number;
    paid: number;
    due: number;
    status: "due" | "partial" | "paid";
    /** Each instalment that settled this bill (date · amount · method). */
    payments: BillPay[];
    /** Last payment date (latest dated instalment), "" if none dated. */
    payDate: string;
    /** Days a still-open bill has been outstanding (today − bill date). */
    ageDays: number | null;
    /** For settled bills: days taken to clear (payDate − bill date). */
    paidInDays: number | null;
    /** Source booking soft-cancelled (বাতিল কাজ). */
    cancelled?: boolean;
    cancelReason?: string | null;
    cancelDate?: string | null;
  };
  const sortBillsDueFirstNewest = (items: BillItem[]) =>
    [...items].sort((a, b) => {
      const ar = a.status !== "paid" ? 0 : 1;
      const br = b.status !== "paid" ? 0 : 1;
      if (ar !== br) return ar - br;
      const d = (b.date || "").localeCompare(a.date || "");
      if (d !== 0) return d;
      return (b.ledgerId || "").localeCompare(a.ledgerId || "");
    });
  const bills = useMemo<BillItem[]>(() => {
    const moduleLabel: Record<string, string> = {
      bmet_cards: "BMET Card",
      saudi_visas: "Saudi Visa",
      kuwait_visas: "Kuwait Visa",
      tickets: "Ticket",
    };
    const t = todayISO();
    // Vendor: map each bill row id -> dated payment instalments pulled from the
    // green PAYMENT rows' alloc_detail (so every settlement carries its date).
    const payByBill = new Map<string, BillPay[]>();
    if (isCustomer) {
      for (const rec of receiptRows) {
        const arr = payByBill.get(rec.ledgerRowId) ?? [];
        arr.push({
          date: String(rec.entry_date ?? ""),
          amt: Number(rec.amount ?? 0),
          method: String(rec.method ?? ""),
          rowId: rec.id,
          ledgerRowId: rec.ledgerRowId,
          deletable: true,
        });
        payByBill.set(rec.ledgerRowId, arr);
      }
    } else {
      for (const [bid, list] of vendorPaymentAlloc.paymentsByBill.entries()) {
        payByBill.set(bid, [...list]);
      }
    }
    const out: BillItem[] = [];
    for (const r of rows) {
      const svc = String(r.service_type ?? "").toUpperCase();
      if (svc === "PAYMENT" || svc === "ADVANCE") continue;
      const src = String(r.source_table ?? "");
      const sid = String(r.source_id ?? "");
      const info = srcMap.get(sid);
      const bill = Number(r[billCol] ?? 0);
      if (bill <= 0) continue;
      if (!isCustomer) {
        const sourced = src === "bmet_cards" || src === "saudi_visas" || src === "kuwait_visas";
        if (sourced && !info?.countDate) continue; // not yet received -> not a due bill
      }
      const direct = Number(r[paidCol] ?? 0);
      const adv = Number(r.advance_applied ?? 0);
      const disc = Number(r.discount_amount ?? 0);
      const paid = isCustomer ? direct + adv + disc : direct + adv;

      // Build the instalment list (date · amount · method) for this bill.
      const rowPayDate = String(r.payment_date ?? "");
      const rowMethod = String(r.payment_method ?? "");
      const payments: BillPay[] = [];
      if (isCustomer) {
        const linked = payByBill.get(String(r.id)) ?? [];
        for (const p of linked) payments.push(p);
        const covered = linked.reduce((s, p) => s + p.amt, 0);
        const directNet = Math.max(0, direct - covered);
        if (directNet > 0) payments.push({ date: rowPayDate, amt: directNet, method: rowMethod || "Cash", ledgerRowId: String(r.id), deletable: true });
        if (adv > 0) payments.push({ date: rowPayDate, amt: adv, method: "অ্যাডভান্স" });
        if (disc > 0) payments.push({ date: rowPayDate, amt: disc, method: "ডিসকাউন্ট" });
      } else {
        const linked = payByBill.get(String(r.id)) ?? [];
        for (const p of linked) payments.push(p);
        const covered = linked.reduce((s, p) => s + p.amt, 0);
        const directNet = Math.max(0, direct - covered);
        if (directNet > 0) payments.push({ date: rowPayDate, amt: directNet, method: rowMethod || "Cash" });
        if (adv > 0) payments.push({ date: rowPayDate, amt: adv, method: "অ্যাডভান্স" });
      }
      const datedSorted = payments.map((p) => p.date).filter(Boolean).sort();
      const payDate = datedSorted.length ? datedSorted[datedSorted.length - 1] : "";

      // Soft-cancelled jobs (কাজ বাতিল/ফেরত) for BMET / Saudi / Kuwait keep their
      // financial rows but must NOT count as an outstanding due — they are shown
      // greyed. Tickets are intentionally excluded here: a cancelled ticket keeps
      // a legitimate office-refund / void-fee payable, so it stays a real due.
      const softCancelled =
        Boolean(info?.cancelled) &&
        (src === "bmet_cards" || src === "saudi_visas" || src === "kuwait_visas");
      const due = softCancelled ? 0 : Math.max(0, bill - paid);
      const status: BillItem["status"] = softCancelled
        ? "paid"
        : due <= 0.5 ? "paid" : paid > 0 ? "partial" : "due";
      const idText =
        (src && (moduleLabel[src] || src === "extra_services")) && info?.displayId
          ? String(info.displayId)
          : String(r.ledger_id ?? "");
      const date = String(info?.countDate ?? r.entry_date ?? "");
      const pax = String(r.passenger_name ?? "").trim();
      const route = String(r.country_route ?? "").trim();
      const desc = [pax, route].filter(Boolean).join(" · ") || String(r.remarks ?? "").trim();
      out.push({
        id: String(r.id),
        ledgerId: idText,
        date,
        service: moduleLabel[src] || String(r.service_type ?? "—"),
        description: desc,
        passenger: pax,
        route,
        bill,
        paid,
        due,
        status,
        payments,
        payDate,
        ageDays: status === "paid" ? null : daysBetween(date, t),
        paidInDays: status === "paid" ? daysBetween(date, payDate) : null,
        cancelled: Boolean(info?.cancelled),
        cancelReason: info?.cancelReason ?? null,
        cancelDate: info?.cancelDate ?? null,
      });
    }
    // বাকি/আংশিক বিল সব একসাথে উপরে; সেই গ্রুপের মধ্যে নতুন উপরে, পুরনো নিচে।
    return sortBillsDueFirstNewest(out);
  }, [rows, receiptRows, billCol, paidCol, isCustomer, srcMap, vendorPaymentAlloc]);

  const billStats = useMemo(() => {
    let dueCount = 0,
      paidCount = 0,
      partialCount = 0,
      dueAmount = 0;
    // AR/AP aging buckets on the outstanding amount.
    let bucketCurrent = 0, // 0–30 days
      bucketMid = 0, // 31–60 days
      bucketOld = 0; // 60+ days
    let oldestDue: BillItem | null = null;
    let avgPaidDays: number | null = null;
    let paidDaysSum = 0,
      paidDaysCount = 0;
    for (const b of bills) {
      if (b.status === "paid") {
        paidCount++;
        if (b.paidInDays != null && b.paidInDays >= 0) {
          paidDaysSum += b.paidInDays;
          paidDaysCount++;
        }
      } else {
        if (b.status === "partial") partialCount++;
        else dueCount++;
        dueAmount += b.due;
        const age = b.ageDays ?? 0;
        if (age <= 30) bucketCurrent += b.due;
        else if (age <= 60) bucketMid += b.due;
        else bucketOld += b.due;
        if (!oldestDue || (b.date || "9999") < (oldestDue.date || "9999")) oldestDue = b;
      }
    }
    if (paidDaysCount > 0) avgPaidDays = Math.round(paidDaysSum / paidDaysCount);
    return {
      dueCount,
      partialCount,
      paidCount,
      dueAmount,
      total: bills.length,
      bucketCurrent,
      bucketMid,
      bucketOld,
      oldestDue,
      avgPaidDays,
    };
  }, [bills]);

  const totals = summary;

  // Flexible ledger print: চাইলে সম্পূর্ণ হিসাব, শুধু বাকি বিল, অথবা নির্দিষ্ট
  // তারিখ থেকে শেষ চলতি ব্যালেন্স পর্যন্ত — প্রয়োজন অনুযায়ী প্রিন্ট করা যায়।
  const buildPrintHtml = (mode: "all" | "due" | "range" | "bill", from: string, to: string): string | null => {
    const esc = (s: string) =>
      String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c));
    const num = (n: number) => Math.round(Number(n || 0)).toLocaleString();
    const payHead = isCustomer ? "জমা/গ্রহণ" : "পরিশোধ";
    const payDateHead = isCustomer ? "গ্রহণ তারিখ" : "পরিশোধ তারিখ";

    // চলতি (current) ব্যালেন্স সারাংশ — সবসময় ফুটারে দেখাবো।
    const curDue = totals.due > 0.5;
    const curAdv = !curDue && totals.advance > 0.5;
    const curLabel = curDue
      ? isCustomer
        ? "চলতি বকেয়া (এজেন্টের কাছে পাবো)"
        : "চলতি বকেয়া (ভেন্ডরকে দিবো)"
      : curAdv
        ? isCustomer
          ? "এজেন্ট অগ্রিম জমা"
          : "ভেন্ডরকে অগ্রিম দেওয়া"
        : "সব হিসাব পরিশোধিত";
    const curAmt = curDue ? totals.due : curAdv ? totals.advance : 0;

    // প্রতিটি বিলের কিস্তি (তারিখ · পরিমাণ · মাধ্যম) ছোট করে দেখানোর হেল্পার।
    const instLine = (b: (typeof bills)[number]) => {
      const items = (b.payments ?? []).filter((p) => Number(p.amt) > 0);
      if (!items.length) return "";
      const parts = items
        .map((p) => `${p.date ? esc(formatDate(p.date)) : "—"} · ৳${num(p.amt)}${p.method ? ` · ${esc(p.method)}` : ""}`)
        .join(" | ");
      return `<div class="inst">কিস্তি: ${parts}</div>`;
    };

    // প্রিন্ট হেডার: পরিচিতি বোর্ডের full name + আইডি, সাথে ঠিকানা ও ফোন।
    const fullNm = (contact?.full_name ?? "").trim() || displayName;
    // সর্ট নাম (স্ক্রিন/রুট নাম) — ফুল নামের নিচে সেকেন্ডারি লাইনে দেখানো হয়।
    const shortNm = (displayName ?? "").trim();
    const hasShort = shortNm && shortNm !== fullNm.trim();
    const printName = serialCode ? `${fullNm} · ${serialCode}` : fullNm;
    const addr = (contact?.address ?? "").trim();
    const phonesStr = phoneList.map((p) => p.phone).join(", ");
    const printContact = [
      addr ? `ঠিকানা: ${esc(addr)}` : "",
      phonesStr ? `ফোন: ${esc(phonesStr)}` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    let subtitle = "";
    let summaryLine = "";
    let theadHtml = "";
    let bodyHtml = "";

    if (mode === "bill") {
      // বিল-বাই-বিল আন্তর্জাতিক স্টেটমেন্ট: প্রতিটি বিল, এর পরিশোধ/গ্রহণ তারিখসহ।
      subtitle = "বিল-বাই-বিল হিসাব (প্রতিটি বিল আলাদা)";
      const totBill = bills.reduce((s, b) => s + b.bill, 0);
      const totPaid = bills.reduce((s, b) => s + b.paid, 0);
      const totDue = bills.reduce((s, b) => s + b.due, 0);
      summaryLine = `মোট বিল: ${bills.length} টি · মোট বিল মূল্য: ৳${num(totBill)} · মোট ${payHead}: ৳${num(totPaid)} · মোট বাকি: ৳${num(totDue)} · (পরিশোধিত ${billStats.paidCount} · আংশিক ${billStats.partialCount} · বাকি ${billStats.dueCount})`;
      theadHtml = `<tr>
        <th class="nw">তারিখ</th><th class="nw">ID</th><th>বিবরণ</th>
        <th class="r">বিল</th><th class="r">${payHead}</th><th>${payDateHead}</th><th class="r">বাকি</th><th>স্ট্যাটাস</th>
      </tr>`;
      // প্রিন্টেও বাকি/আংশিক বিল আগে; তার মধ্যে নতুন উপরে, পুরনো নিচে।
      const billsSorted = sortBillsDueFirstNewest(bills);
      bodyHtml = billsSorted.length
        ? billsSorted
            .map((b) => {
              const st = b.cancelled
                ? "বাতিল কাজ"
                : b.status === "paid"
                  ? "পরিশোধিত"
                  : b.status === "partial"
                    ? "আংশিক"
                    : "বাকি";
              const cls = b.cancelled ? ' class="cancel"' : "";
              // বিবরণ: passenger নাম প্রথমে ও বোল্ড, তারপর সার্ভিস · রুট।
              const paxHtml = b.passenger ? `<strong>${esc(b.passenger)}</strong>` : "";
              const restHtml = esc([b.service, b.route].filter(Boolean).join(" · "));
              const descHtml =
                [paxHtml, restHtml].filter(Boolean).join(" · ") ||
                esc([b.service, b.description].filter(Boolean).join(" · "));
              return `<tr${cls}>
                <td class="nw">${esc(formatDate(b.date))}</td>
                <td class="nw">${esc(b.ledgerId)}</td>
                <td>${descHtml}${b.cancelled ? " 🚫" : ""}</td>
                <td class="r">${num(b.bill)}</td>
                <td class="r">${b.paid ? num(b.paid) : "—"}</td>
                <td>${b.payDate ? esc(formatDate(b.payDate)) : "—"}</td>
                <td class="r ${b.due > 0 ? "due" : ""}">${num(b.due)}</td>
                <td>${st}</td>
              </tr>`;
            })
            .join("")
        : `<tr><td colspan="8" class="empty">কোনো বিল নেই</td></tr>`;
    } else if (mode === "due") {
      subtitle = "শুধু বাকি বিল সমূহ";
      // প্রিন্টে নতুন বাকি বিল উপরে, পুরনো নিচে।
      const dueBills = bills
        .filter((b) => b.status !== "paid")
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      summaryLine = `মোট বাকি বিল: ${dueBills.length} টি · মোট বাকি: ৳${num(billStats.dueAmount)}`;
      theadHtml = `<tr>
        <th class="nw">তারিখ</th><th class="nw">ID</th><th>বিবরণ</th>
        <th class="r">বিল</th><th class="r">${payHead}</th><th>${payDateHead}</th><th class="r">বাকি</th><th>স্ট্যাটাস</th>
      </tr>`;
      bodyHtml = dueBills.length
        ? dueBills
            .map((b) => {
              const st = b.cancelled ? "বাতিল কাজ" : b.status === "partial" ? "আংশিক" : "বাকি";
              const cls = b.cancelled ? ' class="cancel"' : "";
              return `<tr${cls}>
                <td class="nw">${esc(formatDate(b.date))}</td>
                <td class="nw">${esc(b.ledgerId)}</td>
                <td>${esc([b.service, b.description].filter(Boolean).join(" · "))}${b.cancelled ? " 🚫" : ""}${instLine(b)}</td>
                <td class="r">${num(b.bill)}</td>
                <td class="r">${b.paid ? num(b.paid) : "—"}</td>
                <td>${b.payDate ? esc(formatDate(b.payDate)) : "—"}</td>
                <td class="r due">${num(b.due)}</td>
                <td>${st}</td>
              </tr>`;
            })
            .join("")
        : `<tr><td colspan="8" class="empty">কোনো বাকি বিল নেই</td></tr>`;
    } else {
      // all / range — চলমান ব্যালেন্সসহ পূর্ণ লেজার। স্ক্রিনের মতই: নতুন উপরে, পুরনো নিচে।
      // ব্যালেন্স হিসাবের জন্য ভেতরে পুরনো → নতুন ধরে রাখি, শুধু দেখানোর সময় উল্টে দিই।
      const chrono = [...statement].reverse();
      let list = chrono;
      let opening = 0;
      if (mode === "range") {
        subtitle = `তারিখ অনুযায়ী হিসাব${from ? ` · ${formatDate(from)}` : ""}${to ? ` — ${formatDate(to)}` : " — চলতি পর্যন্ত"}`;
        const before = chrono.filter((s) => from && s.date && s.date < from);
        opening = before.length ? before[before.length - 1].balance : 0;
        list = chrono.filter((s) => {
          if (from && (!s.date || s.date < from)) return false;
          if (to && (!s.date || s.date > to)) return false;
          return true;
        });
      } else {
        subtitle = isCustomer ? "মোট বিলের হিসাব (পাসবই)" : "সম্পূর্ণ হিসাবের লেজার";
      }
      summaryLine = `মোট এন্ট্রি: ${list.length} টি · মোট বিল: ৳${num(totals.bill)} · মোট ${payHead}: ৳${num(totals.paid)}`;
      theadHtml = `<tr>
        <th class="nw">তারিখ</th><th class="nw">ID</th><th>সার্ভিস</th><th>বিবরণ</th>
        <th class="r">${payHead}</th><th class="r">বিল/Credit</th><th class="r">ব্যালেন্স</th>
      </tr>`;
      const colSpan = 7;
      // নতুন উপরে দেখাতে তালিকা উল্টে দিই; "আগের জের" সবচেয়ে নিচে থাকবে।
      const displayList = [...list].reverse();
      const rowsHtml = displayList.length
        ? displayList
            .map(
              (s) => `<tr class="${s.isPayment ? "pay" : ""}${s.cancelled ? " cancel" : ""}">
            <td class="nw">${esc(formatDate(s.date))}</td>
            <td class="nw">${esc(s.ledgerId)}</td>
            <td>${esc(s.service)}</td>
            <td>${esc(s.description)}${s.incomplete ? " ⏳" : ""}${s.cancelled ? " 🚫 বাতিল কাজ" : ""}</td>
            <td class="r">${s.deposit ? num(s.deposit) : "—"}</td>
            <td class="r">${s.credit ? num(s.credit) : "—"}</td>
            <td class="r">${num(s.balance)}</td>
          </tr>`,
            )
            .join("")
        : `<tr><td colspan="${colSpan}" class="empty">কোনো হিসাব নেই</td></tr>`;
      const openingRow =
        mode === "range"
          ? `<tr class="opening"><td colspan="5">আগের জের (Opening Balance)</td><td class="r">${num(opening)}</td></tr>`
          : "";
      bodyHtml = rowsHtml + openingRow;
    }

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(displayName)} — ${esc(subtitle)}</title>
      <style>
        body{font-family:system-ui,'Noto Sans Bengali',sans-serif;padding:24px;color:#0f172a;position:relative}
        body::before{content:"";position:fixed;inset:0;z-index:9999;pointer-events:none;background-image:url("${window.location.origin}${logoAsset.url}");background-repeat:no-repeat;background-position:center;background-size:60%;opacity:0.06;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        h1{font-size:18px;margin:0 0 2px}
        .short-name{color:#475569;font-size:13px;font-weight:600;margin:0 0 3px}
        .sub{color:#64748b;font-size:12px;margin-bottom:2px}
        .party-meta{color:#334155;font-size:11px;margin-bottom:4px}
        /* হেডার: বাম পাশে নাম/পরিচিতি, ডান পাশে প্রিন্ট তারিখ ও সারাংশ (জায়গা বাঁচাতে পাশাপাশি) */
        .head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:10px}
        .head-left{flex:1 1 auto;min-width:0}
        .head-right{flex:0 0 auto;text-align:right;max-width:48%}
        .head-right .meta{color:#64748b;font-size:11px;margin-bottom:4px}
        .head-right .sum{font-size:12px;font-weight:600;line-height:1.5}
        .meta{color:#64748b;font-size:11px;margin-bottom:10px}
        .sum{font-size:13px;margin-bottom:12px;font-weight:600}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}
        th{background:#f1f5f9}
        .r{text-align:right;font-variant-numeric:tabular-nums}
        .nw{white-space:nowrap}
        .due{color:#e11d48;font-weight:600}
        .pay td{background:#ecfdf5;color:#047857}
        .opening td{background:#fffbeb;font-weight:600}
        .empty{text-align:center;color:#94a3b8;padding:16px}
        .cancel td{color:#94a3b8;text-decoration:line-through;background:#f8fafc}
        .cancel td .inst{text-decoration:none}
        .inst{font-size:10px;color:#64748b;margin-top:2px}
        .foot{margin-top:14px;padding-top:10px;border-top:2px solid #0f172a;display:flex;justify-content:space-between;font-size:14px;font-weight:700}
        @media print{button{display:none}}
      </style></head><body>
      <div class="head">
        <div class="head-left">
          <h1>${esc(printName)}</h1>
          ${hasShort ? `<div class="short-name">${esc(shortNm)}</div>` : ""}
          <div class="sub">${isCustomer ? "Agency" : "Vendor"} Ledger · ${esc(subtitle)}</div>
          ${printContact ? `<div class="party-meta">${printContact}</div>` : ""}
        </div>
        <div class="head-right">
          <div class="meta">প্রিন্ট তারিখ: ${esc(formatDate(todayISO()))}</div>
          <div class="sum">${esc(summaryLine)}</div>
        </div>
      </div>
      <table><thead>${theadHtml}</thead><tbody>${bodyHtml}</tbody></table>
      <div class="foot"><span>${esc(curLabel)}</span><span>৳${num(curAmt)}</span></div>
      </body></html>`;
    return html;
  };

  const runPrint = (mode: "all" | "due" | "range" | "bill", from: string, to: string) => {
    const html = buildPrintHtml(mode, from, to);
    if (!html) return;
    const modeLabel =
      mode === "due" ? "Due" : mode === "bill" ? "Bill_by_Bill" : mode === "range" ? "Range" : "Full";
    const datePart = mode === "range" && (from || to) ? `${from || "শুরু"}_to_${to || todayISO()}` : todayISO();
    const docTitle = buildFileTitle(
      isCustomer ? "Agency_Ledger" : "Vendor_Ledger",
      displayName,
      modeLabel,
      datePart,
    );
    try {
      printDocHtml(html, docTitle);
    } catch {
      toast.error("প্রিন্ট উইন্ডো খোলা যায়নি (পপ-আপ ব্লক?)");
    }
  };

  // Print a small address label (full name, mobile, address) for envelope / courier.
  // The printer tray always holds A4 (@page size:A4); the label content is sized to
  // the selected paper size (A4/A5/A6/A7) and prints in that much of the A4 sheet.
  const runAddressLabel = (size: "a4" | "a5" | "a6" | "a7") => {
    const esc = (s: string) =>
      String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const fullName = (contact?.full_name ?? "").trim() || displayName;
    const phones = (contact?.phone ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const addr = (contact?.address ?? "").trim();

    // International portrait dimensions in mm (width × height).
    const DIMS: Record<typeof size, { w: number; h: number }> = {
      a4: { w: 210, h: 297 },
      a5: { w: 148, h: 210 },
      a6: { w: 105, h: 148 },
      a7: { w: 74, h: 105 },
    };
    const base = DIMS[size];
    // Landscape হলে প্রস্থ ও উচ্চতা অদলবদল (ডান-বাম) হবে।
    const dim =
      addrOrient === "landscape" ? { w: base.h, h: base.w } : { w: base.w, h: base.h };
    const padMm = Math.max(6, Math.round(dim.w * 0.05));

    const phoneHtml = phones.length
      ? `<div class="row"><span class="lbl">মোবাইল:</span> <span class="val">${phones.map(esc).join(", ")}</span></div>`
      : "";
    const addrHtml = addr
      ? `<div class="row addr"><span class="lbl">ঠিকানা:</span> <span class="val">${esc(addr)}</span></div>`
      : "";

    // প্রেরক (From) ব্লক — প্রাপকের পাশে সমান কলামে।
    const sName = senderName.trim();
    const sAddr = senderAddr.trim();
    const sPhone = senderPhone.trim();
    const senderHtml =
      addrShowSender && (sName || sAddr || sPhone)
        ? `<div class="from col">
             <div class="cap">প্রেরক / From</div>
             ${sName ? `<div class="from-name">${esc(sName)}</div>` : ""}
             ${sAddr ? `<div class="from-row">${esc(sAddr)}</div>` : ""}
             ${sPhone ? `<div class="from-row">${esc(sPhone)}</div>` : ""}
           </div>`
        : `<div class="col"></div>`;

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(fullName)} — ঠিকানা</title>
      <style>
        *{box-sizing:border-box}
        @page{size:A4;margin:0}
        html,body{margin:0;padding:0}
        body{font-family:system-ui,'Noto Sans Bengali',sans-serif;color:#0f172a;display:flex;justify-content:flex-end;align-items:flex-start}
        .label{width:${dim.w}mm;height:${dim.h}mm;padding:${padMm}mm;position:relative;overflow:hidden}
        .label::before{content:"";position:absolute;inset:0;z-index:0;pointer-events:none;background-image:url("${window.location.origin}${logoAsset.url}");background-repeat:no-repeat;background-position:center;background-size:50%;opacity:0.06;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        .env{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start;gap:8mm;height:100%}
        .col{min-width:0;overflow-wrap:anywhere;word-break:break-word;text-align:left}
        .col.to-col{align-self:start;text-align:left}
        .cap{font-size:9px;color:#94a3b8;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px}
        .from-name{font-size:12px;font-weight:700;line-height:1.25}
        .from-row{font-size:10px;color:#475569;line-height:1.35}
        .name{font-size:18px;font-weight:700;margin-bottom:8px;line-height:1.25}
        .row{font-size:13px;margin-bottom:4px;line-height:1.45}
        .row.addr{margin-top:2px}
        .lbl{color:#64748b}
        .val{font-weight:600}
        @media print{button{display:none}}
      </style></head><body>

      <div class="label">
        <div class="env">
          ${senderHtml}
          <div class="col to-col">
            <div class="cap">প্রাপক / To</div>
            <div class="name">${esc(fullName)}</div>
            ${addrHtml}
            ${phoneHtml}
          </div>
        </div>
      </div>
      </body></html>`;


    const docTitle = buildFileTitle(
      isCustomer ? "Agency_Address" : "Vendor_Address",
      fullName,
      todayISO(),
    );
    try {
      printDocHtml(html, docTitle);
    } catch {
      toast.error("প্রিন্ট উইন্ডো খোলা যায়নি (পপ-আপ ব্লক?)");
    }
  };










  // Distinct service-type values present in this statement (for the dropdown).
  const serviceTypes = useMemo(() => {
    const set = new Set<string>();
    for (const s of statement) {
      const v = String(s.service ?? "").trim();
      if (v && v !== "—") set.add(v);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [statement]);

  // Apply the per-ledger search + date-range + service-type filters.
  const filteredStatement = useMemo(() => {
    const q = stmtSearch.trim().toLowerCase();
    if (!q && !stmtFrom && !stmtTo && !stmtService) return statement;
    return statement.filter((s) => {
      if (stmtFrom && (!s.date || s.date < stmtFrom)) return false;
      if (stmtTo && (!s.date || s.date > stmtTo)) return false;
      if (stmtService && String(s.service ?? "") !== stmtService) return false;
      if (q) {
        const hay = `${s.ledgerId} ${s.service} ${s.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [statement, stmtSearch, stmtFrom, stmtTo, stmtService]);

  // Paginate the statement (latest entries already on top).
  const totalPages = Math.max(1, Math.ceil(filteredStatement.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedStatement = useMemo(
    () => filteredStatement.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredStatement, currentPage, pageSize],
  );
  useEffect(() => {
    setPage(1);
  }, [displayName, pageSize, stmtSearch, stmtFrom, stmtTo, stmtService]);

  const pageTitle = isCustomer ? "Agency Ledger" : "Vendor Ledger";

  return (
    <div className="space-y-4">
      {displayName && <PageWatermark text={displayName} />}
      <div className="flex items-center gap-2 flex-wrap">
        {name && (
          <Button asChild variant="ghost" size="sm" className="gap-1.5">
            <Link to={backTo}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Link>
          </Button>
        )}
        <h1 className="text-lg font-bold">{pageTitle}</h1>

        {/* Dropdown search filter: pick any party to view its ledger below. */}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              role="combobox"
              aria-expanded={pickerOpen}
              className="ml-1 h-8 w-[200px] justify-between gap-1.5 font-normal sm:w-[260px]"
            >
              <span className={`truncate ${name ? "font-medium" : "text-muted-foreground"}`}>
                {name || (isCustomer ? "Agency খুঁজুন…" : "Vendor খুঁজুন…")}
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[260px] p-0" align="start">
            <Command>
              <CommandInput placeholder={isCustomer ? "Agency নাম…" : "Vendor নাম…"} />
              <CommandList>
                <CommandEmpty>কিছু পাওয়া যায়নি</CommandEmpty>
                <CommandGroup>
                  {partyList.map((p) => (
                    <CommandItem
                      key={p}
                      value={p}
                      onSelect={() => {
                        setPickerOpen(false);
                        if (p === displayName) return;
                        navigate({
                          to: isCustomer ? "/agency-ledger/$name" : "/vendor-ledger/$name",
                          params: { name: p },
                        });
                      }}
                    >
                      <Check
                        className={
                          "mr-2 h-4 w-4 " + (p === displayName ? "opacity-100" : "opacity-0")
                        }
                      />
                      <span className="truncate">{p}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {name && (
        <div className="ml-auto flex items-center gap-2">
          {!isCustomer && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Wallet className="h-4 w-4" />
                  ম্যানুয়ালী আয় ব্যায়
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openManual("income")}>
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                  আয় এন্ট্রি
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openManual("expense")}>
                  <TrendingDown className="h-4 w-4 text-rose-600" />
                  ব্যায় এন্ট্রি
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {!(isCustomer && settleMode === "total") && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => { setPrintMode(settleMode === "one_by_one" ? "bill" : "all"); setPrintOpen(true); }}
          >
            <Printer className="h-4 w-4" />
            লেজার প্রিন্ট
          </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={() => setPayOpen(true)}
          >
            <Receipt className="h-4 w-4" />
            {isCustomer ? "পেমেন্ট গ্রহণ এন্ট্রি" : "পেমেন্ট পরিশোধ এন্ট্রি"}
          </Button>
        </div>
        )}

      </div>

      {/* প্রয়োজন অনুযায়ী লেজার প্রিন্ট — সম্পূর্ণ / শুধু বাকি / তারিখ অনুযায়ী */}
      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-4 w-4" /> লেজার প্রিন্ট
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <p className="text-xs text-muted-foreground">
              এই {isCustomer ? "agency" : "vendor"}-এর হিসাবের ধরন:{" "}
              <span className="font-semibold text-foreground">
                {settleMode === "one_by_one" ? "বিল-বাই-বিল" : "সম্পূর্ণ (চলমান ব্যালেন্স)"}
              </span>
              {" "}— সেই অনুযায়ী প্রিন্ট অপশন দেখানো হচ্ছে:
            </p>
            {((() => {
              const oneByOne = settleMode === "one_by_one";
              const allOpt = isCustomer
                ? { v: "all", t: "মোট বিলের লেজার", d: "পাসবইয়ের মত চলমান মোট হিসাব" }
                : { v: "all", t: "সম্পূর্ণ হিসাবের লেজার", d: "সব এন্ট্রি চলমান ব্যালেন্সসহ" };
              const billOpt = { v: "bill", t: "বিল-বাই-বিল হিসাব", d: "প্রতিটি বিল আলাদা — পরিশোধ/গ্রহণ তারিখসহ" };
              const dueOpt = { v: "due", t: "শুধু বাকি বিল সমূহ", d: "শুধু বকেয়া ও আংশিক বিল — তারিখসহ" };
              const rangeOpt = { v: "range", t: "তারিখ অনুযায়ী হিসাব", d: "নির্দিষ্ট তারিখ থেকে চলতি ব্যালেন্স পর্যন্ত" };
              // হিসাবের ধরন অনুযায়ীই প্রিন্ট অপশন: বিল-বাই-বিল হলে "মোট বিলের/সম্পূর্ণ"
              // অপশন আসবে না, আর মোটের উপর হলে "বিল-বাই-বিল" অপশন আসবে না।
              return oneByOne
                ? [billOpt, dueOpt, rangeOpt]
                : [allOpt, dueOpt, rangeOpt];
            })() as { v: "all" | "due" | "range" | "bill"; t: string; d: string }[]).map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setPrintMode(opt.v)}
                className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                  printMode === opt.v
                    ? "border-primary bg-primary/10"
                    : "border-input hover:bg-accent"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      printMode === opt.v ? "border-primary" : "border-muted-foreground/40"
                    }`}
                  >
                    {printMode === opt.v && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  <span className="text-sm font-medium">{opt.t}</span>
                </div>
                <div className="ml-6 text-[11px] text-muted-foreground">{opt.d}</div>
              </button>
            ))}
            {printMode === "range" && (
              <div className="flex gap-2 pt-1">
                <div className="flex-1">
                  <label className="block text-[11px] text-muted-foreground mb-0.5">শুরুর তারিখ</label>
                  <DateInput value={printFrom} onChange={(e) => setPrintFrom(e.target.value)} className="w-full" />
                </div>
                <div className="flex-1">
                  <label className="block text-[11px] text-muted-foreground mb-0.5">শেষ তারিখ (ফাঁকা = চলতি)</label>
                  <DateInput value={printTo} onChange={(e) => setPrintTo(e.target.value)} className="w-full" />
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" size="sm" onClick={() => setPrintOpen(false)}>
              বাতিল
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setPrintOpen(false);
                runPrint(printMode, printFrom, printTo);
              }}
            >
              <Printer className="h-4 w-4" /> প্রিন্ট করুন
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* খাম / কুরিয়ার ঠিকানা লেবেল প্রিন্ট */}
      <Dialog open={addrOpen} onOpenChange={setAddrOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-4 w-4" /> ঠিকানা প্রিন্ট (খাম/কুরিয়ার)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">পেইজ সাইজ</label>
              <Select value={addrSize} onValueChange={(v) => setAddrSize(v as typeof addrSize)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="a4">A4 (২১.০ × ২৯.৭ সেমি) — পুরো পাতা</SelectItem>
                  <SelectItem value="a5">A5 (১৪.৮ × ২১.০ সেমি) — অর্ধেক</SelectItem>
                  <SelectItem value="a6">A6 (১০.৫ × ১৪.৮ সেমি) — চার ভাগের এক</SelectItem>
                  <SelectItem value="a7">A7 (৭.৪ × ১০.৫ সেমি)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                ট্রে-তে A4 কাগজ থাকবে; লেখা {addrSize.toUpperCase()} সাইজের জায়গা জুড়ে প্রিন্ট হবে।
              </p>
            </div>

            {/* Orientation: উপর-নিচ (Portrait) নাকি ডান-বাম (Landscape) */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">লেখার দিক (Orientation)</label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={addrOrient === "portrait" ? "default" : "outline"}
                  onClick={() => setAddrOrient("portrait")}
                >
                  উপর-নিচ (Portrait)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={addrOrient === "landscape" ? "default" : "outline"}
                  onClick={() => setAddrOrient("landscape")}
                >
                  ডান-বাম (Landscape)
                </Button>
              </div>
            </div>

            {/* প্রেরক (From/Sender) — খামের মত প্রেরকের তথ্য */}
            <div className="space-y-1.5 rounded-md border border-border/60 p-2.5">
              <button
                type="button"
                onClick={() => setAddrShowSender((v) => !v)}
                className="flex w-full items-center justify-between text-xs font-medium"
              >
                <span>প্রেরক (From) দেখান</span>
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded border ${
                    addrShowSender ? "border-primary bg-primary text-primary-foreground" : "border-border"
                  }`}
                >
                  {addrShowSender ? "✓" : ""}
                </span>
              </button>
              {addrShowSender && (
                <div className="space-y-1.5 pt-1">
                  <Input
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                    placeholder="প্রেরকের নাম / প্রতিষ্ঠান"
                    className="h-8 text-xs"
                  />
                  <Input
                    value={senderAddr}
                    onChange={(e) => setSenderAddr(e.target.value)}
                    placeholder="প্রেরকের ঠিকানা (ঐচ্ছিক)"
                    className="h-8 text-xs"
                  />
                  <Input
                    value={senderPhone}
                    onChange={(e) => setSenderPhone(e.target.value)}
                    placeholder="প্রেরকের মোবাইল (ঐচ্ছিক)"
                    className="h-8 text-xs"
                  />
                </div>
              )}
            </div>

            {/* Live envelope preview — shows exactly how it prints */}
            {(() => {
              const DIMS = {
                a4: { w: 210, h: 297 },
                a5: { w: 148, h: 210 },
                a6: { w: 105, h: 148 },
                a7: { w: 74, h: 105 },
              } as const;
              const base = DIMS[addrSize];
              const dim =
                addrOrient === "landscape" ? { w: base.h, h: base.w } : { w: base.w, h: base.h };
              // Small popup preview; print keeps the selected real paper size.
              const MAX = 230;
              const scale = MAX / Math.max(dim.w, dim.h);
              const wPx = dim.w * scale;
              const hPx = dim.h * scale;
              const showSender = addrShowSender && (senderName.trim() || senderAddr.trim() || senderPhone.trim());
              return (
                <div className="flex flex-col items-center gap-2 rounded-lg bg-muted/40 p-4">
                  {/* The envelope */}
                  <div
                    className="relative overflow-hidden rounded-md border border-border bg-background p-3 shadow-md"
                    style={{ width: `${wPx}px`, height: `${hPx}px` }}
                  >
                    <div className="grid h-full grid-cols-2 items-start gap-3">
                      {/* Sender — left equal column */}
                      <div className="min-w-0 break-words text-left">
                        {showSender && (
                          <>
                            <div className="text-[8px] uppercase tracking-wider text-muted-foreground">প্রেরক / From</div>
                            {senderName.trim() && (
                              <div className="text-[11px] font-bold leading-tight">{senderName}</div>
                            )}
                            {senderAddr.trim() && (
                              <div className="text-[9px] leading-tight text-muted-foreground">{senderAddr}</div>
                            )}
                            {senderPhone.trim() && (
                              <div className="text-[9px] leading-tight text-muted-foreground">{senderPhone}</div>
                            )}
                          </>
                        )}
                      </div>
                      {/* Recipient — right equal column */}
                      <div className="min-w-0 break-words text-left">
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">প্রাপক / To</div>
                        <div className="mt-0.5 text-[14px] font-bold leading-tight">
                          {(contact?.full_name ?? "").trim() || displayName}
                        </div>
                        {(contact?.address ?? "").trim() && (
                          <div className="mt-1 text-[11px] leading-snug">
                            <span className="text-muted-foreground">ঠিকানা: </span>
                            {contact?.address}
                          </div>
                        )}
                        {(contact?.phone ?? "").trim() && (
                          <div className="mt-0.5 text-[11px] font-semibold">
                            <span className="font-normal text-muted-foreground">মোবাইল: </span>
                            {contact?.phone}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {addrSize.toUpperCase()} খাম · {addrOrient === "landscape" ? "ডান-বাম" : "উপর-নিচ"} · A4 কাগজের উপরে-ডান কোণে প্রিন্ট হবে
                  </div>
                </div>
              );
            })()}


          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" size="sm" onClick={() => setAddrOpen(false)}>
              বাতিল
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setAddrOpen(false);
                runAddressLabel(addrSize);
              }}
            >
              <Printer className="h-4 w-4" /> প্রিন্ট করুন
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>




      {payOpen && (
        <LedgerPage
          module={moduleByKey(isCustomer ? "agency-ledger" : "vendor-ledger")!}
          renderMode="payment-only"
          autoPay={autoPayTarget || displayName || name || "__open__"}
          onPaymentClose={() => setPayOpen(false)}
        />
      )}

      <Dialog open={manualKind !== null} onOpenChange={(o) => !o && setManualKind(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {manualKind === "income" ? (
                <>
                  <TrendingUp className="h-5 w-5 text-emerald-600" /> আয় এন্ট্রি
                </>
              ) : (
                <>
                  <TrendingDown className="h-5 w-5 text-rose-600" /> ব্যায় এন্ট্রি
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {manualKind === "income"
                ? "Vendor থেকে রিফান্ড/বোনাস বাবদ ফেরত পাওয়া টাকা — vendor এর ব্যালেন্সে যুক্ত হবে।"
                : "Vendor অতিরিক্ত সার্ভিস বাবদ আমাদের কাছে যে টাকা পাবে (void/date change চার্জ ইত্যাদি)।"}
            </p>
            <div>
              <label className="text-[11px] text-muted-foreground">Vendor</label>
              {name ? (
                <Input value={manualForm.vendor} disabled className="h-9 mt-0.5" />
              ) : (
                <Select
                  value={manualForm.vendor}
                  onValueChange={(v) => setManualForm((f) => ({ ...f, vendor: v }))}
                >
                  <SelectTrigger className="h-9 mt-0.5">
                    <SelectValue placeholder="Vendor নির্বাচন করুন" />
                  </SelectTrigger>
                  <SelectContent>
                    {partyList.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-muted-foreground">পরিমাণ (৳)</label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={manualForm.amount}
                  onChange={(e) => setManualForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="0"
                  className="h-9 mt-0.5"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">তারিখ</label>
                <DateInput
                  value={manualForm.date}
                  onChange={(e) => setManualForm((f) => ({ ...f, date: e.target.value }))}
                  className="mt-0.5"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">বিবরণ (ঐচ্ছিক)</label>
              <Textarea
                value={manualForm.note}
                onChange={(e) => setManualForm((f) => ({ ...f, note: e.target.value }))}
                placeholder={manualKind === "income" ? "যেমন: টিকেট রিফান্ড" : "যেমন: টিকেট void চার্জ"}
                className="mt-0.5 min-h-[60px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setManualKind(null)} disabled={manualSaving}>
              বাতিল
            </Button>
            <Button onClick={saveManual} disabled={manualSaving}>
              {manualSaving ? "সংরক্ষণ হচ্ছে…" : "সংরক্ষণ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>




      {!name ? (
        <>
        <Card>
          <CardContent className="p-3 sm:p-4 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Input
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value)}
                placeholder={isCustomer ? "Agency খুঁজুন…" : "Vendor খুঁজুন…"}
                className="h-9 max-w-sm"
              />
              <NewPartyDialog
                kind={isCustomer ? "agent" : "vendor"}
                onCreated={() => setPartyRefresh((v) => v + 1)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>মোট {balances.length} টি {isCustomer ? "Agency" : "Vendor"}</span>
              {listFilter.trim() && (
                <Badge className="text-[11px] font-medium">
                  ফলাফল {balances.filter((b) => b.name.toLowerCase().includes(listFilter.trim().toLowerCase())).length} টি
                </Badge>
              )}
            </div>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{isCustomer ? "Agent" : "Vendor"}</TableHead>
                    <TableHead className="text-right">{isCustomer ? "Total Bill" : "Total Payable"}</TableHead>
                    <TableHead className="text-right">{isCustomer ? "Received" : "Paid"}</TableHead>
                    <TableHead className="text-right">Balance Due</TableHead>
                    <TableHead className="text-right">Advance Balance</TableHead>
                    <TableHead className="text-center whitespace-nowrap">হিসাব ধরন</TableHead>
                    {canApprove && <TableHead className="text-center w-10"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    const filtered = balances
                      .filter((b) =>
                        b.name.toLowerCase().includes(listFilter.trim().toLowerCase()),
                      )
                      .slice()
                      .sort((a, b) => {
                        const rank = (x: { due: number; advance: number }) =>
                          Number(x.advance ?? 0) > 0 ? 0 : Number(x.due ?? 0) > 0 ? 1 : 2;
                        const r = rank(a) - rank(b);
                        if (r !== 0) return r;
                        const av = Number(a.advance ?? 0) > 0 ? Number(a.advance) : Number(a.due);
                        const bv = Number(b.advance ?? 0) > 0 ? Number(b.advance) : Number(b.due);
                        return bv - av;
                      });
                    if (filtered.length === 0) {
                      return (
                        <TableRow>
                          <TableCell colSpan={canApprove ? 8 : 7} className="text-center text-muted-foreground py-6">
                            কোনো হিসাব নেই
                          </TableCell>
                        </TableRow>
                      );
                    }
                    return filtered.map((b, idx) => (
                      <TableRow
                        key={b.name}
                        className={`row-tint-${idx % 4} cursor-pointer`}
                        onClick={() =>
                          navigate({
                            to: isCustomer ? "/agency-ledger/$name" : "/vendor-ledger/$name",
                            params: { name: b.name },
                          })
                        }
                      >
                        <TableCell className="font-mono text-xs tabular-nums font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                          {partySerialCode(isCustomer ? "agent" : "vendor", b.serial ?? (idx + 1))}
                        </TableCell>
                        <TableCell className="font-medium">{b.name}</TableCell>
                        <TableCell className="text-right tabular-nums">৳ {b.bill.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-600">৳ {b.paid.toLocaleString()}</TableCell>
                        <TableCell className={`text-right tabular-nums font-semibold ${b.due > 0 ? "text-rose-600" : "text-muted-foreground"}`}>৳ {b.due.toLocaleString()}</TableCell>
                        <TableCell className={`text-right tabular-nums font-semibold ${b.advance > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>৳ {b.advance.toLocaleString()}</TableCell>
                        <TableCell className="text-center">
                          <SettleModeBadge mode={b.settle_mode || null} />
                        </TableCell>
                        {canApprove && (
                          <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                            <ConfirmDeleteButton
                              onConfirm={() => handleDeleteParty(b.name)}
                              title={`"${b.name}" ডিলিট করবেন?`}
                              description="এই এজেন্সি/ভেন্ডরটি তালিকা থেকে স্থায়ীভাবে মুছে যাবে। নিশ্চিত করতে আপনার লগইন পাসওয়ার্ড দিন।"
                              allowOwner
                            />
                          </TableCell>
                        )}
                      </TableRow>
                    ));
                  })()}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        <LedgerPage module={moduleByKey(isCustomer ? "agency-ledger" : "vendor-ledger")!} hideCreate />
        </>
      ) : (
        <>

      {/* Profile + summary */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,260px)_auto] md:items-start">
            {/* পরিচিতি বোর্ড (Profile Board) — নাম, ফোন, ঠিকানা ও হিসাবের ধরন সেটিং */}
            <div className="relative rounded-lg border border-primary/30 bg-muted/20 p-3 pt-4">
              <span className="absolute -top-2.5 left-3 bg-card px-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                পরিচিতি বোর্ড
              </span>
              {editing ? (
                <div className="space-y-2 max-w-md">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Name</label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="নাম"
                      className="h-8 mt-0.5"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">পুরো নাম (Full Name)</label>
                    <Input
                      value={form.fullName}
                      onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                      placeholder="পুরো নাম (ঐচ্ছিক)"
                      className="h-8 mt-0.5"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Mobile (প্রতিটি নাম্বারের নাম সহ)</label>
                    <div className="space-y-2 mt-0.5">
                      {form.phones.map((p, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <Input
                            value={form.phoneLabels[i] ?? ""}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                phoneLabels: f.phoneLabels.map((x, xi) => (xi === i ? e.target.value : x)),
                              }))
                            }
                            placeholder="নাম (যেমন: অফিস)"
                            className="h-8 w-28 shrink-0"
                          />
                          <Input
                            value={p}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                phones: f.phones.map((x, xi) => (xi === i ? e.target.value : x)),
                              }))
                            }
                            placeholder={`মোবাইল ${i + 1}`}
                            inputMode="tel"
                            className="h-8"
                          />
                          {form.phones.length > 1 && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={() =>
                                setForm((f) => ({
                                  ...f,
                                  phones: f.phones.filter((_, xi) => xi !== i),
                                  phoneLabels: f.phoneLabels.filter((_, xi) => xi !== i),
                                }))
                              }
                              aria-label="Remove"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => setForm((f) => ({ ...f, phones: [...f.phones, ""], phoneLabels: [...f.phoneLabels, ""] }))}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" /> আরেকটি নাম্বার
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Address</label>
                    <Textarea
                      value={form.address}
                      onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                      placeholder="ঠিকানা"
                      rows={2}
                      className="mt-0.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">
                      হিসাবের ধরন {isCustomer ? "(পেমেন্ট গ্রহণ)" : "(পেমেন্ট পরিশোধ)"}
                    </label>
                    <div className="mt-0.5 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, settleMode: "total" }))}
                        className={`rounded-lg border p-2 text-left transition-colors ${
                          form.settleMode === "total"
                            ? "border-primary bg-primary/10 ring-1 ring-primary"
                            : "bg-background hover:bg-muted/50"
                        }`}
                      >
                        <div className="text-sm font-semibold">মোটের উপর</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">সব বিল একসাথে · Auto FIFO</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, settleMode: "one_by_one" }))}
                        className={`rounded-lg border p-2 text-left transition-colors ${
                          form.settleMode === "one_by_one"
                            ? "border-primary bg-primary/10 ring-1 ring-primary"
                            : "bg-background hover:bg-muted/50"
                        }`}
                      >
                        <div className="text-sm font-semibold">এক একটা বিল</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">নির্দিষ্ট বিল ধরে · Bill-by-Bill</div>
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" className="h-8" onClick={saveEdit} disabled={saving}>
                      <Check className="h-3.5 w-3.5 mr-1" /> {saving ? "Saving…" : "Save"}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8" onClick={() => setEditing(false)} disabled={saving}>
                      <X className="h-3.5 w-3.5 mr-1" /> Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    {serialCode && (
                      <Badge variant="secondary" className="font-mono text-[11px] tabular-nums">
                        {serialCode}
                      </Badge>
                    )}
                    <span className="text-lg font-semibold leading-tight">{displayName}</span>
                    <Badge
                      variant="outline"
                      className={isCustomer ? "border-sky-500/50 text-sky-600" : "border-violet-500/50 text-violet-600"}
                    >
                      {isCustomer ? "Customer" : "Vendor"}
                    </Badge>
                    <SettleModeBadge mode={settleMode} />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
                      onClick={beginEdit}
                      aria-label="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0 text-muted-foreground hover:text-primary"
                      onClick={() => setAddrOpen(true)}
                      aria-label="ঠিকানা প্রিন্ট"
                      title="খাম/কুরিয়ার ঠিকানা প্রিন্ট"
                    >
                      <Printer className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {contact?.full_name && (
                    <div className="mt-1 text-sm text-muted-foreground">{contact.full_name}</div>
                  )}
                  <div className="mt-2 grid grid-cols-1 gap-1.5 text-sm">
                    {phoneList.length ? (
                      phoneList.map((ph, i) => (
                        <div key={i} className="flex items-center gap-2 flex-wrap">
                          <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                          {ph.label && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              {ph.label}
                            </Badge>
                          )}
                          <span>{ph.phone}</span>
                          <a
                            href={`tel:${ph.phone.replace(/[^+\d]/g, "")}`}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30 transition-colors hover:bg-emerald-500/25"
                            aria-label={`Call ${ph.phone}`}
                          >
                            <PhoneCall className="h-3.5 w-3.5" />
                          </a>
                          <a
                            href={`https://wa.me/${waNumber(ph.phone)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-500/15 text-green-400 ring-1 ring-inset ring-green-500/30 transition-colors hover:bg-green-500/25"
                            aria-label={`WhatsApp ${ph.phone}`}
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-muted-foreground italic">মোবাইল নেই</span>
                      </div>
                    )}
                    <div className="flex items-start gap-2">
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                      <span className="text-muted-foreground">{contact?.address || "ঠিকানা নেই"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
                      {lastPayment ? (
                        <span>
                          শেষ {isCustomer ? "গ্রহণ" : "পরিশোধ"}:{" "}
                          <span className="font-semibold text-emerald-600 tabular-nums">{fmtMoney(lastPayment.amount)}</span>{" "}
                          <span className="text-muted-foreground">· {formatDate(lastPayment.date)}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic">
                          এখনো কোনো {isCustomer ? "গ্রহণ" : "পরিশোধ"} নেই
                        </span>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* নোট বক্স (Note Box) — vendor/agency সম্পর্কে নোট */}
            <div className="relative rounded-lg border border-amber-400/40 bg-amber-50/40 dark:bg-amber-500/5 p-3 pt-4">
              <span className="absolute -top-2.5 left-3 bg-card px-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                নোট
              </span>
              {noteEditing ? (
                <div className="space-y-2">
                  <Textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="এই পার্টি সম্পর্কে নোট লিখুন…"
                    rows={5}
                    className="text-sm"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button size="sm" className="h-8" onClick={saveNote} disabled={noteSaving}>
                      <Check className="h-3.5 w-3.5 mr-1" /> {noteSaving ? "Saving…" : "Save"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => {
                        setNoteDraft(contact?.notes ?? "");
                        setNoteEditing(false);
                      }}
                      disabled={noteSaving}
                    >
                      <X className="h-3.5 w-3.5 mr-1" /> Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setNoteDraft(contact?.notes ?? "");
                    setNoteEditing(true);
                  }}
                  className="group block w-full text-left"
                  title="নোট সম্পাদনা করুন"
                >
                  {contact?.notes ? (
                    <p className="whitespace-pre-wrap text-sm text-foreground/90">{contact.notes}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      নোট নেই — লিখতে ক্লিক করুন
                    </p>
                  )}
                  <span className="mt-2 inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 opacity-0 transition-opacity group-hover:opacity-100">
                    <Pencil className="h-3 w-3" /> সম্পাদনা
                  </span>
                </button>
              )}
            </div>



            {/* Thin summary board */}
            <div className="grid grid-cols-2 gap-2 md:min-w-[220px]">
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {isCustomer ? "Total Bill" : "Total Payable"}
                </div>
                <div className="text-sm font-semibold tabular-nums">{fmtMoney(totals.bill)}</div>
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {isCustomer ? "Received" : "Paid"}
                </div>
                <div className="text-sm font-semibold tabular-nums text-emerald-600">{fmtMoney(totals.paid)}</div>
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Due</div>
                <div className={`text-sm font-semibold tabular-nums ${totals.due > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {fmtMoney(totals.due)}
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Advance</div>
                <div className="text-sm font-semibold tabular-nums text-emerald-600">{fmtMoney(totals.advance)}</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* হিসাব ধরন banner — explains how this party's accounting is read. */}
      <div
        className={`rounded-md border px-3 py-2 text-xs ${
          settleMode === "one_by_one"
            ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
            : "border-sky-500/40 bg-sky-500/5 text-sky-700 dark:text-sky-400"
        }`}
      >
        {settleMode === "one_by_one" ? (
          <span>
            <b>এক একটা বিল (Bill-by-Bill)</b> — প্রতিটা বিল আলাদাভাবে পরিশোধ হয়। নিচের{" "}
            <b>বিল-ভিত্তিক স্ট্যাটাস</b> দেখুন: কোন বিল বাকি, কোনটা পরিশোধিত।
          </span>
        ) : (
          <span>
            <b>মোটের উপর (Auto FIFO)</b> — সব বিল একসাথে ধরা হয়। নিচের স্টেটমেন্টের{" "}
            <b>Balance</b> কলামই চলমান মোট ব্যালেন্স (পাসবইয়ের মত)।
          </span>
        )}
      </div>

      {/* M-2: contact-card নেই → পার্টি নিরবে "মোটের উপর (Auto FIFO)"-তে চলছে।
          ব্যবহারকারীকে জানানো হয় যেন ইচ্ছাকৃতভাবে ধরন বেছে নিতে পারে। */}
      {!loading && !contact && rows.length > 0 && (
        <div className="rounded-md border border-orange-500/50 bg-orange-500/5 px-3 py-2 text-xs text-orange-700 dark:text-orange-400">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <b>⚠️ হিসাব ধরন সেট করা নেই</b> — এই {isCustomer ? "এজেন্টের" : "ভেন্ডরের"} কোনো
              কার্ড/সেটিং নেই, তাই হিসাব নিরবে <b>মোটের উপর (Auto FIFO)</b>-তে ধরা হচ্ছে। সঠিক হিসাবের
              জন্য ধরন বেছে নিন।
            </span>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={beginEdit}>
              ধরন সেট করুন
            </Button>
          </div>
        </div>
      )}

      {/* এক ঝলক সারাংশ কার্ড — মোডভেদে সবচেয়ে জরুরি সংখ্যাটা বড় করে দেখায়। */}
      {(() => {
        const hasDue = totals.due > 0.5;
        const hasAdv = !hasDue && totals.advance > 0.5;
        const tone = hasDue
          ? "border-rose-500/40 bg-rose-500/5"
          : hasAdv
            ? "border-sky-500/40 bg-sky-500/5"
            : "border-emerald-500/40 bg-emerald-500/5";
        const headline = hasDue
          ? isCustomer
            ? "এই এজেন্টের কাছে মোট বকেয়া"
            : "এই ভেন্ডরকে আমরা দিবো"
          : hasAdv
            ? isCustomer
              ? "এজেন্ট অগ্রিম জমা দিয়েছে"
              : "ভেন্ডরকে অগ্রিম দেওয়া আছে"
            : "সব হিসাব পরিশোধিত ✅";
        const amount = hasDue ? totals.due : hasAdv ? totals.advance : 0;
        const amtColor = hasDue ? "text-rose-600" : hasAdv ? "text-sky-600" : "text-emerald-600";
        const remainingBills = billStats.dueCount + billStats.partialCount;
        return (
          <div className={`rounded-lg border px-4 py-3 ${tone}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {settleMode === "one_by_one" ? (
                <div className="text-left text-xs">
                  <div className="text-muted-foreground">বিল-ভিত্তিক হিসাব</div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="font-semibold text-rose-600">{remainingBills} টি বাকি</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="font-semibold text-emerald-600">{billStats.paidCount} টি পরিশোধিত</span>
                  </div>
                </div>
              ) : (
                <div className="text-left text-xs">
                  <div className="text-muted-foreground">মোটের উপর হিসাব</div>
                  <div className="mt-0.5">
                    <span className="text-muted-foreground">মোট বিল </span>
                    <span className="font-semibold tabular-nums">{fmtMoney(totals.bill)}</span>
                    <span className="text-muted-foreground"> · পরিশোধ </span>
                    <span className="font-semibold tabular-nums text-emerald-600">{fmtMoney(totals.paid)}</span>
                  </div>
                </div>
              )}
              <div className="text-right">
                <div className="text-xs text-muted-foreground">{headline}</div>
                <div className={`text-2xl font-bold tabular-nums ${amtColor}`}>
                  {amount > 0 ? fmtMoney(amount) : "৳0"}
                </div>
              </div>
            </div>
          </div>
        );
      })()}


      {/* Bill-by-Bill checklist — only for one_by_one parties. */}
      {settleMode === "one_by_one" && (
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">বিল-ভিত্তিক স্ট্যাটাস</h3>
              <Badge variant="outline" className="border-rose-500/50 text-rose-600">
                বাকি {billStats.dueCount + billStats.partialCount}
              </Badge>
              <Badge variant="outline" className="border-emerald-500/50 text-emerald-600">
                পরিশোধিত {billStats.paidCount}
              </Badge>
              {billStats.dueAmount > 0 && (
                <span className="text-xs text-muted-foreground">
                  মোট বাকি:{" "}
                  <span className="font-semibold text-rose-600 tabular-nums">
                    {fmtMoney(billStats.dueAmount)}
                  </span>
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-7 gap-1 text-xs"
                onClick={() => { setPrintMode("bill"); setPrintOpen(true); }}
              >
                <Printer className="h-3.5 w-3.5" /> প্রিন্ট
              </Button>
            </div>



            <div className="overflow-x-auto rounded-md border">
              <Table className="w-full min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[32px]"></TableHead>
                    <TableHead className="w-[100px] whitespace-nowrap">বিল তারিখ</TableHead>
                    <TableHead className="w-[140px] whitespace-nowrap">ID</TableHead>
                    <TableHead className="min-w-[140px]">বিবরণ</TableHead>
                    <TableHead className="w-[90px] text-right">বিল</TableHead>
                    <TableHead className="w-[90px] text-right text-emerald-600">
                      {isCustomer ? "গ্রহণ" : "পরিশোধ"}
                    </TableHead>
                    <TableHead className="w-[100px] whitespace-nowrap">
                      {isCustomer ? "গ্রহণ তারিখ" : "পরিশোধ তারিখ"}
                    </TableHead>
                    <TableHead className="w-[120px] text-right">স্ট্যাটাস</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bills.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                        কোনো বিল নেই
                      </TableCell>
                    </TableRow>
                  ) : (
                    bills.map((b, idx) => {
                      const hasHist = b.payments.length > 0;
                      const open = expandedBill === b.id;
                      
                      return (
                        <Fragment key={b.id}>
                          <TableRow
                            className={`row-tint-${idx % 4} ${hasHist ? "cursor-pointer" : ""} ${b.cancelled ? "opacity-60" : ""}`}
                            onClick={() => hasHist && setExpandedBill(open ? null : b.id)}
                          >
                            <TableCell className="px-1 text-center text-muted-foreground">
                              {hasHist ? (
                                open ? (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                )
                              ) : null}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">{formatDate(b.date)}</TableCell>
                            <TableCell className="truncate font-mono text-xs" title={b.ledgerId}>
                              {b.ledgerId}
                            </TableCell>
                            <TableCell className="truncate" title={`${b.service} · ${b.description}`}>
                              <span className="text-muted-foreground">{b.service}</span>
                              {b.description ? ` · ${b.description}` : ""}
                              {b.cancelled ? " · 🚫 বাতিল কাজ" : ""}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{b.bill.toLocaleString()}</TableCell>
                            <TableCell className="text-right tabular-nums text-emerald-600">
                              {b.paid ? b.paid.toLocaleString() : "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {b.payDate ? (
                                formatDate(b.payDate)
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {b.status === "paid" ? (
                                <div className="leading-tight">
                                  <Badge variant="outline" className="border-emerald-500/50 text-emerald-600 text-[10px]">
                                    পরিশোধিত
                                  </Badge>
                                </div>
                              ) : b.status === "partial" ? (
                                <div className="leading-tight">
                                  <Badge variant="outline" className="border-amber-500/50 text-amber-600 text-[10px]">
                                    আংশিক
                                  </Badge>
                                  <div className="text-[10px] text-rose-600 font-semibold tabular-nums mt-0.5">
                                    বাকি {b.due.toLocaleString()}
                                  </div>
                                </div>
                              ) : (
                                <div className="leading-tight">
                                  <Badge variant="outline" className="border-rose-500/50 text-rose-600 text-[10px]">
                                    বাকি
                                  </Badge>
                                  <div className="text-[10px] text-rose-600 font-semibold tabular-nums mt-0.5">
                                    {b.due.toLocaleString()}
                                  </div>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                          {open && hasHist && (
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                              <TableCell colSpan={8} className="py-2">
                                <div className="pl-6">
                                  <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                                    <Clock className="h-3 w-3" /> পেমেন্ট ইতিহাস
                                  </div>
                                  <div className="space-y-1">
                                    {b.payments.map((p, i) => (
                                      <div
                                        key={i}
                                        className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs"
                                      >
                                        <span className="w-[92px] whitespace-nowrap text-muted-foreground">
                                          {p.date ? formatDate(p.date) : "তারিখ নেই"}
                                        </span>
                                        <span className="font-semibold tabular-nums text-emerald-600">
                                          ৳{p.amt.toLocaleString()}
                                        </span>
                                        {p.method && (
                                          <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                            {methodLabel(p.method)}
                                          </span>
                                        )}
                                        {isCustomer && p.deletable && (p.rowId || p.ledgerRowId) && (
                                          <ConfirmDeleteButton
                                            allowOwner
                                            title="পেমেন্ট গ্রহণ ডিলিট?"
                                            description="এই পেমেন্ট গ্রহণ মুছে ফেলা হবে এবং এই বিলের বকেয়া আবার ফিরে আসবে। নিশ্চিত করতে আপনার লগইন পাসওয়ার্ড দিন।"
                                            onConfirm={() =>
                                              deleteAgentPayments([{ rowId: p.rowId, ledgerRowId: p.ledgerRowId, amount: p.amt }])
                                            }
                                          />
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Total-bill running ledger — Agency one-by-one parties use only the bill-by-bill table above. */}
      {isCustomer && settleMode === "total" && (() => {
        const payHist = statement.filter((s) => s.isPayment && s.paymentTargets && s.paymentTargets.length > 0);
        if (!payHist.length) return null;
        return (
          <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">পেমেন্ট গ্রহণ ইতিহাস</h3>
                <Badge variant="secondary" className="text-[11px] font-medium">মোট {payHist.length} টি</Badge>
                <span className="text-xs text-muted-foreground">এখান থেকে যেকোনো পেমেন্ট গ্রহণ ডিলিট করা যাবে</span>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <Table className="w-full min-w-[520px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[120px] whitespace-nowrap">তারিখ</TableHead>
                      <TableHead className="w-[150px] whitespace-nowrap">রসিদ</TableHead>
                      <TableHead>বিবরণ</TableHead>
                      <TableHead className="w-[130px] text-right">পরিমাণ</TableHead>
                      <TableHead className="w-[48px] text-center"> </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payHist.map((s, idx) => (
                      <TableRow key={s.id} className={`row-tint-${idx % 4}`}>
                        <TableCell className="whitespace-nowrap text-xs font-medium text-emerald-600">{formatDate(s.date)}</TableCell>
                        <TableCell className="font-mono text-xs">{s.ledgerId}</TableCell>
                        <TableCell className="truncate" title={s.description}>{s.description || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold text-emerald-600">{s.deposit ? s.deposit.toLocaleString() : "—"}</TableCell>
                        <TableCell className="text-center px-1">
                          <ConfirmDeleteButton
                            allowOwner
                            title="পেমেন্ট গ্রহণ ডিলিট?"
                            description="এই পেমেন্ট গ্রহণ মুছে ফেলা হবে এবং সংশ্লিষ্ট বিলের বকেয়া আবার ফিরে আসবে। নিশ্চিত করতে আপনার লগইন পাসওয়ার্ড দিন।"
                            onConfirm={() => deleteAgentPayments(s.paymentTargets!)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {(!isCustomer || settleMode === "total") && (
      <Card>
        <CardContent className="p-3 sm:p-4">
          {/* Heading + inline search/date-range filter for this ledger statement. */}
          <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-center gap-2 lg:mb-1">
              <h3 className="text-sm font-semibold">{isCustomer ? "মোট বিলের লেজার" : pageTitle}</h3>
              <Badge variant="secondary" className="text-[11px] font-medium">
                মোট {statement.length} টি
              </Badge>
              {(stmtSearch || stmtFrom || stmtTo || stmtService) && (
                <Badge className="text-[11px] font-medium">
                  ফলাফল {filteredStatement.length} টি
                </Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                onClick={() => { setPrintMode("all"); setPrintOpen(true); }}
              >
                <Printer className="h-3.5 w-3.5" /> প্রিন্ট
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col w-full sm:w-[200px] sm:flex-1 sm:min-w-[160px]">
                <label className="block text-[11px] text-muted-foreground mb-0.5">খুঁজুন</label>
                <Input
                  value={stmtSearch}
                  onChange={(e) => setStmtSearch(e.target.value)}
                  placeholder="ID / Service / বিবরণ…"
                  className="h-9"
                />
              </div>
              {serviceTypes.length > 0 && (
                <div className="flex flex-col w-[150px]">
                  <label className="block text-[11px] text-muted-foreground mb-0.5">সার্ভিস টাইপ</label>
                  <Select value={stmtService || "all"} onValueChange={(v) => setStmtService(v === "all" ? "" : v)}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="সব সার্ভিস" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">সব সার্ভিস</SelectItem>
                      {serviceTypes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex flex-col w-[150px]">
                <label className="block text-[11px] text-muted-foreground mb-0.5">শুরুর তারিখ</label>
                <DateInput
                  value={stmtFrom}
                  onChange={(e) => setStmtFrom(e.target.value)}
                  className="w-full"
                />
              </div>
              <div className="flex flex-col w-[150px]">
                <label className="block text-[11px] text-muted-foreground mb-0.5">শেষ তারিখ</label>
                <DateInput
                  value={stmtTo}
                  onChange={(e) => setStmtTo(e.target.value)}
                  className="w-full"
                />
              </div>
              {(stmtSearch || stmtFrom || stmtTo || stmtService) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => {
                    setStmtSearch("");
                    setStmtFrom("");
                    setStmtTo("");
                    setStmtService("");
                  }}
                >
                  মুছুন
                </Button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <Table className="table-fixed w-full min-w-[1000px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[112px] whitespace-nowrap pr-2">Date</TableHead>
                  <TableHead className="w-[176px] whitespace-nowrap pl-2">ID</TableHead>
                  <TableHead className="w-[112px] whitespace-nowrap">Service Type</TableHead>
                  <TableHead className="min-w-[150px]">Description</TableHead>
                  <TableHead className="w-[112px] text-right whitespace-nowrap px-4">Prev. Bal</TableHead>
                  <TableHead className="w-[120px] text-right whitespace-nowrap px-4 text-emerald-600">
                    {isCustomer ? "Deposit" : "Payment"}
                  </TableHead>
                  <TableHead className="w-[104px] text-right px-4 text-amber-600">Credit</TableHead>
                  <TableHead className={`w-[128px] text-right px-4 pr-6`}>Balance</TableHead>
                  

                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : filteredStatement.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                      কোনো হিসাব নেই
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedStatement.map((s, idx) => (
                    <TableRow
                      key={s.id}
                      className={`row-tint-${idx % 4} ${s.isPayment ? "ledger-payment-row font-medium" : ""} ${s.incomplete ? "opacity-50 italic" : ""}`}
                      title={s.incomplete ? "এই কাজটি এখনো সম্পন্ন হয়নি (ভেন্ডর থেকে আসেনি / ডেলিভারির উপযোগী নয়)" : undefined}
                    >
                      <TableCell className={`whitespace-nowrap pr-2 text-xs ${s.isPayment ? "text-emerald-600 font-medium" : ""}`}>{formatDate(s.date)}</TableCell>
                      <TableCell className={`truncate font-mono text-xs pl-2 ${s.isPayment ? "text-emerald-600 font-medium" : ""}`} title={s.ledgerId}>{s.ledgerId}</TableCell>
                      <TableCell className={`truncate ${s.isPayment ? "text-emerald-600 font-medium" : ""}`} title={s.service}>{s.service}</TableCell>
                      <TableCell className={`truncate ${s.isPayment ? "text-emerald-600 font-medium" : ""}`} title={s.description}>
                        <span className="inline-flex items-center gap-1.5">
                          {s.incomplete && (
                            <span className="inline-block shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium not-italic text-amber-600">
                              ⏳ অসম্পূর্ণ
                            </span>
                          )}
                          <span className="truncate">{s.description || "—"}</span>
                        </span>
                      </TableCell>
                      <TableCell className={`text-right tabular-nums px-4 ${s.isPayment ? "text-emerald-600" : "text-muted-foreground"}`}>
                        {s.previous.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600 px-4">
                        {s.deposit ? s.deposit.toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums px-4 ${s.isPayment ? "text-emerald-600" : "text-amber-600"}`}>
                        {s.credit ? s.credit.toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold px-4 pr-6`}>
                        {isCustomer ? (
                          s.balance > 0 ? (
                            <div className="text-rose-600 leading-tight">
                              <div>{s.balance.toLocaleString()}</div>
                              <div className="text-[10px] font-medium">Due</div>
                            </div>
                          ) : s.balance < 0 ? (
                            <div className="text-emerald-600 leading-tight">
                              <div>+{Math.abs(s.balance).toLocaleString()}</div>
                              <div className="text-[10px] font-medium">Adv</div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )
                        ) : s.balance < 0 ? (
                          <div className="text-rose-600 leading-tight">
                            <div>{s.balance.toLocaleString()}</div>
                            <div className="text-[10px] font-medium">V Due</div>
                          </div>
                        ) : s.balance > 0 ? (
                          <div className="text-emerald-600 leading-tight">
                            <div>+{s.balance.toLocaleString()}</div>
                            <div className="text-[10px] font-medium">Adv</div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {!loading && filteredStatement.length > 0 && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>প্রতি পৃষ্ঠায়</span>
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-[72px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="150">150</SelectItem>
                    <SelectItem value="200">200</SelectItem>
                  </SelectContent>
                </Select>
                <span>টি দেখান</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  পৃষ্ঠা {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  পূর্ববর্তী
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  পরবর্তী
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}
        </>
      )}
    </div>
  );
}
