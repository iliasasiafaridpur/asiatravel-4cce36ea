import { DateInput } from "@/components/ui/date-input";
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { MODULES, formatDate } from "@/lib/modules";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LookupSelect } from "@/components/LookupSelect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, Search, Plus, Plane, User, IdCard } from "lucide-react";

export const Route = createFileRoute("/invoice")({
  head: () => ({ meta: [{ title: "Invoice — Asia Tours and Travels" }] }),
  component: InvoicePage,
});

/* ---------------------------------- types --------------------------------- */

interface ServiceEntry {
  module: string;
  moduleKey: string;
  id: string;
  date: string;
  passenger: string;
  passport: string;
  mobile?: string;
  amount: number;
  received: number;
  raw: Record<string, unknown>;
}

// One invoice line. `type` controls which detail fields show + how it prints.
interface InvoiceItem {
  uid: string;
  type: string; // module key or "manual"
  serviceLabel: string; // headline shown in the print row
  airline?: string;
  fromRoute?: string;
  toRoute?: string;
  flightDate?: string;
  pnr?: string;
  country?: string;
  visaType?: string;
  sponsor?: string;
  refNo?: string; // MOFA / Visa No / reference
  detail?: string;
  date?: string;
  qty: number;
  rate: number;
}

const ITEM_TYPES = [
  { key: "manual", label: "Manual / Custom" },
  { key: "tickets", label: "Air Ticket" },
  { key: "bmet", label: "BMET Card" },
  { key: "saudi-visa", label: "Saudi Visa" },
  { key: "kuwait-visa", label: "Kuwait Visa" },
  { key: "other", label: "Other Service" },
];

const AGENCY = {
  name: "ASIA TOURS AND TRAVELS",
  slogan: "Customer satisfaction is our primary goal.",
  address: "Bariplaza 4th Floor, Thana Road, Faridpur",
  phone: "+8801721-399599",
};

const genUid = () => Math.random().toString(36).slice(2, 10);
const str = (v: unknown) => (v == null ? "" : String(v));

function splitRoute(s: string): { from: string; to: string } {
  if (!s) return { from: "", to: "" };
  const parts = s.split(/\s*(?:->|→|–|—|-|\/|to)\s*/i).map((p) => p.trim()).filter(Boolean);
  return { from: parts[0] || s.trim(), to: parts[1] || "" };
}

/* ----------------------- module → invoice item mapper --------------------- */

function buildItemFromEntry(e: ServiceEntry): InvoiceItem {
  const r = e.raw;
  const base: InvoiceItem = {
    uid: genUid(),
    type: e.moduleKey,
    serviceLabel: e.module,
    detail: e.id,
    date: e.date,
    qty: 1,
    rate: e.amount || 0,
  };
  switch (e.moduleKey) {
    case "tickets": {
      const { from, to } = splitRoute(str(r.trip_road));
      return { ...base, serviceLabel: "AIR TICKET", airline: str(r.airline), fromRoute: from, toRoute: to, flightDate: str(r.flight_date), pnr: str(r.pnr), date: str(r.flight_date) || e.date };
    }
    case "bmet":
      return { ...base, serviceLabel: "BMET CARD", country: str(r.country_name), date: str(r.attested_date) || e.date };
    case "saudi-visa":
      return { ...base, serviceLabel: "SAUDI VISA", visaType: str(r.visa_type), sponsor: str(r.sponsor_name), refNo: str(r.mofa_no) || str(r.visa_no) };
    case "kuwait-visa":
      return { ...base, serviceLabel: "KUWAIT VISA", refNo: str(r.visa_no), sponsor: str(r.sponsor_name) };
    case "other": {
      const { from, to } = splitRoute(str(r.trip_road));
      return { ...base, serviceLabel: str(r.service_name) || "OTHER SERVICE", airline: str(r.airline), fromRoute: from, toRoute: to, flightDate: str(r.flight_date) };
    }
    default:
      return base;
  }
}

/* ------------------------ per-item printable detail ----------------------- */

function ItemDetail({ it }: { it: InvoiceItem }) {
  const rows: { label: string; value: string }[] = [];
  const route = (it.fromRoute && it.toRoute)
    ? `${it.fromRoute} → ${it.toRoute}`
    : (it.fromRoute || it.toRoute || "");

  if (it.type === "tickets") {
    if (route) rows.push({ label: "Trip Road", value: route });
    if (it.airline) rows.push({ label: "Airlines", value: it.airline });
    if (it.flightDate) rows.push({ label: "Flight Date", value: formatDate(it.flightDate) });
  } else if (it.type === "bmet") {
    if (it.country) rows.push({ label: "Country", value: it.country });
    if (it.date) rows.push({ label: "Date", value: formatDate(it.date) });
  } else if (it.type === "saudi-visa") {
    if (it.visaType) rows.push({ label: "Visa Type", value: it.visaType });
    if (it.sponsor) rows.push({ label: "Sponsor", value: it.sponsor });
    if (it.refNo) rows.push({ label: "MOFA / Visa No", value: it.refNo });
  } else if (it.type === "kuwait-visa") {
    if (it.refNo) rows.push({ label: "Visa No", value: it.refNo });
    if (it.sponsor) rows.push({ label: "Sponsor", value: it.sponsor });
  } else if (it.type === "other") {
    if (route) rows.push({ label: "Trip Road", value: route });
    if (it.airline) rows.push({ label: "Airlines", value: it.airline });
    if (it.flightDate) rows.push({ label: "Flight Date", value: formatDate(it.flightDate) });
  }
  if (it.detail) rows.push({ label: "Ref", value: it.detail });

  if (rows.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-600">
      {rows.map((r, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <span className="text-slate-400">{r.label}:</span>
          <span className="font-medium text-slate-700">{r.value}</span>
        </span>
      ))}
    </div>
  );
}

/* ------------------------------- the page --------------------------------- */

function InvoicePage() {
  const [allEntries, setAllEntries] = useState<ServiceEntry[]>([]);
  const [search, setSearch] = useState("");

  const [invoiceNo, setInvoiceNo] = useState<string>(
    "INV-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.floor(Math.random() * 900 + 100),
  );
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().slice(0, 10));

  const [bill, setBill] = useState({ name: "", passport: "", nationality: "Bangladeshi", mobile: "" });
  const [items, setItems] = useState<InvoiceItem[]>(() => [
    { uid: genUid(), type: "manual", serviceLabel: "", qty: 1, rate: 0 },
  ]);
  const [received, setReceived] = useState<number>(0);
  const [discount, setDiscount] = useState<number>(0);
  const [notes, setNotes] = useState<string>("");

  const serviceModules = useMemo(
    () => MODULES.filter((m) => !["agents", "vendors", "agency-ledger", "vendor-ledger"].includes(m.key)),
    [],
  );

  useEffect(() => {
    (async () => {
      const all: ServiceEntry[] = [];
      await Promise.all(serviceModules.map(async (m) => {
        const { data } = await supabase.from(m.table as never)
          .select("*").order("created_at", { ascending: false }).limit(300);
        for (const r of ((data as unknown) as Record<string, unknown>[] | null) ?? []) {
          all.push({
            module: m.label,
            moduleKey: m.key,
            id: str(r[m.idColumn]),
            date: str(r.entry_date ?? r.created_at),
            passenger: str(r.passenger_name ?? "—"),
            passport: str(r.passport),
            mobile: str(r.mobile),
            amount: Number(r.sold_price ?? 0),
            received: Number(r.received ?? r.received_amount ?? 0),
            raw: r,
          });
        }
      }));
      setAllEntries(all);
    })();
  }, [serviceModules]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = allEntries;
    if (moduleFilter !== "all") list = list.filter((e) => e.moduleKey === moduleFilter);
    if (q) list = list.filter((e) => `${e.id} ${e.passenger} ${e.passport} ${e.mobile}`.toLowerCase().includes(q));
    else if (moduleFilter === "all") return [];
    return list.slice(0, 30);
  }, [allEntries, search, moduleFilter]);

  const loadEntry = (e: ServiceEntry) => {
    setBill({
      name: e.passenger || "",
      passport: e.passport || "",
      nationality: bill.nationality || "Bangladeshi",
      mobile: e.mobile || "",
    });
    setItems([buildItemFromEntry(e)]);
    setReceived(e.received || 0);
    setSearch("");
    setModuleFilter("all");
  };

  const item: InvoiceItem = items[0] ?? { uid: genUid(), type: "manual", serviceLabel: "", qty: 1, rate: 0 };
  const setItem = (patch: Partial<InvoiceItem>) =>
    setItems((p) => {
      const cur = p[0] ?? { uid: genUid(), type: "manual", serviceLabel: "", qty: 1, rate: 0 };
      return [{ ...cur, ...patch }];
    });

  const subtotal = items.reduce((s, i) => s + i.qty * i.rate, 0);
  const grandTotal = Math.max(0, subtotal - discount);
  const due = Math.max(0, grandTotal - received);

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-10">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Invoice</h1>
          <p className="text-sm text-muted-foreground">ম্যানুয়াল বা মডিউল সার্ভিস থেকে — একাধিক সার্ভিস যোগ করুন</p>
        </div>
        <Button onClick={() => window.print()} className="gap-2">
          <Printer className="h-4 w-4" /> Print / PDF
        </Button>
      </div>

      <Card className="print:hidden">
        <CardContent className="p-3 sm:p-4 space-y-3">
          {/* top row: two bordered boxes — left: invoice no/date, right: module/search */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-lg border bg-muted/20 p-3 grid grid-cols-2 gap-3">
              <div><Label>Invoice No</Label><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className="mt-1.5" /></div>
              <div><Label>Invoice Date</Label><DateInput value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="mt-1.5" /></div>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3 grid grid-cols-2 gap-3">
              <div>
                <Label className="flex items-center gap-1"><Search className="h-3.5 w-3.5" /> Module</Label>
                <Select value={moduleFilter} onValueChange={setModuleFilter}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="সব মডিউল" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">সব মডিউল</SelectItem>
                    {serviceModules.map((m) => (
                      <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Search</Label>
                <div className="relative mt-1.5">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="ID / নাম / পাসপোর্ট / মোবাইল..." className="pl-8" />
                </div>
              </div>
            </div>
          </div>

          {/* module search results */}
          <div className="space-y-2">
            {moduleFilter !== "all" && filtered.length === 0 && !search && (
              <p className="text-xs text-muted-foreground">এই মডিউলে কোনো এন্ট্রি নেই</p>
            )}
            {filtered.length > 0 && (
              <ul className="max-h-64 overflow-auto rounded-md border divide-y divide-border">
                {filtered.map((e) => (
                  <li key={e.moduleKey + e.id} className="flex items-center justify-between gap-2 p-2.5 hover:bg-accent">
                    <div className="text-sm min-w-0 flex-1">
                      <div className="font-medium truncate flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {e.passenger}
                        {e.passport && <span className="text-xs font-mono text-muted-foreground">· {e.passport}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        <span className="font-mono">{e.id}</span> · {e.module}
                        {e.mobile ? ` · ${e.mobile}` : ""}
                        {e.amount ? ` · ${e.amount.toLocaleString()}৳` : ""}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="gap-1 shrink-0" onClick={() => loadEntry(e)}>
                      <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* service select — all module names */}
          <div>
            <Label className="flex items-center gap-1"><IdCard className="h-3.5 w-3.5" /> Service Select</Label>
            <Select value={item.type} onValueChange={(v) => setItem({ type: v })}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="-- সার্ভিস বাছাই করুন --" /></SelectTrigger>
              <SelectContent>
                {ITEM_TYPES.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* passenger info — common for all services */}
          <div className="space-y-2 pt-1">
            <div className="text-xs font-semibold text-muted-foreground">Passenger Information (সকল সার্ভিসে কমন)</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input placeholder="Passenger Name" value={bill.name} onChange={(e) => setBill({ ...bill, name: e.target.value })} />
              <Input placeholder="Passport No" value={bill.passport} onChange={(e) => setBill({ ...bill, passport: e.target.value })} />
              <Input placeholder="Mobile" value={bill.mobile} onChange={(e) => setBill({ ...bill, mobile: e.target.value })} />
            </div>
          </div>

          {/* service-specific fields (e.g. Air Ticket → Trip Road, Airlines, Flight Date) */}
          <div className="pt-1">
            <ItemFields it={item} onChange={setItem} />
            <div className="grid grid-cols-12 gap-2 items-end pt-2">
              <div className="col-span-6 sm:col-span-3">
                <Label className="text-xs">Date</Label>
                <DateInput value={item.date ?? ""} onChange={(e) => setItem({ date: e.target.value })} />
              </div>
              <div className="col-span-3 sm:col-span-2">
                <Label className="text-xs">Qty</Label>
                <Input type="number" value={item.qty || ""} placeholder="0" onChange={(e) => setItem({ qty: Number(e.target.value) || 0 })} />
              </div>
              <div className="col-span-3 sm:col-span-2">
                <Label className="text-xs">Rate</Label>
                <Input type="number" value={item.rate || ""} placeholder="0" onChange={(e) => setItem({ rate: Number(e.target.value) || 0 })} />
              </div>
              <div className="col-span-12 sm:col-span-5">
                <Label className="text-xs">Note (optional)</Label>
                <Input value={item.detail ?? ""} onChange={(e) => setItem({ detail: e.target.value })} placeholder="optional" />
              </div>
            </div>
          </div>


          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div><Label>Discount</Label><Input type="number" value={discount || ""} placeholder="0" onChange={(e) => setDiscount(Number(e.target.value) || 0)} className="mt-1.5" /></div>
            <div><Label>Received</Label><Input type="number" value={received || ""} placeholder="0" onChange={(e) => setReceived(Number(e.target.value) || 0)} className="mt-1.5" /></div>
            <div><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional remarks" className="mt-1.5" /></div>
          </div>
        </CardContent>
      </Card>

      {/* === PRINTABLE INVOICE (live preview = exact print) === */}
      <div className="invoice-print bg-white text-slate-900 mx-auto shadow-xl print:shadow-none print:rounded-none rounded-2xl overflow-hidden border border-slate-200 print:border-0">
        {/* top banner */}
        <div className="inv-banner relative bg-gradient-to-br from-[#0b2545] via-[#13315c] to-[#1d3b6b] text-white px-8 sm:px-10 py-7 overflow-hidden">
          <div className="absolute -right-10 -top-16 h-48 w-48 rounded-full bg-[#c8a45c]/20 blur-2xl" />
          <div className="absolute right-24 -bottom-20 h-40 w-40 rounded-full bg-white/5 blur-2xl" />
          <div className="relative flex justify-between items-start gap-4 flex-nowrap">
            <div className="min-w-0 flex items-center gap-3 flex-1">
              <div className="h-12 w-12 rounded-xl bg-white/10 ring-1 ring-white/25 flex items-center justify-center shrink-0 backdrop-blur">
                <Plane className="h-6 w-6 text-[#e7c98a]" />
              </div>
              <div className="min-w-0">
                <h2 className="invoice-agency-name font-extrabold tracking-tight leading-tight whitespace-nowrap">{AGENCY.name}</h2>
                <p className="text-[11px] italic text-[#e7c98a] font-medium leading-tight mt-0.5">"{AGENCY.slogan}"</p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="invoice-title font-black tracking-[0.25em] leading-none whitespace-nowrap text-[#e7c98a]">INVOICE</p>
              <p className="font-mono text-xs mt-1.5 text-white/80">{invoiceNo}</p>
            </div>
          </div>
          <div className="relative flex justify-between items-end text-[11px] text-white/70 mt-4 gap-4 border-t border-white/10 pt-3">
            <div className="space-y-0.5">
              <p>{AGENCY.address}</p>
              <p>📞 {AGENCY.phone}</p>
            </div>
            <div className="text-right">
              <p className="uppercase tracking-widest text-white/50 text-[9px]">Issue Date</p>
              <p className="font-semibold text-white/90 text-xs">{formatDate(invoiceDate)}</p>
            </div>
          </div>
        </div>

        <div className="px-8 sm:px-10 pt-7 pb-8 flex flex-col">
          {/* bill to */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-5 py-4 flex items-start gap-3">
            <div className="h-10 w-10 rounded-full bg-[#0b2545] flex items-center justify-center text-white shrink-0">
              <User className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Bill To</p>
              <p className="text-lg font-bold mt-0.5 text-[#0b2545]">{bill.name || "—"}</p>
              <div className="text-xs text-slate-600 mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
                {bill.passport && <span>Passport: <span className="font-mono font-semibold text-slate-700">{bill.passport}</span></span>}
                {bill.nationality && <span>Nationality: <span className="font-semibold text-slate-700">{bill.nationality}</span></span>}
                {bill.mobile && <span>Mobile: <span className="font-semibold text-slate-700">{bill.mobile}</span></span>}
              </div>
            </div>
          </div>

          {/* items */}
          <div className="mt-6 rounded-xl overflow-hidden border border-slate-200 ring-1 ring-slate-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0b2545] text-white">
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider w-8">#</th>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider">Service Details</th>
                  <th className="text-right p-3 text-[11px] font-semibold uppercase tracking-wider">Qty</th>
                  <th className="text-right p-3 text-[11px] font-semibold uppercase tracking-wider">Rate</th>
                  <th className="text-right p-3 text-[11px] font-semibold uppercase tracking-wider">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr><td colSpan={5} className="p-8 text-center text-slate-400 text-xs">No items added yet</td></tr>
                )}
                {items.map((it, idx) => (
                  <tr key={it.uid} className="border-t border-slate-100 align-top odd:bg-white even:bg-slate-50/60">
                    <td className="p-3 text-slate-400 tabular-nums">{idx + 1}</td>
                    <td className="p-3">
                      <div className="font-bold text-[#0b2545] uppercase tracking-wide text-sm">
                        {(it.serviceLabel || "—").toUpperCase()}
                      </div>
                      <ItemDetail it={it} />
                    </td>
                    <td className="p-3 text-right tabular-nums">{it.qty}</td>
                    <td className="p-3 text-right tabular-nums">{it.rate.toLocaleString()}</td>
                    <td className="p-3 text-right tabular-nums font-semibold text-[#0b2545]">{(it.qty * it.rate).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* notes + totals */}
          <div className="mt-6 flex flex-col sm:flex-row justify-between gap-6">
            <div className="flex-1 text-xs text-slate-600 space-y-1">
              {notes && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="font-semibold text-slate-700 flex items-center gap-1.5 mb-1"><StickyNote className="h-3.5 w-3.5" /> Notes</p>
                  <p className="leading-relaxed">{notes}</p>
                </div>
              )}
            </div>
            <div className="sm:w-80 rounded-xl border border-slate-200 p-4 space-y-2.5 bg-white">
              <div className="flex justify-between text-sm"><span className="text-slate-500">Subtotal</span><span className="tabular-nums font-medium">{subtotal.toLocaleString()}৳</span></div>
              {discount > 0 && (<div className="flex justify-between text-sm"><span className="text-slate-500">Discount</span><span className="tabular-nums text-[#b91c1c] font-medium">- {discount.toLocaleString()}৳</span></div>)}
              <div className="flex justify-between items-center bg-gradient-to-r from-[#0b2545] to-[#1d3b6b] text-white px-4 py-3 rounded-lg shadow-sm">
                <span className="text-[11px] uppercase tracking-widest font-semibold">Grand Total</span>
                <span className="text-xl font-black tabular-nums">{grandTotal.toLocaleString()}৳</span>
              </div>
              <div className="flex justify-between text-sm pt-0.5"><span className="text-slate-500">Received</span><span className="tabular-nums font-medium text-emerald-600">{received.toLocaleString()}৳</span></div>
              <div className="flex justify-between text-sm font-bold border-t border-slate-200 pt-2.5"><span className="text-slate-700">Due Balance</span><span className="tabular-nums text-[#b91c1c]">{due.toLocaleString()}৳</span></div>
            </div>
          </div>

          {/* signatures */}
          <div className="mt-12 grid grid-cols-2 gap-10 text-center text-xs text-slate-500">
            <div className="border-t border-slate-300 pt-2">Customer Signature</div>
            <div className="border-t border-slate-300 pt-2">Authorized Signature</div>
          </div>

          <div className="mt-8 pt-4 border-t border-slate-200 text-center">
            <p className="text-xs text-slate-500 italic">This is a system-generated document and requires no physical signature.</p>
            <p className="text-[11px] text-slate-400 mt-1">Thank you for choosing {AGENCY.name}.</p>
          </div>
        </div>
      </div>

      <style>{`
        .invoice-print { width: 100%; max-width: 210mm; min-height: 297mm; font-size: 13pt; }
        .invoice-print .invoice-agency-name { font-size: 20pt; }
        .invoice-print .invoice-title { font-size: 24pt; }
        .invoice-print, .invoice-print * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
        @media print {
          @page { size: A4; margin: 0; }
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          body * { visibility: hidden !important; }
          .invoice-print, .invoice-print * { visibility: visible !important; }
          .invoice-print {
            position: absolute !important;
            left: 0 !important; top: 0 !important;
            width: 100% !important; max-width: 100% !important;
            min-height: 297mm !important;
            box-shadow: none !important; border: 0 !important; border-radius: 0 !important;
            font-size: 13pt !important;
          }
          .invoice-print .inv-banner { border-radius: 0 !important; }
          .invoice-print p, .invoice-print td, .invoice-print th, .invoice-print div, .invoice-print span, .invoice-print li {
            font-size: 13pt !important;
            line-height: 1.4 !important;
          }
          .invoice-print .invoice-agency-name { font-size: 22pt !important; }
          .invoice-print .invoice-title { font-size: 26pt !important; }
          .invoice-print th { font-size: 12pt !important; }
          .invoice-print .text-xs, .invoice-print .text-\\[11px\\], .invoice-print .text-\\[10px\\], .invoice-print .text-\\[9px\\] { font-size: 10.5pt !important; }
        }
      `}</style>
    </div>
  );
}

/* --------------------- module-specific item edit fields ------------------- */

function ItemFields({ it, onChange }: { it: InvoiceItem; onChange: (patch: Partial<InvoiceItem>) => void }) {
  const Headline = (
    <div className="sm:col-span-2">
      <Label className="text-xs flex items-center gap-1"><IdCard className="h-3 w-3" /> Service Name</Label>
      {it.type === "manual" || it.type === "other" ? (
        <LookupSelect kind={it.type === "other" ? "other_service" : "invoice_service_item"} value={it.serviceLabel}
          onChange={(v) => onChange({ serviceLabel: v })} />
      ) : (
        <Input value={it.serviceLabel} onChange={(e) => onChange({ serviceLabel: e.target.value })} />
      )}
    </div>
  );

  if (it.type === "tickets" || (it.type === "other")) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {Headline}
        <div>
          <Label className="text-xs">Trip Road</Label>
          <LookupSelect kind="invoice_route" value={it.fromRoute ?? ""} onChange={(v) => onChange({ fromRoute: v, toRoute: "" })} />
        </div>
        <div>
          <Label className="text-xs">Airlines</Label>
          <LookupSelect kind="invoice_airline" value={it.airline ?? ""} onChange={(v) => onChange({ airline: v })} />
        </div>
        <div>
          <Label className="text-xs">Flight Date</Label>
          <DateInput value={it.flightDate ?? ""} onChange={(e) => onChange({ flightDate: e.target.value })} />
        </div>
      </div>
    );
  }

  if (it.type === "bmet") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {Headline}
        <div>
          <Label className="text-xs">Country</Label>
          <LookupSelect kind="country" value={it.country ?? ""} onChange={(v) => onChange({ country: v })} />
        </div>
      </div>
    );
  }

  if (it.type === "saudi-visa") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {Headline}
        <div>
          <Label className="text-xs">Visa Type</Label>
          <Input value={it.visaType ?? ""} onChange={(e) => onChange({ visaType: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Sponsor</Label>
          <Input value={it.sponsor ?? ""} onChange={(e) => onChange({ sponsor: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">MOFA / Visa No</Label>
          <Input value={it.refNo ?? ""} onChange={(e) => onChange({ refNo: e.target.value })} />
        </div>
      </div>
    );
  }

  if (it.type === "kuwait-visa") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {Headline}
        <div>
          <Label className="text-xs">Visa No</Label>
          <Input value={it.refNo ?? ""} onChange={(e) => onChange({ refNo: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Sponsor</Label>
          <Input value={it.sponsor ?? ""} onChange={(e) => onChange({ sponsor: e.target.value })} />
        </div>
      </div>
    );
  }

  // manual
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{Headline}</div>;
}
