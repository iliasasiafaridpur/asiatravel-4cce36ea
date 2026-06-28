import { Fragment, useEffect, useId, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, moduleByKey } from "@/lib/modules";
import { LedgerPage } from "@/components/LedgerPage";
import { SettleModeBadge } from "@/components/SettleModeBadge";
import { PageWatermark } from "@/components/PageWatermark";
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(!!autoPayTarget);
  // Filter text for the on-page party list (shown when no party is selected).
  const [listFilter, setListFilter] = useState("");
  // Live balance rows for the on-page list (same data as Agent/Vendor List pages).
  const [balances, setBalances] = useState<
    { name: string; serial?: number | null; bill: number; paid: number; due: number; advance: number }[]
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

  const [rows, setRows] = useState<LedgerRow[]>([]);
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

  const settleMode = (contact?.settle_mode ?? "total") === "one_by_one" ? "one_by_one" : "total";

  useEffect(() => {
    setDisplayName(name);
    setEditing(false);
  }, [name]);

  // Load the full party list (contacts + any names appearing in the ledger) for
  // the dropdown search filter beside the page title.
  useEffect(() => {
    let cancelled = false;
    const loadParties = async () => {
      const [contactsRes, ledgerRes] = await Promise.all([
        supabase.from(contactsTable as never).select("name").limit(5000),
        supabase.from(table as never).select(groupField).limit(5000),
      ]);
      const set = new Set<string>();
      for (const r of (contactsRes.data as { name?: string }[] | null) ?? []) {
        const n = String(r.name ?? "").trim();
        if (n) set.add(n);
      }
      for (const r of (ledgerRes.data as Record<string, unknown>[] | null) ?? []) {
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
  }, [contactsTable, table, groupField, isCustomer]);

  // Load live balances (same RPC the Agent/Vendor List pages use) for the
  // on-page list shown when no party is selected.
  const rtId = useId();
  useEffect(() => {
    if (name) return;
    let cancelled = false;
    const loadBalances = async () => {
      const [{ data }, contactsRes] = await Promise.all([
        supabase.rpc((isCustomer ? "get_agent_balances" : "get_vendor_balances") as never),
        supabase.from(contactsTable as never).select("name,serial_no").limit(5000),
      ]);
      const serialByName = new Map(
        (((contactsRes.data as unknown as { name?: string | null; serial_no?: number | null }[]) ?? [])
          .map((c) => [String(c.name ?? "").trim().toLowerCase(), c.serial_no ?? null] as const)
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
  }, [isCustomer, table, name, rtId]);




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
    for (const r of rows) {
      const amt = Number((r as Record<string, unknown>)[paidCol] ?? 0);
      if (!(amt > 0)) continue;
      // গ্রহণ/পরিশোধের আসল তারিখ payment_date; না থাকলে entry_date।
      const rec = r as Record<string, unknown>;
      const date = String(rec.payment_date ?? rec.entry_date ?? "");
      if (!best || date >= best.date) best = { date, amount: amt };
    }
    return best;
  }, [rows, paidCol]);

  const serialCode =
    contact?.serial_no != null
      ? `${isCustomer ? "AGT" : "VEN"}-${String(contact.serial_no).padStart(3, "0")}`
      : null;

  const load = async () => {
    setLoading(true);
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
    const ledgerRows = (ledgerRes.data as unknown as LedgerRow[]) ?? [];
    setRows(ledgerRows);
    // Duplicate-tolerant: a name should map to one contact, but if stale
    // duplicates ever exist, merge them so an explicit "এক একটা বিল" choice
    // and any saved phone/address are never lost (root cause of settings not sticking).
    const contactRows = (contactRes.data as Contact[] | null) ?? [];
    const mergedContact: Contact | null = contactRows.length
      ? {
          phone: contactRows.find((c) => c.phone)?.phone ?? null,
          phone_labels: contactRows.find((c) => c.phone)?.phone_labels ?? null,
          address: contactRows.find((c) => c.address)?.address ?? null,
          settle_mode: contactRows.some((c) => c.settle_mode === "one_by_one")
            ? "one_by_one"
            : "total",
          serial_no: contactRows.find((c) => c.serial_no != null)?.serial_no ?? null,
          full_name: contactRows.find((c) => c.full_name)?.full_name ?? null,
          notes: contactRows.find((c) => c.notes)?.notes ?? null,
        }
      : null;
    setContact(mergedContact);


    // Pick this party's authoritative balance row.
    const balRows = (balRes.data as unknown as Record<string, unknown>[]) ?? [];
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

    // For vendors: pull each source file's module id, the date it actually
    // counted in the vendor balance (received_date for delivery items), and the
    // extra description fields. bmet/saudi/kuwait only count once received.
    const map = new Map<string, SrcInfo>();
    if (!isCustomer) {
      // table -> [columns to select], with a normalizer for each row.
      const specs: Record<string, { cols: string; map: (r: Record<string, unknown>) => SrcInfo }> = {
        bmet_cards: {
          cols: "id,bmet_id,received_date,country_name",
          map: (r) => ({ displayId: r.bmet_id as string, countDate: r.received_date as string, country: r.country_name as string }),
        },
        saudi_visas: {
          cols: "id,saudi_id,received_date",
          map: (r) => ({ displayId: r.saudi_id as string, countDate: r.received_date as string }),
        },
        kuwait_visas: {
          cols: "id,kuwait_id,received_date",
          map: (r) => ({ displayId: r.kuwait_id as string, countDate: r.received_date as string }),
        },
        tickets: {
          cols: "id,ticket_id,airline,entry_date",
          map: (r) => ({ displayId: r.ticket_id as string, airline: r.airline as string, countDate: r.entry_date as string }),
        },
      };
      const byTable: Record<string, string[]> = {};
      for (const r of ledgerRows) {
        const src = String(r.source_table ?? "");
        const sid = String(r.source_id ?? "");
        if (sid && specs[src]) (byTable[src] ||= []).push(sid);
      }
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
    setLoading(false);
  };

  useEffect(() => {
    if (!displayName) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayName, table]);


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
      // Map: bill row id -> amount already covered by a green PAYMENT row.
      // Each PAYMENT log stores alloc_detail.items = the exact bills it paid. We
      // use it so the same money is never shown twice: the covered portion of a
      // bill's paid_amount is represented by the green Payment row instead of
      // being repeated in that bill's own Payment column.
      const coveredByBill = new Map<string, number>();
      for (const r of rows) {
        if (String(r.service_type ?? "").toUpperCase() !== "PAYMENT") continue;
        const det = (r as Record<string, unknown>).alloc_detail as
          | { items?: Array<{ id?: string; amt?: number }> }
          | null;
        for (const it of det?.items ?? []) {
          const bid = String(it?.id ?? "");
          if (!bid) continue;
          coveredByBill.set(bid, (coveredByBill.get(bid) ?? 0) + Number(it?.amt ?? 0));
        }
      }
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
          // headline amount paid.
          const det = (r as Record<string, unknown>).alloc_detail as
            | { items?: Array<{ amt?: number }> }
            | null;
          const allocSum = (det?.items ?? []).reduce((s, it) => s + Number(it?.amt ?? 0), 0);
          cash = allocSum;
          displayPaid = rawPaid;
          bill = 0;
        } else if (isDeposit) {
          cash = rawPaid;
          displayPaid = rawPaid;
          bill = 0;
        } else {
          // Bill row: show its cost as Credit. Only the portion of paid_amount
          // NOT already shown on a green Payment row appears in the Payment
          // column (e.g. direct / Vendor-Received settlements that have no log).
          const covered = coveredByBill.get(String(r.id)) ?? 0;
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
        };
      });

      // 4) Latest entry on top.
      return out.reverse();
    }

    // CUSTOMER: keep the advance-wallet aware logic.
    let bal = 0;
    let adv = 0;
    const out: Stmt[] = [];
    for (const r of rows) {
      const svc = String(r.service_type ?? "").toUpperCase();
      if (svc === "PAYMENT" || svc === "OPENING") continue;
      const advRow = svc === "ADVANCE";
      const cash = Number(r[paidCol] ?? 0);
      const applied = Number(r.advance_applied ?? 0);
      const bill = Number(r[billCol] ?? 0);
      const discount = Number(r.discount_amount ?? 0);
      const prev = bal;

      if (advRow) {
        adv += cash;
      } else {
        bal = prev + bill - cash - applied - discount;
        adv = Math.max(adv - applied, 0);
      }
      out.push({
        id: String(r.id),
        ledgerId: String(r.ledger_id ?? ""),
        date: String(r.entry_date ?? ""),
        service: advRow ? "Payment" : String(r.service_type ?? "—"),
        description: String(r.passenger_name ?? "").trim(),
        previous: prev,
        deposit: advRow ? cash : cash + applied,
        credit: advRow ? 0 : bill,
        balance: bal,
        advance: Math.max(adv, 0),
        isPayment: advRow,
      });
    }
    // Latest entry on top (same as the vendor ledger).
    return out.reverse();
  }, [rows, billCol, paidCol, isCustomer, srcMap]);

  // Per-bill breakdown for "এক একটা বিল" (Bill-by-Bill) parties. Each booking is
  // shown with its own বাকি / আংশিক / পরিশোধিত status so one-by-one settlement is
  // crystal clear.
  type BillPay = { date: string; amt: number; method: string };
  type BillItem = {
    id: string;
    ledgerId: string;
    date: string;
    service: string;
    description: string;
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
  };
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
    if (!isCustomer) {
      for (const r of rows) {
        if (String(r.service_type ?? "").toUpperCase() !== "PAYMENT") continue;
        const det = (r as Record<string, unknown>).alloc_detail as
          | { items?: Array<{ id?: string; amt?: number }> }
          | null;
        const pdate = String(r.payment_date ?? r.entry_date ?? "");
        const method = String(r.payment_method ?? "");
        for (const it of det?.items ?? []) {
          const bid = String(it?.id ?? "");
          if (!bid) continue;
          const arr = payByBill.get(bid) ?? [];
          arr.push({ date: pdate, amt: Number(it?.amt ?? 0), method });
          payByBill.set(bid, arr);
        }
      }
    }
    const out: BillItem[] = [];
    for (const r of rows) {
      const svc = String(r.service_type ?? "").toUpperCase();
      if (svc === "PAYMENT" || svc === "ADVANCE" || svc === "OPENING") continue;
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
        if (direct > 0) payments.push({ date: rowPayDate, amt: direct, method: rowMethod || "Cash" });
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

      const due = Math.max(0, bill - paid);
      const status: BillItem["status"] = due <= 0.5 ? "paid" : paid > 0 ? "partial" : "due";
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
        bill,
        paid,
        due,
        status,
        payments,
        payDate,
        ageDays: status === "paid" ? null : daysBetween(date, t),
        paidInDays: status === "paid" ? daysBetween(date, payDate) : null,
      });
    }
    // Unpaid first, then partial, then paid; oldest outstanding on top so the
    // most overdue bill is the first thing seen.
    const rank = { due: 0, partial: 1, paid: 2 } as const;
    out.sort((a, b) => {
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      if (a.status === "paid") return (b.payDate || b.date).localeCompare(a.payDate || a.date);
      return (a.date || "9999").localeCompare(b.date || "9999"); // oldest due first
    });
    return out;
  }, [rows, billCol, paidCol, isCustomer, srcMap]);

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

  // Open a clean, self-contained print sheet of the bill-by-bill statement.
  const printBills = () => {
    const esc = (s: string) =>
      String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c));
    const head = isCustomer ? "গ্রহণ" : "পরিশোধ";
    const rowsHtml = bills
      .map((b) => {
        const st =
          b.status === "paid"
            ? "পরিশোধিত"
            : b.status === "partial"
              ? `আংশিক · বাকি ${b.due.toLocaleString()}`
              : `বাকি ${b.due.toLocaleString()}`;
        const age =
          b.status === "paid"
            ? b.paidInDays != null
              ? `${b.paidInDays} দিনে`
              : ""
            : b.ageDays != null
              ? `${b.ageDays} দিন`
              : "";
        return `<tr>
          <td>${esc(formatDate(b.date))}</td>
          <td>${esc(b.ledgerId)}</td>
          <td>${esc([b.service, b.description].filter(Boolean).join(" · "))}</td>
          <td class="r">${b.bill.toLocaleString()}</td>
          <td class="r">${b.paid ? b.paid.toLocaleString() : "—"}</td>
          <td>${esc(b.payDate ? formatDate(b.payDate) : "—")}</td>
          <td>${esc(st)}${age ? ` · ${esc(age)}` : ""}</td>
        </tr>`;
      })
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(displayName)} — বিল-ভিত্তিক হিসাব</title>
      <style>
        body{font-family:system-ui,'Noto Sans Bengali',sans-serif;padding:24px;color:#0f172a}
        h1{font-size:18px;margin:0 0 2px}
        .sub{color:#64748b;font-size:12px;margin-bottom:12px}
        .sum{font-size:13px;margin-bottom:12px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}
        th{background:#f1f5f9}
        .r{text-align:right;font-variant-numeric:tabular-nums}
        @media print{button{display:none}}
      </style></head><body>
      <h1>${esc(displayName)} — বিল-ভিত্তিক হিসাব</h1>
      <div class="sub">${isCustomer ? "Agency" : "Vendor"} Ledger · প্রিন্ট: ${esc(formatDate(todayISO()))}</div>
      <div class="sum">মোট বিল: ${bills.length} টি · বাকি: ${billStats.dueCount + billStats.partialCount} টি · পরিশোধিত: ${billStats.paidCount} টি · মোট বাকি: ৳${billStats.dueAmount.toLocaleString()}</div>
      <table><thead><tr>
        <th>তারিখ</th><th>ID</th><th>বিবরণ</th><th class="r">বিল</th><th class="r">${head}</th><th>${head} তারিখ</th><th>স্ট্যাটাস</th>
      </tr></thead><tbody>${rowsHtml}</tbody></table>
      <script>window.onload=function(){window.print()}</script>
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) {
      toast.error("প্রিন্ট উইন্ডো খোলা যায়নি (পপ-আপ ব্লক?)");
      return;
    }
    w.document.write(html);
    w.document.close();
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
            <Input
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value)}
              placeholder={isCustomer ? "Agency খুঁজুন…" : "Vendor খুঁজুন…"}
              className="h-9 max-w-sm"
            />
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
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
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
                        <TableCell className="font-mono text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                          {isCustomer ? "AGT" : "VEN"}-{String(b.serial ?? (idx + 1)).padStart(3, "0")}
                        </TableCell>
                        <TableCell className="font-medium">{b.name}</TableCell>
                        <TableCell className="text-right tabular-nums">৳ {b.bill.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-600">৳ {b.paid.toLocaleString()}</TableCell>
                        <TableCell className={`text-right tabular-nums font-semibold ${b.due > 0 ? "text-rose-600" : "text-muted-foreground"}`}>৳ {b.due.toLocaleString()}</TableCell>
                        <TableCell className={`text-right tabular-nums font-semibold ${b.advance > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>৳ {b.advance.toLocaleString()}</TableCell>
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
                onClick={printBills}
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
                            className={`row-tint-${idx % 4} ${hasHist ? "cursor-pointer" : ""}`}
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
                                            {p.method}
                                          </span>
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

      {/* Ledger statement */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          {/* Heading + inline search/date-range filter for this ledger statement. */}
          <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-center gap-2 lg:mb-1">
              <h3 className="text-sm font-semibold">{pageTitle}</h3>
              <Badge variant="secondary" className="text-[11px] font-medium">
                মোট {statement.length} টি
              </Badge>
              {(stmtSearch || stmtFrom || stmtTo || stmtService) && (
                <Badge className="text-[11px] font-medium">
                  ফলাফল {filteredStatement.length} টি
                </Badge>
              )}
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
                  <TableHead className={`w-[128px] text-right px-4 ${isCustomer ? "" : "pr-6"}`}>Balance</TableHead>
                  {isCustomer && (
                    <TableHead className="w-[104px] text-right px-4 pr-6">Advance</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={isCustomer ? 9 : 8} className="text-center text-muted-foreground py-6">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : filteredStatement.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isCustomer ? 9 : 8} className="text-center text-muted-foreground py-6">
                      কোনো হিসাব নেই
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedStatement.map((s, idx) => (
                    <TableRow
                      key={s.id}
                      className={`row-tint-${idx % 4} ${s.isPayment ? "ledger-payment-row font-medium" : ""}`}
                    >
                      <TableCell className={`whitespace-nowrap pr-2 text-xs ${s.isPayment ? "text-emerald-600 font-medium" : ""}`}>{formatDate(s.date)}</TableCell>
                      <TableCell className={`truncate font-mono text-xs pl-2 ${s.isPayment ? "text-emerald-600 font-medium" : ""}`} title={s.ledgerId}>{s.ledgerId}</TableCell>
                      <TableCell className={`truncate ${s.isPayment ? "text-emerald-600 font-medium" : ""}`} title={s.service}>{s.service}</TableCell>
                      <TableCell className={`truncate ${s.isPayment ? "text-emerald-600 font-medium" : ""}`} title={s.description}>{s.description || "—"}</TableCell>
                      <TableCell className={`text-right tabular-nums px-4 ${s.isPayment ? "text-emerald-600" : "text-muted-foreground"}`}>
                        {s.previous.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600 px-4">
                        {s.deposit ? s.deposit.toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums px-4 ${s.isPayment ? "text-emerald-600" : "text-amber-600"}`}>
                        {s.credit ? s.credit.toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold px-4 ${isCustomer ? "" : "pr-6"}`}>
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
                      {isCustomer && (
                        <TableCell className="text-right tabular-nums text-emerald-600 px-4 pr-6">
                          {s.advance ? s.advance.toLocaleString() : "—"}
                        </TableCell>
                      )}
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
        </>
      )}
    </div>
  );
}
