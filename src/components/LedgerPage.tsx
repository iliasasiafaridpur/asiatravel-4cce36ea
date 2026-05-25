import { DateInput } from "@/components/ui/date-input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { resilientInsert } from "@/lib/offline-queue";
import { generateNextId } from "@/lib/idgen";
import { formatDate, statusBadgeClass, MODULES, type ModuleSchema, type Field } from "@/lib/modules";
import { PassengerProfileDrawer } from "@/components/PassengerProfileDrawer";
import { LookupSelect } from "@/components/LookupSelect";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Wallet,
  RotateCcw,
  Eye,
  CreditCard,
  FileSpreadsheet,
  Printer,
  Receipt,
} from "lucide-react";
import { toast } from "sonner";
import { notify } from "@/lib/notify";
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { FormSections } from "@/components/ModulePage";
import { PartyProfileDrawer } from "@/components/PartyProfileDrawer";
import { cn } from "@/lib/utils";

type Row = Record<string, unknown> & { id: string };

interface Props {
  module: ModuleSchema;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

function emptyForm(mod: ModuleSchema): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  for (const field of mod.fields) {
    if (field.type === "number") f[field.name] = 0;
    else if (field.type === "boolean") f[field.name] = false;
    else if (field.type === "date" && field.name === "entry_date") f[field.name] = todayIso();
    else if (field.lookup === "sub_agency") f[field.name] = "Self";
    else f[field.name] = "";
  }
  return f;
}

function selectColumns(mod: ModuleSchema): string {
  const cols = new Set(["id", mod.idColumn, "created_at", "created_by"]);
  if (mod.key === "agency-ledger" || mod.key === "vendor-ledger") {
    cols.add("source_id");
    cols.add("source_table");
    cols.add("advance_applied");
  }
  mod.fields.forEach((field) => cols.add(field.name));
  return Array.from(cols).join(",");
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    return String(o.message ?? o.details ?? o.hint ?? JSON.stringify(o));
  }
  return String(e);
}

export function LedgerPage({ module: mod }: Props) {
  const { user, profile } = useCurrentUser();
  const [rows, setRows] = useState<Row[]>([]);
  const [ticketFlightMap, setTicketFlightMap] = useState<Map<string, string>>(new Map());
  const [ticketRouteMap, setTicketRouteMap] = useState<Map<string, string>>(new Map());
  const [bmetCountryMap, setBmetCountryMap] = useState<Map<string, string>>(new Map());
  const [visaCountryMap, setVisaCountryMap] = useState<Map<string, string>>(new Map());
  const [sourceInfoMap, setSourceInfoMap] = useState<
    Map<
      string,
      {
        passport?: string;
        mobile?: string;
        vendor?: string;
        agency_sold?: string;
        sold?: number;
        cost?: number;
        discount?: number;
        status?: string;
        airline?: string;
        pnr?: string;
        received_from_vendor?: boolean;
      }
    >
  >(new Map());

  const [profilesMap, setProfilesMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [serviceFilter, setServiceFilter] = useState<string>("all");
  const [dueOnly, setDueOnly] = useState(false);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [latestInput, setLatestInput] = useState("");
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>(() => emptyForm(mod));
  const [saving, setSaving] = useState(false);
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);
  const [viewRow, setViewRow] = useState<Row | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<string>("");
  const [payDue, setPayDue] = useState<number>(0);
  const [payDate, setPayDate] = useState<string>(todayIso());
  const [payAmount, setPayAmount] = useState<string>("");
  const [payRemarks, setPayRemarks] = useState<string>("");
  const [payMethod, setPayMethod] = useState<string>("Cash");
  const [paySaving, setPaySaving] = useState(false);
  // When set, payment is for THIS specific ledger row (passenger-specific).
  // When null, payment is at the agent/vendor level (legacy bulk flow).
  const [payRow, setPayRow] = useState<Row | null>(null);
  // Bulk allocation mode: "fifo" = oldest-first auto; "specific" = bill-by-bill checklist
  const [payMode, setPayMode] = useState<"fifo" | "specific">("fifo");
  // For specific mode: rowId -> amount string
  const [selectedLines, setSelectedLines] = useState<Record<string, string>>({});
  // Advance payment toggle: when true, skip booking allocation and just record an ADVANCE entry
  const [payAsAdvance, setPayAsAdvance] = useState<boolean>(false);
  // MD Sir external deposit: credits vendor advance without touching cash/bank accounts
  const [payAsMdDeposit, setPayAsMdDeposit] = useState<boolean>(false);
  const [profileParty, setProfileParty] = useState<string | null>(null);
  const [passengerProfile, setPassengerProfile] = useState<{
    row: Row;
    serviceTable: string;
    moduleKey?: string;
    statusOrder?: string[];
  } | null>(null);

  const openProfileFor = useCallback(
    async (r: Row) => {
      const gf = mod.groupBy?.field ?? "agent_name";
      const party = String(r[gf] ?? "").trim();
      const isSelf = party.toLowerCase() === "self";
      if (!isSelf) {
        setProfileParty(party);
        return;
      }
      const srcTable = String(r.source_table ?? "");
      const srcId = String(r.source_id ?? "");
      const srcModule = srcTable ? MODULES.find((m) => m.table === srcTable) : undefined;
      if (srcTable && srcId) {
        const { data } = await supabase
          .from(srcTable as never)
          .select("*")
          .eq("id", srcId)
          .maybeSingle();
        const fullRow = (data as Row | null) ?? r;
        setPassengerProfile({
          row: fullRow,
          serviceTable: srcTable,
          moduleKey: srcModule?.key,
          statusOrder: srcModule?.statuses,
        });
      } else {
        setPassengerProfile({
          row: r,
          serviceTable: srcTable || mod.table,
          moduleKey: srcModule?.key,
          statusOrder: srcModule?.statuses,
        });
      }
    },
    [mod],
  );

  const PAYMENT_METHODS = [
    "Cash",
    "bKash",
    "Nagad",
    "Rocket",
    "Bank Transfer",
    "Cheque",
    "Card",
    "Other",
  ];
  const loadingRef = useRef(false);
  const columns = useMemo(() => selectColumns(mod), [mod]);

  const groupField = mod.groupBy?.field ?? "agent_name";
  const groupLabel = mod.groupBy?.label ?? "Agent";
  const isAgency = mod.key === "agency-ledger";
  const billCol = isAgency ? "total_bill" : "total_payable";
  const paidCol = isAgency ? "received_amount" : "paid_amount";
  const discountOf = (r: Row) => isAgency ? Number(r.discount_amount ?? 0) : 0;
  const billLabel = isAgency ? "Total Bill" : "Total Payable";
  const paidLabel = isAgency ? "Total Received" : "Total Paid";
  const payTitle = isAgency ? "পেমেন্ট গ্রহণ এন্ট্রি" : "পেমেন্ট পরিশোধ এন্ট্রি";
  const payAmountLabel = isAgency ? "Received Amount" : "Paid Amount";
  const groupFieldLabel = isAgency ? "Agent Name" : "Vendor Name";

  // Form schema with country_route lookup switching based on selected service_type.
  const formMod = useMemo<ModuleSchema>(() => {
    const svc = String(form.service_type ?? "").toUpperCase();
    const isBmet = svc.includes("BMET");
    const lookupKind = isBmet ? "country" : "route";
    const newLabel = isBmet ? "Country" : svc.includes("VISA") ? "Country" : "Route";
    const fields: Field[] = mod.fields.map((f) =>
      f.name === "country_route" ? { ...f, label: newLabel, lookup: lookupKind } : f,
    );
    return { ...mod, fields };
  }, [mod, form.service_type]);
  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const { data, error } = await supabase
        .from(mod.table as never)
        .select(columns)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const list = (data as unknown as Row[]) ?? [];
      setRows(list);
    } catch (e) {
      toast.error("লোড সমস্যা: " + errMsg(e));
    }
    loadingRef.current = false;
    setLoading(false);
  }, [mod.table, columns]);

  useEffect(() => {
    void load();
  }, [load]);

  // Load source-table enrichment maps: tickets (route + flight_date), bmet (country), saudi/kuwait visas (sponsor/country)
  useEffect(() => {
    (async () => {
      const [tk, bm, kv, sv] = await Promise.all([
        supabase
          .from("tickets")
          .select(
            "id,flight_date,trip_road,passport,mobile,vendor_bought,agency_sold,sold_price,cost_price,discount_amount,status,airline,pnr",
          )
          .limit(2000),
        supabase
          .from("bmet_cards")
          .select("id,country_name,passport,mobile,vendor_bought,agency_sold,sold_price,cost_price,discount_amount,status,received_date")
          .limit(2000),
        supabase
          .from("kuwait_visas")
          .select("id,passport,mobile,vendor_bought,agency_sold,sold_price,cost_price,discount_amount,status")
          .limit(2000),
        supabase
          .from("saudi_visas")
          .select("id,passport,mobile,vendor_bought,agency_sold,sold_price,cost_price,discount_amount,status")
          .limit(2000),
      ]);
      const fm = new Map<string, string>();
      const rm = new Map<string, string>();
      const info = new Map<
        string,
        {
          passport?: string;
          mobile?: string;
          vendor?: string;
          agency_sold?: string;
          sold?: number;
          cost?: number;
          discount?: number;
          status?: string;
          airline?: string;
          pnr?: string;
          received_from_vendor?: boolean;
        }
      >();

      type T = {
        id: string;
        flight_date: string | null;
        trip_road: string | null;
        passport: string | null;
        mobile: string | null;
        vendor_bought: string | null;
        agency_sold: string | null;
        sold_price: number | null;
        cost_price: number | null;
        status: string | null;
        airline: string | null;
        pnr: string | null;
        discount_amount: number | null;
      };
      for (const t of (tk.data as unknown as T[]) ?? []) {
        if (t.flight_date) fm.set(t.id, t.flight_date);
        if (t.trip_road) rm.set(t.id, t.trip_road);
        info.set(t.id, {
          passport: t.passport ?? undefined,
          mobile: t.mobile ?? undefined,
          vendor: t.vendor_bought ?? undefined,
          agency_sold: t.agency_sold ?? undefined,
          sold: t.sold_price ?? undefined,
          cost: t.cost_price ?? undefined,
          discount: t.discount_amount ?? undefined,
          status: t.status ?? undefined,
          airline: t.airline ?? undefined,
          pnr: t.pnr ?? undefined,
        });
      }
      const cm = new Map<string, string>();
      type B = {
        id: string;
        country_name: string | null;
        passport: string | null;
        mobile: string | null;
        vendor_bought: string | null;
        agency_sold: string | null;
        sold_price: number | null;
        cost_price: number | null;
        status: string | null;
        received_date: string | null;
        discount_amount: number | null;
      };
      for (const b of (bm.data as unknown as B[]) ?? []) {
        if (b.country_name) cm.set(b.id, b.country_name);
        info.set(b.id, {
          passport: b.passport ?? undefined,
          mobile: b.mobile ?? undefined,
          vendor: b.vendor_bought ?? undefined,
          agency_sold: b.agency_sold ?? undefined,
          sold: b.sold_price ?? undefined,
          cost: b.cost_price ?? undefined,
          discount: b.discount_amount ?? undefined,
          status: b.status ?? undefined,
          received_from_vendor:
            (b.status ?? "") === "Pending Delivery" && !!b.received_date,
        });
      }
      const vm = new Map<string, string>();
      type V = {
        id: string;
        passport: string | null;
        mobile: string | null;
        vendor_bought: string | null;
        agency_sold: string | null;
        sold_price: number | null;
        cost_price: number | null;
        discount_amount: number | null;
        status: string | null;
      };
      for (const v of (kv.data as unknown as V[]) ?? []) {
        vm.set(v.id, "Kuwait");
        info.set(v.id, {
          passport: v.passport ?? undefined,
          mobile: v.mobile ?? undefined,
          vendor: v.vendor_bought ?? undefined,
          agency_sold: v.agency_sold ?? undefined,
          sold: v.sold_price ?? undefined,
          cost: v.cost_price ?? undefined,
          discount: v.discount_amount ?? undefined,
          status: v.status ?? undefined,
          received_from_vendor: (v.status ?? "") === "Pending Delivery",
        });
      }
      for (const v of (sv.data as unknown as V[]) ?? []) {
        vm.set(v.id, "Saudi Arabia");
        info.set(v.id, {
          passport: v.passport ?? undefined,
          mobile: v.mobile ?? undefined,
          vendor: v.vendor_bought ?? undefined,
          agency_sold: v.agency_sold ?? undefined,
          sold: v.sold_price ?? undefined,
          cost: v.cost_price ?? undefined,
          discount: v.discount_amount ?? undefined,
          status: v.status ?? undefined,
          received_from_vendor: (v.status ?? "") === "Pending Delivery",
        });
      }

      setTicketFlightMap(fm);
      setTicketRouteMap(rm);
      setBmetCountryMap(cm);
      setVisaCountryMap(vm);
      setSourceInfoMap(info);
      const { data: profs } = await supabase.from("profiles").select("user_id,full_name");
      const pm: Record<string, string> = {};
      for (const p of (profs as { user_id: string; full_name: string }[] | null) ?? [])
        pm[p.user_id] = p.full_name;
      setProfilesMap(pm);
    })();
  }, []);

  useEffect(() => {
    const ch = supabase
      .channel(`rt_${mod.table}`)
      .on("postgres_changes", { event: "*", schema: "public", table: mod.table }, () => void load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [mod.table, load]);

  const balanceOf = (r: Row) => Number(r[billCol] ?? 0) - Number(r[paidCol] ?? 0) - discountOf(r);

  // ADVANCE rows are a standalone wallet — never net them against bill rows.
  const isAdvanceRow = (r: Row) =>
    String(r.service_type ?? "").toUpperCase() === "ADVANCE";

  const advanceAdjustedRows = useMemo(() => {
    const adjusted = new Map<string, { applied: number; displayPaid: number; displayDue: number }>();
    for (const r of rows) {
      if (isAdvanceRow(r)) continue;
      const applied = Number(r.advance_applied ?? 0);
      const cashPaid = Number(r[paidCol] ?? 0);
      const discount = discountOf(r);
      adjusted.set(r.id, {
        applied,
        displayPaid: cashPaid + applied,
        displayDue: Math.max(Number(r[billCol] ?? 0) - cashPaid - discount - applied, 0),
      });
    }
    return adjusted;
  }, [rows, billCol, paidCol]);

  // Net due per group: bill rows minus cash payment and persisted advance adjustment.
  const dueByGroup = useMemo(() => {
    const due = new Map<string, number>();
    for (const r of rows) {
      if (isAdvanceRow(r)) continue;
      const k = String(r[groupField] ?? "");
      due.set(k, (due.get(k) ?? 0) + Math.max(Number(r[billCol] ?? 0) - Number(r[paidCol] ?? 0) - discountOf(r) - Number(r.advance_applied ?? 0), 0));
    }
    const m = new Map<string, number>();
    due.forEach((v, k) => m.set(k, Math.max(v, 0)));
    return m;
  }, [rows, groupField, billCol, paidCol]);



  const serviceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const s = String(r.service_type ?? "").trim();
      if (s) set.add(s);
    }
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let xs = rows;
    if (groupFilter !== "all") xs = xs.filter((r) => String(r[groupField] ?? "") === groupFilter);
    if (serviceFilter !== "all") xs = xs.filter((r) => String(r.service_type ?? "") === serviceFilter);
    // "শুধু Due" — show rows whose group has a net positive balance (so paid-off vendors disappear entirely).
    if (dueOnly) xs = xs.filter((r) => (dueByGroup.get(String(r[groupField] ?? "")) ?? 0) > 0);
    if (startDate) xs = xs.filter((r) => String(r.entry_date ?? "").slice(0, 10) >= startDate);
    if (endDate) xs = xs.filter((r) => String(r.entry_date ?? "").slice(0, 10) <= endDate);
    const q = search.trim().toLowerCase();
    if (q)
      xs = xs.filter((r) =>
        Object.values(r).some((v) =>
          String(v ?? "")
            .toLowerCase()
            .includes(q),
        ),
      );
    // Latest-N limiter: only when date range NOT active
    if (!startDate && !endDate) {
      const parsed = /^\d+$/.test(latestInput.trim()) ? parseInt(latestInput.trim(), 10) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) xs = xs.slice(0, parsed);
    }
    return xs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, groupFilter, serviceFilter, dueOnly, startDate, endDate, search, latestInput, dueByGroup]);

  const totals = useMemo(() => {
    let bill = 0,
      paid = 0,
      cashPaid = 0,
      discount = 0,
      applied = 0,
      advance = 0;
    for (const r of filtered) {
      if (isAdvanceRow(r)) {
        advance += Number(r[paidCol] ?? 0);
      } else {
        bill += Number(r[billCol] ?? 0);
        cashPaid += Number(r[paidCol] ?? 0);
        discount += discountOf(r);
        applied += Number(r.advance_applied ?? 0);
      }
    }
    paid = cashPaid + applied;
    return {
      bill,
      paid,
      discount,
      advance: Math.max(advance - applied, 0),
      due: Math.max(bill - cashPaid - discount - applied, 0),
    };
  }, [filtered, billCol, paidCol]);

  // For vendor-ledger: a bill row from BMET/Saudi/Kuwait modules only contributes
  // to Total Payable / Due of Vendor once the source customer's status is
  // "Pending Delivery" AND (for BMET) Received Date From Vendor is entered.
  const countsForVendorDue = useCallback(
    (r: Row) => {
      if (isAgency) return true;
      const src = String(r.source_table ?? "");
      if (src !== "bmet_cards" && src !== "saudi_visas" && src !== "kuwait_visas") return true;
      const info = sourceInfoMap.get(String(r.source_id ?? ""));
      return !!info?.received_from_vendor;
    },
    [isAgency, sourceInfoMap],
  );

  const groupSummary = useMemo(() => {
    const map = new Map<string, { bill: number; cashPaid: number; discount: number; applied: number; advance: number }>();
    for (const r of filtered) {
      const k = String(r[groupField] ?? "—") || "—";
      const cur = map.get(k) ?? { bill: 0, cashPaid: 0, discount: 0, applied: 0, advance: 0 };
      if (isAdvanceRow(r)) {
        cur.advance += Number(r[paidCol] ?? 0);
      } else if (countsForVendorDue(r)) {
        cur.bill += Number(r[billCol] ?? 0);
        cur.cashPaid += Number(r[paidCol] ?? 0);
        cur.discount += discountOf(r);
        cur.applied += Number(r.advance_applied ?? 0);
      }
      map.set(k, cur);
    }
    return Array.from(map.entries())
      .map(([key, v]) => {
        return {
          key,
          bill: v.bill,
          paid: v.cashPaid + v.applied,
          due: Math.max(v.bill - v.cashPaid - v.discount - v.applied, 0),
          advance: Math.max(v.advance - v.applied, 0),
        };
      })
      .sort((a, b) => b.due - a.due);
  }, [filtered, groupField, billCol, paidCol, countsForVendorDue]);


  const groupOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      const v = String(r[groupField] ?? "");
      if (v) set.add(v);
    });
    return Array.from(set).sort();
  }, [rows, groupField]);

  // ---- form actions ----
  const startCreate = () => {
    setEditing(null);
    const f = emptyForm(mod);
    if (mod.fields.some((fld) => fld.name === "entry_by")) f.entry_by = displayName(profile, user);
    setForm(f);
    setOpenForm(true);
  };

  const startEdit = (r: Row) => {
    setEditing(r);
    const f: Record<string, unknown> = {};
    for (const field of mod.fields)
      f[field.name] = r[field.name] ?? (field.type === "number" ? 0 : "");
    setForm(f);
    setOpenForm(true);
  };

  // Compute outstanding for any group key from ALL rows after advance auto-adjustment.
  const dueForGroup = useCallback(
    (key: string) => {
      if (!key) return 0;
      return dueByGroup.get(key) ?? 0;
    },
    [dueByGroup],
  );

  // Open bookings for a group: only rows with positive balance, excluding payment-only entries,
  // sorted oldest-first (entry_date asc, then created_at asc).
  const openBookingsFor = useCallback(
    (key: string): Row[] => {
      if (!key) return [];
      const list = rows.filter(
        (r) =>
          String(r[groupField] ?? "") === key &&
          String(r.service_type ?? "").toUpperCase() !== "PAYMENT" &&
          !isAdvanceRow(r) &&
          (advanceAdjustedRows.get(r.id)?.displayDue ?? Math.max(balanceOf(r), 0)) > 0.0001,
      );
      list.sort((a, b) => {
        const ad = String(a.entry_date ?? "");
        const bd = String(b.entry_date ?? "");
        if (ad !== bd) return ad < bd ? -1 : 1;
        const ac = String(a.created_at ?? "");
        const bc = String(b.created_at ?? "");
        return ac < bc ? -1 : 1;
      });
      return list;
    },
    [rows, groupField, billCol, paidCol, advanceAdjustedRows],
  );

  const openPayment = (groupKey: string, dueAmount: number) => {
    const due = groupKey ? dueForGroup(groupKey) : dueAmount;
    setPayRow(null);
    setPayMode("fifo");
    setSelectedLines({});
    setPayAsAdvance(false);
    setPayAsMdDeposit(false);
    setPayTarget(groupKey);
    setPayDue(due);
    setPayAmount(String(due > 0 ? due : ""));
    setPayDate(todayIso());
    setPayRemarks("");
    setPayMethod("Cash");
    setPayOpen(true);
  };

  // Passenger/row-specific payment: due is THIS row's bill - paid only.
  const openPaymentForRow = (row: Row, lineDue: number) => {
    setPayRow(row);
    setPayMode("fifo");
    setSelectedLines({});
    setPayAsAdvance(false);
    setPayAsMdDeposit(false);
    setPayTarget(String(row[groupField] ?? ""));
    setPayDue(lineDue);
    setPayAmount(String(lineDue > 0 ? lineDue : ""));
    setPayDate(todayIso());
    setPayRemarks("");
    setPayMethod("Cash");
    setPayOpen(true);
  };

  // Map source table -> column to bump for THIS ledger's payment side.
  // Agency receives: customer-received column on each service row.
  // Vendor pays: only saudi_visas tracks vendor-paid (received_vendor).
  const sourceRecvCol = (srcTable: string): string | null => {
    if (isAgency) {
      const m: Record<string, string> = {
        tickets: "received",
        bmet_cards: "received_amount",
        saudi_visas: "received_amount",
        kuwait_visas: "received",
      };
      return m[srcTable] ?? null;
    }
    // vendor side
    if (srcTable === "saudi_visas") return "received_vendor";
    return null;
  };

  // Apply `amt` to a single ledger row: update source row if linked (trigger refreshes ledger),
  // otherwise bump the ledger row's paidCol directly.
  const applyAllocationToRow = async (row: Row, amt: number) => {
    const srcTable = String(row.source_table ?? "");
    const srcId = String(row.source_id ?? "");
    const recvCol = srcTable ? sourceRecvCol(srcTable) : null;
    if (srcTable && srcId && recvCol) {
      const { data: srcRow, error: rErr } = await supabase
        .from(srcTable as never)
        .select(`id, ${recvCol}`)
        .eq("id", srcId)
        .maybeSingle();
      if (rErr) throw rErr;
      const cur = Number((srcRow as Record<string, unknown> | null)?.[recvCol] ?? 0);
      const upd: Record<string, unknown> = { [recvCol]: cur + amt };
      if (isAgency && user?.id) upd.received_by = user.id;
      const { error: uErr } = await supabase
        .from(srcTable as never)
        .update(upd as never)
        .eq("id", srcId);
      if (uErr) throw uErr;
    } else {
      const cur = Number(row[paidCol] ?? 0);
      const { error: uErr } = await supabase
        .from(mod.table as never)
        .update({ [paidCol]: cur + amt } as never)
        .eq("id", row.id);
      if (uErr) throw uErr;
    }
    // Propagate the selected payment method to the ledger row so the
    // cash-sync trigger records the right Cash/Bank category.
    await supabase
      .from(mod.table as never)
      .update({ payment_method: payMethod } as never)
      .eq("id", row.id);
  };

  // Live FIFO allocation preview for the current payAmount.
  const fifoPreview = useMemo(() => {
    if (payRow) return [] as Array<{ row: Row; alloc: number; due: number }>;
    const amt = Number(payAmount) || 0;
    let remaining = amt;
    const list = openBookingsFor(payTarget);
    const out: Array<{ row: Row; alloc: number; due: number }> = [];
    for (const r of list) {
      const due = advanceAdjustedRows.get(r.id)?.displayDue ?? Math.max(balanceOf(r), 0);
      if (remaining <= 0.0001) {
        out.push({ row: r, alloc: 0, due });
        continue;
      }
      const take = Math.min(remaining, due);
      out.push({ row: r, alloc: take, due });
      remaining -= take;
    }
    return out;
  }, [payAmount, payTarget, payRow, openBookingsFor, billCol, paidCol, advanceAdjustedRows]);

  const specificTotal = useMemo(() => {
    let t = 0;
    for (const v of Object.values(selectedLines)) t += Number(v) || 0;
    return t;
  }, [selectedLines]);

  // Write a single cash-drawer mirror entry for a bulk allocation.
  // NOTE: Cash mirror is now handled automatically by database triggers
  // (sync_vendor_payment_to_cash / sync_agent_receipt_to_cash) so manual
  // insert into payment_receipts / cash_expenses is no longer needed.
  // Kept as a no-op for backward compatibility with existing call sites.
  const writeCashMirror = async (_totalAmt: number, _refId: string, _allocSummary: string) => {
    return;
  };

  const submitPayment = async () => {
    if (!payTarget) return toast.error(`${groupFieldLabel} নির্বাচন করুন`);
    setPaySaving(true);
    try {
      // ---------- MD Sir External Deposit (vendor advance, no cash/bank impact) ----------
      if (payAsMdDeposit && !payRow && !isAgency) {
        const amt = Number(payAmount);
        if (!amt || amt <= 0) return toast.error("সঠিক টাকার পরিমাণ দিন");
        const ledgerId = await generateNextId({
          key: mod.key, label: "", short: "", table: mod.table,
          idColumn: mod.idColumn, idPrefix: "VDL",
          monthlyId: true, fields: [],
        });
        const payload: Record<string, unknown> = {
          [mod.idColumn]: ledgerId,
          entry_date: payDate,
          [groupField]: payTarget,
          service_type: "ADVANCE",
          [billCol]: 0,
          [paidCol]: amt,
          payment_method: "MD Sir Deposit",
          // Setting source_table makes sync_vendor_payment_to_cash skip the
          // cash_expenses mirror — so system Cash/Bank balances are untouched.
          source_table: "md_deposit",
          remarks: `MD Sir External Deposit${payRemarks ? " · " + payRemarks : ""}`,
          created_by: user?.id ?? null,
        };
        const { offline } = await resilientInsert(mod.table, payload as Record<string, unknown>);
        if (!offline) notify.success(`✓ MD Sir Deposit সংরক্ষিত (Vendor Advance +৳${amt.toLocaleString()}, Cash অপরিবর্তিত)`, {
          meta: { vendor: String(payTarget), service: "MD Sir Deposit (Vendor Advance)", refId: ledgerId, amount: amt },
        });
        setPayOpen(false);
        void load();
        return;
      }

      // ---------- Advance Payment (no booking allocation) ----------
      if (payAsAdvance && !payRow) {
        const amt = Number(payAmount);
        if (!amt || amt <= 0) return toast.error("সঠিক টাকার পরিমাণ দিন");
        const ledgerId = await generateNextId({
          key: mod.key, label: "", short: "", table: mod.table,
          idColumn: mod.idColumn, idPrefix: isAgency ? "AGL" : "VDL",
          monthlyId: true, fields: [],
        });
        const payload: Record<string, unknown> = {
          [mod.idColumn]: ledgerId,
          entry_date: payDate,
          [groupField]: payTarget,
          service_type: "ADVANCE",
          [billCol]: 0,
          [paidCol]: amt,
          payment_method: payMethod,
          remarks: `Advance ${isAgency ? "Received" : "Paid"} · ${payMethod}${payRemarks ? " · " + payRemarks : ""}`,
          created_by: user?.id ?? null,
        };
        if (isAgency) payload.received_by = user?.id ?? null;
        const { offline } = await resilientInsert(mod.table, payload as Record<string, unknown>);
        if (!offline) {
          await writeCashMirror(amt, ledgerId, `ADVANCE=${amt}`);
          notify.success(`✓ Advance ${isAgency ? "গ্রহণ" : "পরিশোধ"} সংরক্ষিত: ${amt.toLocaleString()}`, {
            meta: { vendor: String(payTarget), service: isAgency ? "Agent Advance Received" : "Vendor Advance Paid", refId: ledgerId, amount: amt },
          });
        }
        setPayOpen(false);
        void load();
        return;
      }

      // ---------- Passenger-specific (single row) ----------
      if (payRow) {
        const amt = Number(payAmount);
        if (!amt || amt <= 0) return toast.error("সঠিক টাকার পরিমাণ দিন");
        if (amt > payDue + 0.001)
          return toast.error(`এই যাত্রীর Due-এর চেয়ে বেশি দেওয়া যাবে না (Due: ${payDue})`);
        await applyAllocationToRow(payRow, amt);
        await writeCashMirror(amt, String(payRow[mod.idColumn] ?? ""),
          `${String(payRow[mod.idColumn] ?? "")}=${amt}`);
        notify.success(`✓ পেমেন্ট সংরক্ষিত: ${amt.toLocaleString()}`, {
          meta: {
            vendor: String(payTarget),
            service: String(payRow.service_type ?? (isAgency ? "Agent Receipt" : "Vendor Payment")),
            passenger: String(payRow.passenger_name ?? ""),
            refId: String(payRow[mod.idColumn] ?? ""),
            amount: amt,
          },
        });
        setPayOpen(false);
        setPayRow(null);
        void load();
        return;
      }

      // ---------- Bulk: Bill-by-Bill (specific) ----------
      if (payMode === "specific") {
        const entries = Object.entries(selectedLines)
          .map(([id, v]) => ({ id, amt: Number(v) || 0 }))
          .filter((e) => e.amt > 0);
        if (entries.length === 0) return toast.error("কমপক্ষে একটি বিল নির্বাচন করুন");
        const rowById = new Map(rows.map((r) => [r.id, r]));
        // validate
        for (const e of entries) {
          const r = rowById.get(e.id);
          if (!r) return toast.error("বিল খুঁজে পাওয়া যায়নি");
          const due = advanceAdjustedRows.get(r.id)?.displayDue ?? Math.max(balanceOf(r), 0);
          if (e.amt > due + 0.001)
            return toast.error(
              `${String(r[mod.idColumn] ?? "")} — Due-এর চেয়ে বেশি দেওয়া যাবে না (Due: ${due})`,
            );
        }
        let total = 0;
        const parts: string[] = [];
        for (const e of entries) {
          const r = rowById.get(e.id)!;
          await applyAllocationToRow(r, e.amt);
          total += e.amt;
          parts.push(`${String(r[mod.idColumn] ?? "")}=${e.amt}`);
        }
        await writeCashMirror(total, parts[0]?.split("=")[0] ?? payTarget, parts.join(", "));
        notify.success(`✓ ${entries.length}টি বিলে পেমেন্ট সংরক্ষিত: ${total.toLocaleString()}`, {
          meta: {
            vendor: String(payTarget),
            service: `${isAgency ? "Agent Receipt" : "Vendor Payment"} (${entries.length} bills)`,
            refId: parts.map((p) => p.split("=")[0]).join(", "),
            amount: total,
          },
        });
        setPayOpen(false);
        void load();
        return;
      }

      // ---------- Bulk: Auto FIFO ----------
      const amt = Number(payAmount);
      if (!amt || amt <= 0) return toast.error("সঠিক টাকার পরিমাণ দিন");
      const list = openBookingsFor(payTarget);
      const totalDue = list.reduce(
        (s, r) => s + (advanceAdjustedRows.get(r.id)?.displayDue ?? Math.max(balanceOf(r), 0)),
        0,
      );
      if (amt > totalDue + 0.001)
        return toast.error(`Total Due-এর চেয়ে বেশি দেওয়া যাবে না (Due: ${totalDue})`);
      if (list.length === 0) return toast.error("কোনো অপরিশোধিত বিল নেই");

      let remaining = amt;
      const parts: string[] = [];
      for (const r of list) {
        if (remaining <= 0.0001) break;
        const due = advanceAdjustedRows.get(r.id)?.displayDue ?? Math.max(balanceOf(r), 0);
        const take = Math.min(remaining, due);
        if (take <= 0) continue;
        await applyAllocationToRow(r, take);
        remaining -= take;
        parts.push(`${String(r[mod.idColumn] ?? "")}=${take}`);
      }
      await writeCashMirror(amt, parts[0]?.split("=")[0] ?? payTarget, parts.join(", "));
      notify.success(`✓ FIFO পেমেন্ট সংরক্ষিত: ${amt.toLocaleString()} (${parts.length}টি বিল)`, {
        meta: {
          vendor: String(payTarget),
          service: `${isAgency ? "Agent Receipt" : "Vendor Payment"} (FIFO, ${parts.length} bills)`,
          refId: parts.map((p) => p.split("=")[0]).join(", "),
          amount: amt,
        },
      });
      setPayOpen(false);
      void load();
    } catch (e) {
      toast.error("সমস্যা: " + errMsg(e));
    } finally {
      setPaySaving(false);
    }
  };

  const submit = async () => {
    if (saving) return; // Prevent double-submit race
    // Mandatory-field validation (e.g. Vendor/Agent name, Payment Method)
    for (const fld of mod.fields) {
      if (!fld.required) continue;
      const v = form[fld.name];
      const empty = v === null || v === undefined || (typeof v === "string" && v.trim() === "");
      if (empty) {
        toast.error(`⚠ আবশ্যিক: "${fld.label}" পূরণ করুন`);
        return;
      }
    }
    // Capture edit state at submit-time to guarantee Update vs Insert routing
    const editRow = editing;
    const editId = editRow?.id;
    const isEdit = !!editId;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const field of mod.fields) {
        const v = form[field.name];
        if (field.type === "number") payload[field.name] = Number(v) || 0;
        else if (field.type === "boolean") payload[field.name] = Boolean(v);
        else if (field.type === "date") payload[field.name] = v ? v : null;
        else payload[field.name] = v ?? null;
      }
      if (user?.id && !isEdit) (payload as Record<string, unknown>).created_by = user.id;

      const finalId = !isEdit ? await generateNextId(mod) : undefined;
      if (finalId) (payload as Record<string, unknown>)[mod.idColumn] = finalId;

      if (isEdit && editId) {
        // STRICT: existing row — UPDATE only, never insert
        const { error } = await supabase
          .from(mod.table as never)
          .update(payload as never)
          .eq("id", editId);
        if (error) throw error;
        toast.success("আপডেট হয়েছে");
      } else {
        // No id → INSERT new
        const { offline } = await resilientInsert(mod.table, payload as Record<string, unknown>);
        if (!offline) toast.success(`✓ যোগ হয়েছে: ${finalId}`);
      }
      setOpenForm(false);
      setEditing(null);
      void load();
    } catch (e) {
      toast.error("সমস্যা: " + errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteRow) return;
    const { error } = await supabase
      .from(mod.table as never)
      .delete()
      .eq("id", deleteRow.id);
    if (error) toast.error("ডিলিট সমস্যা: " + error.message);
    else {
      toast.success("ডিলিট হয়েছে");
      await load();
    }
    setDeleteRow(null);
  };

  // ---- export ----
  const exportCsv = () => {
    const headers = [
      mod.idColumn,
      "entry_date",
      groupField,
      "passenger_name",
      "service_type",
      "country_route",
      billCol,
      paidCol,
      "balance_due",
      "remarks",
    ];
    const lines = [headers.join(",")];
    for (const r of filtered) {
      const adjusted = advanceAdjustedRows.get(r.id);
      const paid = adjusted?.displayPaid ?? Number(r[paidCol] ?? 0);
      const due = adjusted?.displayDue ?? Math.max(balanceOf(r), 0);
      const vals = [
        r[mod.idColumn],
        r.entry_date,
        r[groupField],
        r.passenger_name,
        r.service_type,
        r.country_route,
        r[billCol],
        paid,
        due,
        r.remarks,
      ].map((v) => {
        const s = String(v ?? "");
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      });
      lines.push(vals.join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${mod.key}-${todayIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printPage = () => {
    const w = window.open("", "_blank", "width=1000,height=700");
    if (!w) {
      toast.error("পপ-আপ ব্লক হয়েছে");
      return;
    }
    const heading = isAgency
      ? "সাব এজেন্সি হিসাব - এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্"
      : "Vendor Ledger - এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্";
    const periodLabel =
      startDate || endDate ? `${startDate || "শুরু"} → ${endDate || "এখন"}` : "সকল তারিখ";
    const fmt = (n: number) => Number(n || 0).toLocaleString();
    const rowsHtml = filtered
      .map((r, i) => {
        const bill = Number(r[billCol] ?? 0);
        const adjusted = advanceAdjustedRows.get(r.id);
        const paid = adjusted?.displayPaid ?? Number(r[paidCol] ?? 0);
        const due = adjusted?.displayDue ?? Math.max(bill - Number(r[paidCol] ?? 0) - discountOf(r), 0);
        const srcId = String(r.source_id ?? "");
        const service = String(r.service_type ?? "");
        const svcU = service.toUpperCase();
        const isTicket = svcU.includes("TICKET");
        const isBmet = svcU.includes("BMET");
        const isVisa = svcU.includes("VISA");
        let cr = String(r.country_route ?? "");
        if (!cr && srcId) {
          if (isTicket) cr = ticketRouteMap.get(srcId) ?? "";
          else if (isBmet) cr = bmetCountryMap.get(srcId) ?? "";
          else if (isVisa) cr = visaCountryMap.get(srcId) ?? "";
        }
        const passenger = String(r.passenger_name ?? "—");
        const agent = String(r[groupField] ?? "—");
        const dueCell =
          due > 0
            ? `<span style="color:#dc2626;font-weight:700">${fmt(due)}</span>`
            : `<span style="color:#059669">Paid</span>`;
        return `<tr>
<td>${i + 1}</td>
<td>${formatDate(r.entry_date as string | null)}<div style="font-size:10px;color:#666">${String(r[mod.idColumn] ?? "")}</div></td>
<td>${passenger}</td>
<td>${service || "—"}${cr ? `<div style="font-size:10px;color:#666">${cr}</div>` : ""}</td>
<td>${agent}</td>
<td class="num">${fmt(bill)}</td>
<td class="num">${fmt(paid)}</td>
<td class="num">${dueCell}</td>
</tr>`;
      })
      .join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${heading}</title>
<style>
  body{font-family:'Noto Sans Bengali',system-ui,sans-serif;padding:24px;color:#111}
  h1{margin:0 0 4px;font-size:20px}
  .meta{color:#555;font-size:12px;margin-bottom:14px}
  .summary{display:flex;gap:12px;margin-bottom:14px;font-size:14px;font-weight:700}
  .summary div{padding:8px 12px;border:1px solid #ddd;border-radius:6px;flex:1}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border-bottom:1px solid #e5e5e5;padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#f5f5f5;font-weight:600}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  tfoot td{font-weight:700;background:#fafafa}
  @media print{body{padding:8px}}
</style></head><body>
<h1>${heading}</h1>
<div class="meta">${periodLabel} · মোট ${filtered.length} এন্ট্রি</div>
<div class="summary">
  <div>${billLabel}: <b>৳ ${fmt(totals.bill)}</b></div>
  <div style="color:#059669">${paidLabel}: <b>৳ ${fmt(totals.paid)}</b></div>
  <div style="color:#dc2626">Total Due: <b>৳ ${fmt(totals.due)}</b></div>
</div>
<table>
<thead><tr>
<th>#</th><th>Date / ID</th><th>Passenger</th><th>Service</th><th>${groupLabel}</th>
<th class="num">${billLabel}</th><th class="num">${paidLabel}</th><th class="num">Due</th>
</tr></thead>
<tbody>${rowsHtml}</tbody>
<tfoot><tr><td colspan="5">Total</td><td class="num">${fmt(totals.bill)}</td><td class="num">${fmt(totals.paid)}</td><td class="num">${fmt(totals.due)}</td></tr></tfoot>
</table>
<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script>
</body></html>`);
    w.document.close();
  };

  const resetFilters = () => {
    setSearch("");
    setGroupFilter("all");
    setServiceFilter("all");
    setDueOnly(false);
    setStartDate("");
    setEndDate("");
    setLatestInput("");
  };

  return (
    <div className="space-y-4 print:space-y-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold">{mod.label}</h1>
          <p className="text-sm text-muted-foreground">মোট {rows.length} এন্ট্রি</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button onClick={startCreate} className="gap-1.5">
            <Plus className="h-4 w-4" /> নতুন এন্ট্রি
          </Button>
          <Button onClick={() => openPayment("", 0)} variant="secondary" className="gap-1.5">
            <Receipt className="h-4 w-4" /> {payTitle}
          </Button>
        </div>
      </div>

      {/* Print header */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">Asia Travel — {mod.label}</h1>
        <p className="text-xs text-muted-foreground">
          {startDate || endDate ? `${startDate || "—"} to ${endDate || "—"}` : "All dates"} ·{" "}
          {filtered.length} entries
        </p>
      </div>

      {/* Filter bar — ModulePage-style grid */}
      <Card className="print:hidden">
        <CardContent className="p-3 sm:p-4">
          <div className="space-y-3">
            <div className="flex flex-row flex-nowrap gap-2 items-end w-full">
              <div className="space-y-1.5 flex-1 min-w-0">
                <Label className="text-xs font-medium truncate block">Start Date</Label>
                <DateInput
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-10 text-sm w-full min-w-0"
                />
              </div>
              <div className="space-y-1.5 flex-1 min-w-0">
                <Label className="text-xs font-medium truncate block">End Date</Label>
                <DateInput
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-10 text-sm w-full min-w-0"
                />
              </div>
              <div className="space-y-1.5 flex-1 min-w-0">
                <Label className="text-xs font-medium truncate block">{groupLabel}</Label>
                <Select value={groupFilter} onValueChange={setGroupFilter}>
                  <SelectTrigger className="h-10 text-sm w-full min-w-0">
                    <SelectValue placeholder={`সব ${groupLabel}`} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">সব {groupLabel}</SelectItem>
                    {groupOptions.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 flex-1 min-w-0">
                <Label className="text-xs font-medium truncate block">সার্ভিস মডিউল</Label>
                <Select value={serviceFilter} onValueChange={setServiceFilter}>
                  <SelectTrigger className="h-10 text-sm w-full min-w-0">
                    <SelectValue placeholder="সব সার্ভিস" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">সব সার্ভিস</SelectItem>
                    {serviceOptions.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 flex-1 min-w-0">
                <Label className="text-xs font-medium truncate block">সর্বশেষ N</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={latestInput}
                  disabled={!!(startDate || endDate)}
                  onChange={(e) => setLatestInput(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="N"
                  className="h-10 text-sm tabular-nums disabled:opacity-50 w-full min-w-0"
                />
              </div>
              <div className="space-y-1.5 flex flex-col shrink-0">
                <div className="flex gap-1.5 flex-nowrap">
                  <Button
                    type="button"
                    variant={dueOnly ? "default" : "outline"}
                    onClick={() => setDueOnly((v) => !v)}
                    className="h-10 gap-1.5 px-2 shrink-0"
                    title="শুধু Due"
                  >
                    <Wallet className="h-4 w-4" />
                    <span className="hidden xl:inline whitespace-nowrap">শুধু Due</span>
                  </Button>
                  {(() => {
                    const t = todayIso();
                    const isToday = startDate === t && endDate === t;
                    return (
                      <Button
                        type="button"
                        variant={isToday ? "default" : "secondary"}
                        onClick={() => {
                          if (isToday) { setStartDate(""); setEndDate(""); }
                          else { setStartDate(t); setEndDate(t); }
                        }}
                        className="h-10 gap-1.5 px-2 shrink-0"
                        title="আজকের লেনদেন"
                      >
                        <Wallet className="h-4 w-4" />
                        <span className="hidden xl:inline whitespace-nowrap">আজকের গুলো</span>
                      </Button>
                    );
                  })()}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetFilters}
                    className="h-10 gap-1.5 px-2 shrink-0"
                    title="Reset"
                  >
                    <RotateCcw className="h-4 w-4" />
                    <span className="hidden xl:inline whitespace-nowrap">Reset</span>
                  </Button>
                </div>
              </div>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="খুঁজুন... (নাম, পাসপোর্ট, ID যেকোনো ফিল্ড)"
                className="pl-9 h-11 text-base"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary — ModulePage-style plain boxes */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {billLabel}
              </div>
              <div className="mt-1 text-lg font-bold tabular-nums">
                {totals.bill.toLocaleString()}
              </div>
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {paidLabel}
              </div>
              <div className="mt-1 text-lg font-bold tabular-nums">
                {totals.paid.toLocaleString()}
              </div>
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Total Due
              </div>
              <div
                className={`mt-1 text-lg font-bold tabular-nums ${totals.due > 0 ? "text-rose-500" : ""}`}
              >
                {totals.due.toLocaleString()}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Group summary */}
      {groupSummary.length > 0 && (
        <Card className="print:hidden">
          <CardContent className="p-3 sm:p-4">
            <div className="mb-2">
              <h3 className="text-sm font-semibold">
                {groupLabel} অনুযায়ী Due সারাংশ ({groupSummary.length})
              </h3>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">{groupLabel}</TableHead>
                    <TableHead className="text-right whitespace-nowrap">{billLabel}</TableHead>
                    <TableHead className="text-right whitespace-nowrap">{paidLabel}</TableHead>
                    <TableHead className="text-right whitespace-nowrap">{isAgency ? "Cus:-Due" : "Vendor-Due"}</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Advance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupSummary.map((g, idx) => {
                    const isSelfGroup = g.key.trim().toLowerCase() === "self";
                    return (
                    <TableRow key={g.key} className={`row-tint-${idx % 4}`}>
                      <TableCell className="font-medium">
                        {isSelfGroup ? (
                          <span
                            className="text-left text-muted-foreground"
                            title="Self মানে passenger নিজেই — নিচের রো-তে ক্লিক করে individual passenger profile দেখুন"
                          >
                            {g.key}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setProfileParty(g.key)}
                            className="text-left hover:underline hover:text-primary"
                            title={isAgency ? "Customer profile দেখুন" : "Vendor profile দেখুন"}
                          >
                            {g.key}
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {g.bill.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {g.paid.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {g.due > 0 ? (
                          <button
                            type="button"
                            onClick={() => openPayment(g.key, g.due)}
                            className="inline-flex items-center gap-1 text-rose-500 hover:underline font-semibold tabular-nums rounded-md px-1 outline outline-1 outline-transparent hover:outline-primary hover:bg-primary/10 hover:shadow-md transition-colors"
                            title="পেমেন্ট"
                          >
                            {g.due.toLocaleString()} <Wallet className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                          >
                            Paid
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {g.advance > 0 ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400 font-semibold"
                          >
                            ৳ {g.advance.toLocaleString()}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main ledger entries — Ticket-page style stacked rows */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center justify-between mb-3 print:hidden">
            <h3 className="text-sm font-semibold">
              {mod.label} এন্ট্রি ({filtered.length})
            </h3>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                className="gap-1.5 h-8"
                title="Export CSV"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={printPage}
                className="gap-1.5 h-8"
                title="Print / Save PDF"
              >
                <Printer className="h-3.5 w-3.5" /> Print
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto -mx-2 px-2">
            <div className="space-y-2 min-w-[860px]">
              <div className="grid grid-cols-[1.05fr_1.35fr_1.35fr_1fr_1fr_auto] gap-4 px-4 py-2 text-xs font-semibold text-muted-foreground border-b border-border/60">
                <div>Date / ID</div>
                <div>Passenger</div>
                <div>Service</div>
                <div>{groupLabel}</div>
                <div className="text-right">Amount</div>
                <div className="text-right print:hidden">Actions</div>
              </div>
              {loading ? (
                <div className="text-center text-muted-foreground py-8">লোড হচ্ছে...</div>
              ) : filtered.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  কোনো এন্ট্রি পাওয়া যায়নি
                </div>
              ) : (
                filtered.map((r, idx) => {
                  const bal = balanceOf(r);
                  const passenger = String(r.passenger_name ?? "");
                  const service = String(r.service_type ?? "");
                  let cr = String(r.country_route ?? "");
                  const remarks = String(r.remarks ?? "");
                  const svcUpper = service.toUpperCase();
                  const svcLower = service.toLowerCase();
                  const isTicket = svcUpper.includes("TICKET") || svcLower === "tickets";
                  const isBmet = svcUpper.includes("BMET") || svcLower === "bmet_cards";
                  const isKuwait =
                    svcLower === "kuwait_visas" ||
                    (svcUpper.includes("KUWAIT") && svcUpper.includes("VISA"));
                  const isSaudi =
                    svcLower === "saudi_visas" ||
                    (svcUpper.includes("SAUDI") && svcUpper.includes("VISA"));
                  const isVisa = svcUpper.includes("VISA") || isKuwait || isSaudi;
                  const isPayment = svcUpper === "PAYMENT";
                  const srcId = String(r.source_id ?? "");
                  const info = srcId ? sourceInfoMap.get(srcId) : undefined;
                  if (!cr && srcId) {
                    if (isTicket) cr = ticketRouteMap.get(srcId) ?? "";
                    else if (isBmet) cr = bmetCountryMap.get(srcId) ?? "";
                    else if (isVisa) cr = visaCountryMap.get(srcId) ?? "";
                  }
                  const serviceLabel = isTicket
                    ? "Air Ticket"
                    : isBmet
                      ? "BMET Card"
                      : isKuwait
                        ? "Kuwait Visa"
                        : isSaudi
                          ? "Saudi Visa"
                          : isPayment
                            ? isAgency
                              ? "Payment Received"
                              : "Payment Paid"
                            : service || "—";
                  const ServiceIcon = isTicket
                    ? "✈"
                    : isBmet
                      ? "🪪"
                      : isVisa
                        ? "🌍"
                        : isPayment
                          ? "💵"
                          : "•";
                  const adjusted = advanceAdjustedRows.get(r.id);
                  const displayPaid = adjusted?.displayPaid ?? Number(r[paidCol] ?? 0);
                  const displayDue = adjusted?.displayDue ?? Math.max(bal, 0);
                  const appliedAdvance = adjusted?.applied ?? 0;
                  const flightDateRaw = isTicket && srcId ? ticketFlightMap.get(srcId) : undefined;
                  const flightDate = flightDateRaw ? formatDate(flightDateRaw) : "";
                  const cb = String(r.created_by ?? "");
                  const byName = cb ? profilesMap[cb] : "";
                  const passport = String(r.passport ?? info?.passport ?? "");
                  const mobile = String(r.mobile ?? info?.mobile ?? "");
                  const rowProfit = r.profit;
                  const profit =
                    rowProfit !== undefined && rowProfit !== null && rowProfit !== ""
                      ? Number(rowProfit)
                      : info && typeof info.sold === "number" && typeof info.cost === "number"
                        ? info.sold - Number(info.discount ?? 0) - info.cost
                        : 0;
                  const status = info?.status ?? "";
                  return (
                    <div
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => void openProfileFor(r)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void openProfileFor(r);
                        }
                      }}
                      className="grid gap-3 rounded-md border border-border/70 bg-card/80 p-4 shadow-sm grid-cols-[1.05fr_1.35fr_1.35fr_1fr_1fr_auto] items-start cursor-pointer hover:border-primary/60 hover:shadow-md transition-colors"
                      title={isAgency ? "Customer profile খুলুন" : "Vendor profile খুলুন"}
                      style={{ background: "var(--gradient-card)" }}
                    >
                      <div className="min-w-0">
                        <div className="hidden text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                          Date / ID
                        </div>
                        <div className="font-bold whitespace-nowrap">
                          {formatDate(r.entry_date as string | null)}
                        </div>
                        <div className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">
                          {String(r[mod.idColumn] ?? "")}
                        </div>
                        {status && (
                          <Badge
                            variant="outline"
                            className={cn("mt-1 text-[10px] whitespace-nowrap", statusBadgeClass(status))}
                          >
                            {status}
                          </Badge>
                        )}
                        {byName && (
                          <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                            by {byName}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="hidden text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                          Passenger
                        </div>
                        <div className="font-bold">{passenger || "—"}</div>
                        {passport && (
                          <div className="text-[11px] text-muted-foreground leading-tight font-mono">
                            PP: {passport}
                          </div>
                        )}
                        {mobile && (
                          <div className="text-[11px] text-muted-foreground leading-tight">
                            📱 {mobile}
                          </div>
                        )}
                        {remarks && (
                          <div className="text-[11px] text-muted-foreground/80 italic truncate max-w-[200px] mt-0.5">
                            {remarks}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="hidden text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                          Service
                        </div>
                        <div className="text-sm font-semibold">{serviceLabel}</div>
                        {cr && (
                          <div className="text-xs text-muted-foreground leading-tight">
                            {cr}
                          </div>
                        )}
                        {info?.airline && (
                          <div className="text-xs text-muted-foreground leading-tight">
                            {info.airline}
                          </div>
                        )}
                        {flightDate && (
                          <div className="text-xs text-muted-foreground leading-tight">
                            ✈ {flightDate}
                          </div>
                        )}
                        {info?.pnr && (
                          <div className="text-xs text-muted-foreground leading-tight">
                            PNR: {info.pnr}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="hidden text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                          {groupLabel}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void openProfileFor(r);
                          }}
                          className="font-semibold text-left hover:underline hover:text-primary"
                          title={isAgency ? "Customer profile" : "Vendor profile"}
                        >
                          {String(r[groupField] ?? "—")}
                        </button>
                        {isAgency && info?.vendor && (
                          <div className="text-[11px] text-muted-foreground leading-tight">
                            V: {info.vendor}
                            {typeof info?.cost === "number" && info.cost > 0 && (
                              <span className="tabular-nums"> · ৳{info.cost.toLocaleString()}</span>
                            )}
                          </div>
                        )}
                        {!isAgency && info?.agency_sold && (
                          <div className="text-[11px] text-muted-foreground leading-tight">
                            C: {info.agency_sold}
                            {typeof info?.sold === "number" && info.sold > 0 && (
                              <span className="tabular-nums"> · ৳{info.sold.toLocaleString()}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="tabular-nums whitespace-nowrap text-right">
                        <div className="hidden text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                          Amount
                        </div>
                        <div className="font-bold text-base">
                          ৳ {Number(r[billCol] ?? 0).toLocaleString()}
                        </div>
                        <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                          {isAgency ? "Recv" : "Paid"}: {displayPaid.toLocaleString()}
                        </div>
                        {appliedAdvance > 0 && (
                          <div className="text-[11px] text-muted-foreground">
                            Advance Adjusted: {appliedAdvance.toLocaleString()}
                          </div>
                        )}
                        <div className="text-xs">
                          {displayDue > 0 ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                isAgency ? openPaymentForRow(r, displayDue) : openPayment(String(r[groupField] ?? ""), displayDue);
                              }}
                              className="inline-flex items-center gap-1 text-rose-500 hover:underline font-semibold rounded-md px-1 outline outline-1 outline-transparent hover:outline-primary hover:bg-primary/10 hover:shadow-md transition-colors"
                              title="পেমেন্ট"
                            >
                              {isAgency ? "Cus:-Due" : "Ven:-Due"}: {displayDue.toLocaleString()} <Wallet className="h-3 w-3" />
                            </button>
                          ) : bal >= 0 || appliedAdvance > 0 ? (
                            <Badge
                              variant="outline"
                              className="border-emerald-500/50 text-emerald-600 dark:text-emerald-400 text-[10px]"
                            >
                              Paid
                            </Badge>
                          ) : (
                            <span className="text-amber-500">
                              Adv: {Math.abs(bal).toLocaleString()}
                            </span>
                          )}
                        </div>
                        {displayPaid > 0 && (
                          <div
                            className={cn(
                              "text-[11px] font-medium",
                              profit < 0
                                ? "text-rose-500"
                                : displayDue <= 0 && Number(r[billCol] ?? 0) > 0
                                  ? "text-emerald-400"
                                  : "text-amber-400",
                            )}
                          >
                            Profit: {profit.toLocaleString()}
                          </div>
                        )}
                      </div>
                      <div className="print:hidden">
                        <div className="flex justify-end gap-0.5 lg:justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => { e.stopPropagation(); startEdit(r); }}
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (profile?.role !== "admin") {
                                toast.error("আপনার ডিলিট করার অনুমতি নেই। Admin-এর সাথে যোগাযোগ করুন।");
                                return;
                              }
                              setDeleteRow(r);
                            }}
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Form dialog */}
      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "এডিট করুন" : "নতুন এন্ট্রি"} — {mod.label}
            </DialogTitle>
          </DialogHeader>
          {editing &&
            (() => {
              const srcId = String(editing.source_id ?? "");
              const info = srcId ? sourceInfoMap.get(srcId) : undefined;
              const cb = String(editing.created_by ?? "");
              const byName = cb ? profilesMap[cb] : "";
              const svc = String(editing.service_type ?? "");
              const cr = String(editing.country_route ?? "");
              return (
                <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-xs text-primary font-semibold">
                      {String(editing[mod.idColumn] ?? "")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(editing.entry_date as string | null)}
                    </span>
                    {byName && <span className="text-xs text-muted-foreground">by {byName}</span>}
                  </div>
                  <div className="font-semibold">{String(editing.passenger_name ?? "—")}</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {info?.passport && (
                      <div>
                        <span className="opacity-60">Passport:</span>{" "}
                        <span className="text-foreground font-medium">{info.passport}</span>
                      </div>
                    )}
                    {info?.mobile && (
                      <div>
                        <span className="opacity-60">Mobile:</span>{" "}
                        <span className="text-foreground font-medium">{info.mobile}</span>
                      </div>
                    )}
                    {svc && (
                      <div>
                        <span className="opacity-60">Service:</span>{" "}
                        <span className="text-foreground font-medium">{svc}</span>
                      </div>
                    )}
                    {cr && (
                      <div>
                        <span className="opacity-60">Country/Route:</span>{" "}
                        <span className="text-foreground font-medium">{cr}</span>
                      </div>
                    )}
                    <div>
                      <span className="opacity-60">{groupLabel}:</span>{" "}
                      <span className="text-foreground font-medium">
                        {String(editing[groupField] ?? "—")}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}
          <FormSections mod={formMod} form={form} setForm={setForm} />
          <DialogFooter className="sm:justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setForm(emptyForm(mod));
                toast.success("ফর্ম খালি করা হয়েছে");
              }}
              className="gap-1.5"
            >
              <RotateCcw className="h-4 w-4" /> CLEAR
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpenForm(false)}>
                বাতিল
              </Button>
              <Button onClick={submit} disabled={saving}>
                {saving ? "সেভ হচ্ছে..." : "সেভ"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View dialog */}
      <Dialog open={!!viewRow} onOpenChange={(o) => !o && setViewRow(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>এন্ট্রি বিস্তারিত — {String(viewRow?.[mod.idColumn] ?? "")}</DialogTitle>
          </DialogHeader>
          {viewRow && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              {mod.fields.map((f) => {
                const v = viewRow[f.name];
                const display =
                  f.type === "date"
                    ? formatDate(v as string | null)
                    : f.type === "number"
                      ? Number(v ?? 0).toLocaleString()
                      : String(v ?? "—");
                return (
                  <div key={f.name} className="space-y-0.5">
                    <div className="text-xs text-muted-foreground">{f.label}</div>
                    <div className="font-medium break-words">{display || "—"}</div>
                  </div>
                );
              })}
              <div className="space-y-0.5 col-span-2 pt-2 border-t border-border/60">
                <div className="text-xs text-muted-foreground">Balance Due</div>
                <div
                  className={cn(
                    "text-lg font-bold tabular-nums",
                    balanceOf(viewRow) > 0 ? "text-rose-500" : "text-emerald-600",
                  )}
                >
                  ৳ {balanceOf(viewRow).toLocaleString()}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewRow(null)}>
              বন্ধ করুন
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ডিলিট করবেন?</AlertDialogTitle>
            <AlertDialogDescription>
              এই এন্ট্রিটি ({String(deleteRow?.[mod.idColumn] ?? "")}) মুছে ফেলা হবে।
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>বাতিল</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-rose-600 hover:bg-rose-700">
              ডিলিট
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Payment entry dialog (Receive / Pay) */}
      <Dialog
        open={payOpen}
        onOpenChange={(o) => {
          setPayOpen(o);
          if (!o) setPayRow(null);
        }}
      >
        <DialogContent className={cn(payRow ? "max-w-md" : "max-w-3xl", "max-h-[92vh] overflow-y-auto")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" /> {payTitle}
              {payRow && (
                <span className="text-xs font-normal text-muted-foreground">
                  — যাত্রী-নির্দিষ্ট
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {payRow && (
            <div className="rounded-md border bg-muted/30 p-2.5 text-xs space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-primary font-semibold">
                  {String(payRow[mod.idColumn] ?? "")}
                </span>
                <span className="text-muted-foreground">
                  {formatDate(payRow.entry_date as string | null)}
                </span>
                <span className="text-muted-foreground">
                  {String(payRow.service_type ?? "—")}
                </span>
              </div>
              <div className="font-semibold text-sm text-foreground">
                {String(payRow.passenger_name ?? "—")}
              </div>
              <div className="text-muted-foreground">
                {groupFieldLabel}:{" "}
                <span className="text-foreground font-medium">
                  {String(payRow[groupField] ?? "—")}
                </span>
              </div>
            </div>
          )}

          {/* Shared top fields */}
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Date</Label>
                <DateInput
                  
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Entry By</Label>
                <Input value={displayName(profile, user)} readOnly className="h-10 bg-muted/40" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                {groupFieldLabel} <span className="text-rose-500">*</span>
              </Label>
              {payRow ? (
                <Input value={payTarget} readOnly className="h-10 bg-muted/40 font-semibold" />
              ) : (
                <LookupSelect
                  kind={isAgency ? "sub_agency" : "vendor"}
                  compact
                  value={payTarget}
                  onChange={(v) => {
                    setPayTarget(v);
                    const due = dueForGroup(v);
                    setPayDue(due);
                    setPayAmount(String(due > 0 ? due : ""));
                    setSelectedLines({});
                  }}
                />
              )}
            </div>

            {/* Row-mode: single amount input */}
            {payRow && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">এই যাত্রীর Due</Label>
                  <Input
                    value={payDue.toLocaleString()}
                    readOnly
                    className="h-10 bg-muted/40 tabular-nums font-semibold text-rose-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {payAmountLabel} <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="h-10 text-lg font-semibold tabular-nums"
                    autoFocus
                  />
                </div>
              </div>
            )}

            {/* Mark as Advance Payment toggle (bulk mode only) */}
            {!payRow && payTarget && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2.5">
                <Checkbox
                  id="payAsAdvance"
                  checked={payAsAdvance}
                  onCheckedChange={(c) => {
                    setPayAsAdvance(!!c);
                    if (c) { setPayAmount(""); setSelectedLines({}); setPayAsMdDeposit(false); }
                  }}
                />
                <Label htmlFor="payAsAdvance" className="text-sm font-medium cursor-pointer flex-1">
                  Mark as Advance Payment
                  <span className="block text-[11px] text-muted-foreground font-normal">
                    কোনো বুকিং-এর সাথে যুক্ত না করে advance হিসেবে রাখুন — পরের বুকিং থেকে auto adjust হবে
                  </span>
                </Label>
              </div>
            )}

            {/* Mark as Vendor Deposit From MD Sir — vendor ledger only, bulk mode */}
            {!payRow && payTarget && !isAgency && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5">
                <Checkbox
                  id="payAsMdDeposit"
                  checked={payAsMdDeposit}
                  onCheckedChange={(c) => {
                    setPayAsMdDeposit(!!c);
                    if (c) { setPayAmount(""); setSelectedLines({}); setPayAsAdvance(false); }
                  }}
                />
                <Label htmlFor="payAsMdDeposit" className="text-sm font-medium cursor-pointer flex-1">
                  Mark as Vendor Deposit From MD Sir
                  <span className="block text-[11px] text-muted-foreground font-normal">
                    টিকেটিং পোর্টাল এ Deposit করুন। যা লেজারের বাহিরের টাকা। User এর ব্যালেঞ্জ অপরিবর্তিত থাকবে।
                  </span>
                </Label>
              </div>
            )}

            {/* Advance amount input (when advance OR MD deposit toggle ON) */}
            {!payRow && payTarget && (payAsAdvance || payAsMdDeposit) && (
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {payAsMdDeposit ? "MD Sir Deposit Amount" : "Advance Amount"} <span className="text-rose-500">*</span>
                </Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="h-10 text-lg font-semibold tabular-nums"
                  autoFocus
                />
              </div>
            )}

            {/* Bulk-mode: Tabs (Auto-FIFO / Bill-by-Bill) — hidden when paying advance/MD deposit */}
            {!payRow && payTarget && !payAsAdvance && !payAsMdDeposit && (
              <Tabs value={payMode} onValueChange={(v) => setPayMode(v as "fifo" | "specific")}>
                <TabsList className="grid grid-cols-2 w-full">
                  <TabsTrigger value="fifo">Auto FIFO (পুরাতন → নতুন)</TabsTrigger>
                  <TabsTrigger value="specific">Bill-by-Bill (নির্দিষ্ট)</TabsTrigger>
                </TabsList>

                <TabsContent value="fifo" className="space-y-3 pt-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Total Outstanding</Label>
                      <Input
                        value={payDue.toLocaleString()}
                        readOnly
                        className="h-10 bg-muted/40 tabular-nums font-semibold text-rose-500"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        {payAmountLabel} <span className="text-rose-500">*</span>
                      </Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                        className="h-10 text-lg font-semibold tabular-nums"
                        autoFocus
                      />
                    </div>
                  </div>
                  {fifoPreview.length > 0 && (
                    <div className="rounded-md border max-h-[40vh] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Date / ID</TableHead>
                            <TableHead className="text-xs">Passenger</TableHead>
                            <TableHead className="text-right text-xs">Due / বাকি</TableHead>
                            <TableHead className="text-right text-xs">Paying Now / এখন দিচ্ছি</TableHead>
                            <TableHead className="text-right text-xs">Remaining / অবশিষ্ট</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {fifoPreview.map(({ row, alloc, due }, idx) => (
                            <TableRow
                              key={row.id}
                              className={alloc > 0 ? `row-tint-${idx % 4}` : `row-tint-${idx % 4} opacity-40`}
                            >
                              <TableCell className="text-xs">
                                <div>{formatDate(row.entry_date as string | null)}</div>
                                <div className="font-mono text-[10px] text-muted-foreground">
                                  {String(row[mod.idColumn] ?? "")}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs">
                                {String(row.passenger_name ?? "—")}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs">
                                {due.toLocaleString()}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs font-semibold text-emerald-600">
                                {alloc > 0 ? alloc.toLocaleString() : "—"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs">
                                {alloc >= due ? (
                                  <Badge variant="outline" className="border-emerald-500/50 text-emerald-600 text-[10px]">✓ Cleared</Badge>
                                ) : alloc > 0 ? (
                                  <span className="text-amber-600 font-semibold">৳ {(due - alloc).toLocaleString()} due</span>
                                ) : (
                                  <span className="text-rose-500">৳ {due.toLocaleString()} due</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="specific" className="space-y-3 pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      নির্দিষ্ট বিল বাছাই করুন এবং পরিমাণ এডিট করুন
                    </span>
                    <span className="font-semibold tabular-nums">
                      মোট: {specificTotal.toLocaleString()}
                    </span>
                  </div>
                  <div className="rounded-md border max-h-[50vh] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8"></TableHead>
                          <TableHead className="text-xs">Date / ID</TableHead>
                          <TableHead className="text-xs">Passenger</TableHead>
                          <TableHead className="text-right text-xs">Due / বাকি</TableHead>
                          <TableHead className="text-right text-xs w-32">Paying Now / এখন দিচ্ছি</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {openBookingsFor(payTarget).map((r, idx) => {
                          const due = advanceAdjustedRows.get(r.id)?.displayDue ?? Math.max(balanceOf(r), 0);
                          const checked = r.id in selectedLines;
                          return (
                            <TableRow key={r.id} className={`row-tint-${idx % 4}`}>
                              <TableCell>
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(c) => {
                                    setSelectedLines((prev) => {
                                      const next = { ...prev };
                                      if (c) next[r.id] = String(due);
                                      else delete next[r.id];
                                      return next;
                                    });
                                  }}
                                />
                              </TableCell>
                              <TableCell className="text-xs">
                                <div>{formatDate(r.entry_date as string | null)}</div>
                                <div className="font-mono text-[10px] text-muted-foreground">
                                  {String(r[mod.idColumn] ?? "")}
                                </div>
                              </TableCell>
                              <TableCell className="text-xs">
                                {String(r.passenger_name ?? "—")}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs">
                                {due.toLocaleString()}
                              </TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  disabled={!checked}
                                  value={selectedLines[r.id] ?? ""}
                                  onChange={(e) =>
                                    setSelectedLines((prev) => ({ ...prev, [r.id]: e.target.value }))
                                  }
                                  className="h-8 text-right tabular-nums"
                                  max={due}
                                />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {openBookingsFor(payTarget).length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-6">
                              কোনো অপরিশোধিত বিল নেই
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Payment Method <span className="text-rose-500">*</span>
                </Label>
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="-- Method --" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Remarks</Label>
                <Input
                  value={payRemarks}
                  onChange={(e) => setPayRemarks(e.target.value)}
                  placeholder="মন্তব্য (ঐচ্ছিক)"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              বাতিল
            </Button>
            <Button
              onClick={submitPayment}
              disabled={paySaving}
              className="bg-emerald-600 hover:bg-emerald-700 gap-2"
            >
              <Wallet className="h-4 w-4" />{" "}
              {paySaving
                ? "সেভ হচ্ছে..."
                : !payRow && payMode === "specific"
                  ? `সংরক্ষণ (${specificTotal.toLocaleString()})`
                  : "সংরক্ষণ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PartyProfileDrawer
        open={!!profileParty}
        onOpenChange={(o) => !o && setProfileParty(null)}
        kind={isAgency ? "customer" : "vendor"}
        partyName={profileParty}
      />

      <PassengerProfileDrawer
        open={!!passengerProfile}
        onOpenChange={(v) => { if (!v) setPassengerProfile(null); }}
        row={passengerProfile?.row ?? null}
        serviceTable={passengerProfile?.serviceTable ?? ""}
        moduleKey={passengerProfile?.moduleKey}
        statusOrder={passengerProfile?.statusOrder}
      />
    </div>
  );
}
