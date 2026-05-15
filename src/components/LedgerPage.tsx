import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { generateNextId } from "@/lib/idgen";
import { formatDate, statusBadgeClass, type ModuleSchema, type Field } from "@/lib/modules";
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
import { useCurrentUser, displayName } from "@/hooks/useCurrentUser";
import { FormSections } from "@/components/ModulePage";
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
    else f[field.name] = "";
  }
  return f;
}

function selectColumns(mod: ModuleSchema): string {
  const cols = new Set(["id", mod.idColumn, "created_at", "created_by"]);
  if (mod.key === "agency-ledger" || mod.key === "vendor-ledger") {
    cols.add("source_id");
    cols.add("source_table");
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
        sold?: number;
        cost?: number;
        status?: string;
        airline?: string;
        pnr?: string;
      }
    >
  >(new Map());
  const [profilesMap, setProfilesMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
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
  const cacheKey = `cache_v4_${mod.table}`;
  const columns = useMemo(() => selectColumns(mod), [mod]);

  const groupField = mod.groupBy?.field ?? "agent_name";
  const groupLabel = mod.groupBy?.label ?? "Agent";
  const isAgency = mod.key === "agency-ledger";
  const billCol = isAgency ? "total_bill" : "total_payable";
  const paidCol = isAgency ? "received_amount" : "paid_amount";
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
  useEffect(() => {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const cached = JSON.parse(raw) as Row[];
        if (Array.isArray(cached)) {
          setRows(cached);
          setLoading(false);
        }
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mod.table]);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const { data, error } = await supabase
        .from(mod.table as never)
        .select(columns)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const list = (data as unknown as Row[]) ?? [];
      setRows(list);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(list));
      } catch {
        /* ignore */
      }
    } catch (e) {
      toast.error("লোড সমস্যা: " + errMsg(e));
    }
    loadingRef.current = false;
    setLoading(false);
  }, [mod.table, columns, cacheKey]);

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
            "id,flight_date,trip_road,passport,mobile,vendor_bought,sold_price,cost_price,status,airline,pnr",
          )
          .limit(2000),
        supabase
          .from("bmet_cards")
          .select("id,country_name,passport,mobile,vendor_bought,sold_price,cost_price,status")
          .limit(2000),
        supabase
          .from("kuwait_visas")
          .select("id,passport,mobile,vendor_bought,sold_price,cost_price,status")
          .limit(2000),
        supabase
          .from("saudi_visas")
          .select("id,passport,mobile,vendor_bought,sold_price,cost_price,status")
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
          sold?: number;
          cost?: number;
          status?: string;
          airline?: string;
          pnr?: string;
        }
      >();
      type T = {
        id: string;
        flight_date: string | null;
        trip_road: string | null;
        passport: string | null;
        mobile: string | null;
        vendor_bought: string | null;
        sold_price: number | null;
        cost_price: number | null;
        status: string | null;
        airline: string | null;
        pnr: string | null;
      };
      for (const t of (tk.data as unknown as T[]) ?? []) {
        if (t.flight_date) fm.set(t.id, t.flight_date);
        if (t.trip_road) rm.set(t.id, t.trip_road);
        info.set(t.id, {
          passport: t.passport ?? undefined,
          mobile: t.mobile ?? undefined,
          vendor: t.vendor_bought ?? undefined,
          sold: t.sold_price ?? undefined,
          cost: t.cost_price ?? undefined,
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
        sold_price: number | null;
        cost_price: number | null;
        status: string | null;
      };
      for (const b of (bm.data as unknown as B[]) ?? []) {
        if (b.country_name) cm.set(b.id, b.country_name);
        info.set(b.id, {
          passport: b.passport ?? undefined,
          mobile: b.mobile ?? undefined,
          vendor: b.vendor_bought ?? undefined,
          sold: b.sold_price ?? undefined,
          cost: b.cost_price ?? undefined,
          status: b.status ?? undefined,
        });
      }
      const vm = new Map<string, string>();
      type V = {
        id: string;
        passport: string | null;
        mobile: string | null;
        vendor_bought: string | null;
        sold_price: number | null;
        cost_price: number | null;
        status: string | null;
      };
      for (const v of (kv.data as unknown as V[]) ?? []) {
        vm.set(v.id, "Kuwait");
        info.set(v.id, {
          passport: v.passport ?? undefined,
          mobile: v.mobile ?? undefined,
          vendor: v.vendor_bought ?? undefined,
          sold: v.sold_price ?? undefined,
          cost: v.cost_price ?? undefined,
          status: v.status ?? undefined,
        });
      }
      for (const v of (sv.data as unknown as V[]) ?? []) {
        vm.set(v.id, "Saudi Arabia");
        info.set(v.id, {
          passport: v.passport ?? undefined,
          mobile: v.mobile ?? undefined,
          vendor: v.vendor_bought ?? undefined,
          sold: v.sold_price ?? undefined,
          cost: v.cost_price ?? undefined,
          status: v.status ?? undefined,
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

  const balanceOf = (r: Row) => Number(r[billCol] ?? 0) - Number(r[paidCol] ?? 0);

  // Net due per group across ALL rows — payments offset bills.
  const dueByGroup = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = String(r[groupField] ?? "");
      m.set(k, (m.get(k) ?? 0) + Number(r[billCol] ?? 0) - Number(r[paidCol] ?? 0));
    }
    return m;
  }, [rows, groupField, billCol, paidCol]);



  const filtered = useMemo(() => {
    let xs = rows;
    if (groupFilter !== "all") xs = xs.filter((r) => String(r[groupField] ?? "") === groupFilter);
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
  }, [rows, groupFilter, dueOnly, startDate, endDate, search, latestInput, dueByGroup]);

  const totals = useMemo(() => {
    let bill = 0,
      paid = 0;
    for (const r of filtered) {
      bill += Number(r[billCol] ?? 0);
      paid += Number(r[paidCol] ?? 0);
    }
    return { bill, paid, due: bill - paid };
  }, [filtered, billCol, paidCol]);

  const groupSummary = useMemo(() => {
    const map = new Map<string, { bill: number; paid: number }>();
    for (const r of filtered) {
      const k = String(r[groupField] ?? "—") || "—";
      const cur = map.get(k) ?? { bill: 0, paid: 0 };
      cur.bill += Number(r[billCol] ?? 0);
      cur.paid += Number(r[paidCol] ?? 0);
      map.set(k, cur);
    }
    return Array.from(map.entries())
      .map(([key, v]) => ({ key, bill: v.bill, paid: v.paid, due: v.bill - v.paid }))
      .sort((a, b) => b.due - a.due);
  }, [filtered, groupField, billCol, paidCol]);

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

  // Compute outstanding for any group key from ALL rows (not filtered).
  const dueForGroup = useCallback(
    (key: string) => {
      if (!key) return 0;
      let bill = 0,
        paid = 0;
      for (const r of rows) {
        if (String(r[groupField] ?? "") !== key) continue;
        bill += Number(r[billCol] ?? 0);
        paid += Number(r[paidCol] ?? 0);
      }
      return bill - paid;
    },
    [rows, groupField, billCol, paidCol],
  );

  const openPayment = (groupKey: string, dueAmount: number) => {
    const due = groupKey ? dueForGroup(groupKey) : dueAmount;
    setPayTarget(groupKey);
    setPayDue(due);
    setPayAmount(String(due > 0 ? due : ""));
    setPayDate(todayIso());
    setPayRemarks("");
    setPayMethod("Cash");
    setPayOpen(true);
  };

  const submitPayment = async () => {
    const amt = Number(payAmount);
    if (!payTarget) return toast.error(`${groupFieldLabel} নির্বাচন করুন`);
    if (!amt || amt <= 0) return toast.error("সঠিক টাকার পরিমাণ দিন");
    setPaySaving(true);
    try {
      const me = displayName(profile, user);
      const finalId = await generateNextId(mod);
      const payload: Record<string, unknown> = {
        [mod.idColumn]: finalId,
        entry_date: payDate,
        [groupField]: payTarget,
        passenger_name: isAgency ? "পেমেন্ট গ্রহণ" : "পেমেন্ট পরিশোধ",
        service_type: "PAYMENT",
        country_route: "",
        [billCol]: 0,
        [paidCol]: amt,
        passport: "",
        mobile: "",
        profit: 0,
        remarks: `Method: ${payMethod}${payRemarks ? " · " + payRemarks : ""} · Entry by: ${me}`,
      };
      if (user?.id) payload.created_by = user.id;
      const { error } = await supabase.from(mod.table as never).insert(payload as never);
      if (error) throw error;

      // Mirror to My Accounts so the cash drawer & reports stay in sync.
      if (user?.id) {
        if (isAgency) {
          // Agency receive — money in to the user
          const rid = await generateNextId({
            key: "_rcpt",
            label: "",
            short: "",
            table: "payment_receipts",
            idColumn: "receipt_id",
            idPrefix: "RCPT",
            monthlyId: true,
            fields: [],
          });
          const { error: e2 } = await supabase.from("payment_receipts").insert({
            receipt_id: rid,
            entry_date: payDate,
            service_type: "Agency Receive",
            ref_id: finalId,
            passenger_name: payTarget,
            amount: amt,
            method: payMethod,
            source: "agency_ledger",
            remarks: payRemarks || null,
            received_by: user.id,
            received_by_name: me,
            created_by: user.id,
          } as never);
          if (e2) console.warn("payment_receipts mirror failed:", e2);
        } else {
          // Vendor pay — money out from the user
          const eid = await generateNextId({
            key: "_exp",
            label: "",
            short: "",
            table: "cash_expenses",
            idColumn: "expense_id",
            idPrefix: "EXP",
            monthlyId: true,
            fields: [],
          });
          const { error: e2 } = await supabase.from("cash_expenses").insert({
            expense_id: eid,
            entry_date: payDate,
            category: "Vendor Payment",
            purpose: `Vendor: ${payTarget}`,
            amount: amt,
            remarks: `${payMethod}${payRemarks ? " · " + payRemarks : ""} · Ref: ${finalId}`,
            spent_by: user.id,
            spent_by_name: me,
            created_by: user.id,
          } as never);
          if (e2) console.warn("cash_expenses mirror failed:", e2);
        }
      }

      toast.success(`✓ ${payTitle} সংরক্ষিত: ${amt.toLocaleString()}`);
      setPayOpen(false);
      void load();
    } catch (e) {
      toast.error("সমস্যা: " + errMsg(e));
    } finally {
      setPaySaving(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    const payload: Record<string, unknown> = {};
    for (const field of mod.fields) {
      const v = form[field.name];
      if (field.type === "number") payload[field.name] = Number(v) || 0;
      else if (field.type === "boolean") payload[field.name] = Boolean(v);
      else if (field.type === "date") payload[field.name] = v ? v : null;
      else payload[field.name] = v ?? null;
    }
    if (user?.id && !editing) (payload as Record<string, unknown>).created_by = user.id;

    const isEdit = !!editing;
    const editId = editing?.id;
    const finalId = !isEdit ? await generateNextId(mod) : undefined;
    if (finalId) (payload as Record<string, unknown>)[mod.idColumn] = finalId;

    setOpenForm(false);
    setSaving(false);

    try {
      if (isEdit && editId) {
        const { error } = await supabase
          .from(mod.table as never)
          .update(payload as never)
          .eq("id", editId);
        if (error) throw error;
        toast.success("আপডেট হয়েছে");
      } else {
        const { error } = await supabase.from(mod.table as never).insert(payload as never);
        if (error) throw error;
        toast.success(`✓ যোগ হয়েছে: ${finalId}`);
      }
      void load();
    } catch (e) {
      toast.error("সমস্যা: " + errMsg(e));
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
      const bal = balanceOf(r);
      const vals = [
        r[mod.idColumn],
        r.entry_date,
        r[groupField],
        r.passenger_name,
        r.service_type,
        r.country_route,
        r[billCol],
        r[paidCol],
        bal,
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
        const paid = Number(r[paidCol] ?? 0);
        const due = bill - paid;
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
            : due === 0
              ? `<span style="color:#059669">Paid</span>`
              : `<span style="color:#d97706">Adv ${fmt(Math.abs(due))}</span>`;
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
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-10 text-base"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">End Date</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-10 text-base"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">{groupLabel}</Label>
                <Select value={groupFilter} onValueChange={setGroupFilter}>
                  <SelectTrigger className="h-10 text-base">
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
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">সর্বশেষ N</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={latestInput}
                  disabled={!!(startDate || endDate)}
                  onChange={(e) => setLatestInput(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="যেমন: 5"
                  className="h-10 text-base tabular-nums disabled:opacity-50"
                />
              </div>
              <div className="space-y-1.5 flex flex-col col-span-2 sm:col-span-3 lg:col-span-4">
                <Label className="text-sm font-medium opacity-0 hidden sm:block">.</Label>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    type="button"
                    variant={dueOnly ? "default" : "outline"}
                    onClick={() => setDueOnly((v) => !v)}
                    className="h-10 gap-1.5"
                  >
                    <Wallet className="h-4 w-4" /> শুধু Due
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
                        className="h-10 gap-1.5 whitespace-nowrap"
                        title="আজকের লেনদেন"
                      >
                        <Wallet className="h-4 w-4" /> আজকের গুলো
                      </Button>
                    );
                  })()}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetFilters}
                    className="h-10 gap-1.5"
                    title="Reset"
                  >
                    <RotateCcw className="h-4 w-4" /> Reset
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
                    <TableHead className="text-right whitespace-nowrap">Due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupSummary.map((g) => (
                    <TableRow key={g.key}>
                      <TableCell className="font-medium">{g.key}</TableCell>
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
                            className="inline-flex items-center gap-1 text-rose-500 hover:underline font-semibold tabular-nums"
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
                    </TableRow>
                  ))}
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
                filtered.map((r) => {
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
                        ? info.sold - info.cost
                        : 0;
                  const status = info?.status ?? "";
                  const isPending = !!status && /pending|process/i.test(status);
                  return (
                    <div
                      key={r.id}
                      className="grid gap-3 rounded-md border border-border/70 bg-card/80 p-4 shadow-sm grid-cols-[1.05fr_1.35fr_1.35fr_1fr_1fr_auto] items-start"
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
                            className={cn("mt-1 text-[10px]", statusBadgeClass(status))}
                          >
                            {isPending ? "Pending" : status}
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
                        {info?.airline && (
                          <div className="text-xs text-muted-foreground leading-tight">
                            {info.airline}
                            {cr ? ` · ${cr}` : ""}
                          </div>
                        )}
                        {!info?.airline && cr && (
                          <div className="text-xs text-muted-foreground leading-tight">
                            {ServiceIcon} {cr}
                          </div>
                        )}
                        {flightDate && (
                          <div className="text-xs text-muted-foreground leading-tight">
                            ✈ Flight: {flightDate}
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
                        <div className="font-semibold">{String(r[groupField] ?? "—")}</div>
                        {info?.vendor && (
                          <div className="text-[11px] text-muted-foreground leading-tight">
                            V: {info.vendor}
                          </div>
                        )}
                        {typeof info?.cost === "number" && info.cost > 0 && (
                          <div className="text-[10px] text-muted-foreground leading-tight tabular-nums">
                            ৳ {info.cost.toLocaleString()}
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
                          {isAgency ? "Recv" : "Paid"}: {Number(r[paidCol] ?? 0).toLocaleString()}
                        </div>
                        <div className="text-xs">
                          {bal > 0 ? (
                            <button
                              type="button"
                              onClick={() => openPayment(String(r[groupField] ?? ""), bal)}
                              className="inline-flex items-center gap-1 text-rose-500 hover:underline font-semibold"
                              title="পেমেন্ট"
                            >
                              Due: {bal.toLocaleString()} <Wallet className="h-3 w-3" />
                            </button>
                          ) : bal === 0 ? (
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
                        <div
                          className={cn(
                            "text-[11px] font-medium",
                            profit < 0 ? "text-rose-500" : "text-muted-foreground",
                          )}
                        >
                          Profit: {profit.toLocaleString()}
                        </div>
                      </div>
                      <div className="print:hidden">
                        <div className="flex justify-end gap-0.5 lg:justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setViewRow(r)}
                            title="View"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {bal > 0 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-emerald-600"
                              onClick={() => openPayment(String(r[groupField] ?? ""), bal)}
                              title="Quick Pay"
                            >
                              <CreditCard className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => startEdit(r)}
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setDeleteRow(r)}
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenForm(false)}>
              বাতিল
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? "সেভ হচ্ছে..." : "সেভ"}
            </Button>
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
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" /> {payTitle}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
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
              <LookupSelect
                kind={isAgency ? "sub_agency" : "vendor"}
                compact
                value={payTarget}
                onChange={(v) => {
                  setPayTarget(v);
                  const due = dueForGroup(v);
                  setPayDue(due);
                  setPayAmount(String(due > 0 ? due : ""));
                }}
              />
            </div>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              বাতিল
            </Button>
            <Button
              onClick={submitPayment}
              disabled={paySaving}
              className="bg-emerald-600 hover:bg-emerald-700 gap-2"
            >
              <Wallet className="h-4 w-4" /> {paySaving ? "সেভ হচ্ছে..." : "সংরক্ষণ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
