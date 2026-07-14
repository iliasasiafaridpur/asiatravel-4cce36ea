import { DateInput } from "@/components/ui/date-input";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { MODULES, formatDate } from "@/lib/modules";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LookupSelect } from "@/components/LookupSelect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, Search, User, IdCard, ReceiptText, WalletCards, MapPin, Phone, Mail, Plus, Trash2, FileText } from "lucide-react";
import logoAsset from "@/assets/logo.png.asset.json";
import { BlankPadDialog } from "@/components/BlankPadDialog";


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
  rate: number;
}

const ITEM_TYPES = [
  { key: "tickets", label: "AIR TICKET" },
  { key: "bmet", label: "BMET CARD" },
  { key: "saudi-visa", label: "SAUDI VISA" },
  { key: "kuwait-visa", label: "KUWAIT VISA" },
  { key: "other", label: "OTHER SERVICE" },
  { key: "manual", label: "CUSTOM / MANUAL" },
];

const AGENCY = {
  name: "ASIA TOURS AND TRAVELS",
  slogan: "Customer satisfaction is our primary goal.",
  address: "Bariplaza 4th Floor, Thana Road, Faridpur",
  phone: "+8801721-399599",
  email: "kaiumkhan449@gmail.com",
};

const genUid = () => Math.random().toString(36).slice(2, 10);
const str = (v: unknown) => (v == null ? "" : String(v));
const serviceLabelFor = (type: string) => ITEM_TYPES.find((t) => t.key === type)?.label ?? "";
const blankItem = (type = "tickets"): InvoiceItem => ({
  uid: genUid(),
  type,
  serviceLabel: type === "manual" ? "" : serviceLabelFor(type),
  rate: 0,
});

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

  const [invoiceNo, setInvoiceNo] = useState<string>(
    "INV-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.floor(Math.random() * 900 + 100),
  );
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().slice(0, 10));

  const [bill, setBill] = useState({ name: "", passport: "", nationality: "Bangladeshi", mobile: "" });
  const [items, setItems] = useState<InvoiceItem[]>(() => [blankItem("tickets")]);
  const [received, setReceived] = useState<number>(0);
  const [discount, setDiscount] = useState<number>(0);
  const invoiceRef = useRef<HTMLDivElement>(null);
  const [blankPadOpen, setBlankPadOpen] = useState(false);
  // Paper size for printing. "A5" scales the whole invoice down so the complete
  // content prints on half of an A4 page (A5 area ≈ half of A4).
  const [paperSize, setPaperSize] = useState<"A4" | "A5">("A4");
  // Tracks how much of `received` was auto-contributed by each loaded service line
  // (keyed by item uid), so replacing/removing a line can subtract its old
  // contribution instead of leaving stale amounts that inflate Received / hide Due.
  const loadedReceivedRef = useRef<Record<string, number>>({});

  // Set a descriptive document title so the saved PDF / print file name reads
  // like "Invoice_INV-..._<customer>"; restore the original afterwards.
  const handleInvoicePrint = () => {
    const safe = (s: string) =>
      s.replace(/[\\/:*?"<>|]+/g, " ").replace(/[—·•,]+/g, " ").trim().replace(/[\s.]+/g, "_");
    const parts = ["Invoice", invoiceNo, bill.name].map(safe).filter(Boolean);
    const docTitle = parts.join("_").replace(/_{2,}/g, "_") || "Invoice";
    const prev = document.title;
    document.title = docTitle;
    const restore = () => {
      document.title = prev;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
    setTimeout(restore, 1500);
  };





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

  const updateItem = (uid: string, patch: Partial<InvoiceItem>) =>
    setItems((p) => p.map((it) => (it.uid === uid ? { ...it, ...patch } : it)));

  const changeItemService = (uid: string, type: string) => {
    // Switching a line's service type drops whatever entry was loaded there.
    const prev = loadedReceivedRef.current[uid] || 0;
    if (prev) {
      delete loadedReceivedRef.current[uid];
      setReceived((r) => Math.max(0, r - prev));
    }
    setItems((p) => p.map((it) => (it.uid === uid ? { ...blankItem(type), uid } : it)));
  };

  const addItem = () => setItems((p) => [...p, blankItem("tickets")]);

  const removeItem = (uid: string) =>
    setItems((p) => {
      if (p.length <= 1) return p;
      const prev = loadedReceivedRef.current[uid] || 0;
      if (prev) {
        delete loadedReceivedRef.current[uid];
        setReceived((r) => Math.max(0, r - prev));
      }
      return p.filter((it) => it.uid !== uid);
    });

  // Loading an existing entry into a service line. Passenger info is filled only
  // if still empty (one passenger per invoice). Received accumulates per service,
  // but a line that already carried a loaded entry first gives back its previous
  // contribution so switching entries never double-counts the received amount.
  const loadEntryIntoItem = (uid: string, e: ServiceEntry) => {
    setItems((p) => p.map((it) => (it.uid === uid ? { ...buildItemFromEntry(e), uid } : it)));
    setBill((prev) => ({
      name: prev.name || e.passenger || "",
      passport: prev.passport || e.passport || "",
      nationality: prev.nationality || "Bangladeshi",
      mobile: prev.mobile || e.mobile || "",
    }));
    const prevContrib = loadedReceivedRef.current[uid] || 0;
    const newContrib = e.received || 0;
    loadedReceivedRef.current[uid] = newContrib;
    if (prevContrib !== newContrib) {
      setReceived((r) => Math.max(0, r - prevContrib + newContrib));
    }
  };

  const subtotal = items.reduce((s, i) => s + i.rate, 0);
  const grandTotal = Math.max(0, subtotal - discount);
  const due = Math.max(0, grandTotal - received);

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-10">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Invoice</h1>
          <p className="text-sm text-muted-foreground">এক প্যাসেঞ্জারের জন্য এক বা একাধিক সার্ভিস যোগ করুন — ম্যানুয়ালি লিখুন বা সার্চ করে এন্ট্রি আনুন</p>
        </div>
      </div>

      <Card className="print:hidden overflow-hidden border-primary/20">
        <CardContent className="p-0">
          <div className="border-b bg-muted/25 px-4 py-3 sm:px-5">
            <div className="rounded-md border bg-card/70 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                <ReceiptText className="h-3.5 w-3.5" /> Invoice Info
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field label="Invoice No"><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></Field>
                <Field label="Invoice Date"><DateInput value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></Field>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 sm:p-5 xl:grid-cols-[1.25fr_1fr]">
            <section className="space-y-3">
              <SectionTitle icon={<User className="h-4 w-4" />} title="Passenger Information" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Field label="Passenger Name"><Input value={bill.name} onChange={(e) => setBill({ ...bill, name: e.target.value })} /></Field>
                <Field label="Passport No"><Input value={bill.passport} onChange={(e) => setBill({ ...bill, passport: e.target.value })} /></Field>
                <Field label="Mobile"><Input value={bill.mobile} onChange={(e) => setBill({ ...bill, mobile: e.target.value })} /></Field>
              </div>

              <div className="flex items-center justify-between border-b pb-2">
                <SectionTitle icon={<IdCard className="h-4 w-4" />} title="Services" />
                <Button type="button" variant="outline" size="sm" onClick={addItem} className="h-8 gap-1">
                  <Plus className="h-3.5 w-3.5" /> Add Service
                </Button>
              </div>

              <div className="space-y-3">
                {items.map((it, idx) => (
                  <ItemEditor
                    key={it.uid}
                    index={idx}
                    item={it}
                    allEntries={allEntries}
                    canRemove={items.length > 1}
                    onChange={(patch) => updateItem(it.uid, patch)}
                    onChangeService={(type) => changeItemService(it.uid, type)}
                    onRemove={() => removeItem(it.uid)}
                    onLoadEntry={(e) => loadEntryIntoItem(it.uid, e)}
                  />
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <SectionTitle icon={<WalletCards className="h-4 w-4" />} title="Amount" />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Subtotal">
                  <Input value={`${subtotal.toLocaleString()}৳`} readOnly className="bg-muted/40" />
                </Field>
                <Field label="Discount"><Input type="number" value={discount || ""} placeholder="0" onChange={(e) => setDiscount(Number(e.target.value) || 0)} /></Field>
                <Field label="Received"><Input type="number" value={received || ""} placeholder="0" onChange={(e) => setReceived(Number(e.target.value) || 0)} /></Field>
              </div>
              <div className="rounded-md border bg-muted/25 p-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-semibold tabular-nums">{grandTotal.toLocaleString()}৳</span></div>
                <div className="mt-1 flex justify-between"><span className="text-muted-foreground">Due</span><span className="font-bold tabular-nums text-destructive">{due.toLocaleString()}৳</span></div>
              </div>
            </section>
          </div>
        </CardContent>
      </Card>


      {/* === PRINTABLE INVOICE (live preview = exact print) === */}
      <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
        <div className="inline-flex items-center rounded-md border p-0.5">
          {(["A4", "A5"] as const).map((sz) => (
            <Button
              key={sz}
              type="button"
              size="sm"
              variant={paperSize === sz ? "default" : "ghost"}
              className="h-8 px-3"
              onClick={() => setPaperSize(sz)}
            >
              {sz}
            </Button>
          ))}
        </div>
        <Button variant="outline" onClick={() => setBlankPadOpen(true)} className="gap-2">
          <FileText className="h-4 w-4" /> Blank Pad
        </Button>
        <Button onClick={handleInvoicePrint} className="gap-2">
          <Printer className="h-4 w-4" /> Print / PDF {paperSize === "A5" ? "(A5)" : ""}
        </Button>
      </div>
      <BlankPadDialog open={blankPadOpen} onClose={() => setBlankPadOpen(false)} />

      <div ref={invoiceRef} className={`invoice-print paper-${paperSize.toLowerCase()} relative bg-white text-slate-900 mx-auto shadow-xl print:shadow-none print:rounded-none rounded-2xl overflow-hidden border border-slate-200 print:border-0 flex flex-col min-h-[297mm]`}>
        {/* logo watermark */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
        >
          <img
            src={logoAsset.url}
            alt=""
            className="inv-watermark w-[70%] max-w-[420px] object-contain opacity-[0.06]"
          />
        </div>
        <div className="relative z-10 flex-1 flex flex-col">
        {/* top banner — light / low-ink */}
        <div className="inv-banner relative bg-white border-b-2 border-[#496a9d] px-8 sm:px-10 py-6">
          <div className="relative flex justify-between items-start gap-4 flex-nowrap">
            <div className="min-w-0 flex items-center gap-3 flex-1">
              <div className="h-14 w-14 rounded-xl bg-white ring-1 ring-[#496a9d]/20 overflow-hidden flex items-center justify-center shrink-0">
                <img src={logoAsset.url} alt={AGENCY.name} className="h-full w-full object-contain" width={56} height={56} />
              </div>

              <div className="min-w-0">
                <h2 className="invoice-agency-name font-extrabold tracking-tight leading-tight whitespace-nowrap text-[#0b2545]">{AGENCY.name}</h2>
                <p className="text-[11px] italic text-[#b08a3e] font-medium leading-tight mt-0.5">"{AGENCY.slogan}"</p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="invoice-title font-black tracking-[0.22em] leading-none whitespace-nowrap text-[#496a9d]">INVOICE</p>
              <p className="font-mono text-xs mt-1.5 text-slate-500">{invoiceNo}</p>
              <p className="text-[11px] mt-1 text-slate-500"><span className="uppercase tracking-widest text-slate-400 text-[9px]">Date: </span><span className="font-semibold text-slate-700">{formatDate(invoiceDate)}</span></p>
            </div>
          </div>
          <div className="relative flex justify-between items-center text-slate-600 mt-4 gap-4 border-t border-slate-200 pt-3">
            <div className="inv-contact flex flex-nowrap items-center gap-x-4 whitespace-nowrap">
              <p className="flex items-center gap-1.5">
                <span className="inv-ico h-6 w-6 rounded-lg bg-[#496a9d]/10 ring-1 ring-[#496a9d]/15 flex items-center justify-center shrink-0">
                  <MapPin className="h-3.5 w-3.5 text-[#496a9d]" />
                </span>
                <span>{AGENCY.address}</span>
              </p>
              <p className="flex items-center gap-1.5">
                <span className="inv-ico h-6 w-6 rounded-lg bg-[#496a9d]/10 ring-1 ring-[#496a9d]/15 flex items-center justify-center shrink-0">
                  <Phone className="h-3.5 w-3.5 text-[#496a9d]" />
                </span>
                <span>{AGENCY.phone}</span>
              </p>
              <p className="flex items-center gap-1.5">
                <span className="inv-ico h-6 w-6 rounded-lg bg-[#496a9d]/10 ring-1 ring-[#496a9d]/15 flex items-center justify-center shrink-0">
                  <Mail className="h-3.5 w-3.5 text-[#496a9d]" />
                </span>
                <span>{AGENCY.email}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="px-8 sm:px-10 pt-7 pb-8 flex flex-col flex-1">
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
                <tr className="bg-slate-100 text-[#1d3b6b] border-b-2 border-[#496a9d]">
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider w-8">#</th>
                  <th className="text-left p-3 text-[11px] font-semibold uppercase tracking-wider">Service Details</th>
                  <th className="text-right p-3 text-[11px] font-semibold uppercase tracking-wider">Price</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr><td colSpan={3} className="p-8 text-center text-slate-400 text-xs">No items added yet</td></tr>
                )}
                {items.map((it, idx) => (
                  <tr key={it.uid} className="border-t border-slate-100 align-top odd:bg-white even:bg-slate-50/60">
                    <td className="p-3 text-slate-400 tabular-nums">{idx + 1}</td>
                    <td className="p-3">
                      <div className="font-bold text-[#1d3b6b] uppercase tracking-wide text-sm">
                        {(it.serviceLabel || "—").toUpperCase()}
                      </div>
                      {it.detail && (
                        <div className="mt-0.5 text-xs text-slate-600">
                          <span className="text-slate-400">Ref:</span>{" "}
                          <span className="font-medium text-slate-700">{it.detail}</span>
                        </div>
                      )}
                      <ItemDetail it={it} />
                    </td>
                    <td className="p-3 text-right tabular-nums font-semibold text-[#0b2545]">{it.rate.toLocaleString()}৳</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* totals */}
          <div className="mt-6 flex justify-end">
            <div className="w-full sm:w-80 rounded-xl border border-slate-200 p-4 space-y-2.5 bg-white">
              <div className="flex justify-between text-sm"><span className="text-slate-500">Subtotal</span><span className="tabular-nums font-medium">{subtotal.toLocaleString()}৳</span></div>
              {discount > 0 && (<div className="flex justify-between text-sm"><span className="text-slate-500">Discount</span><span className="tabular-nums text-[#b91c1c] font-medium">- {discount.toLocaleString()}৳</span></div>)}
              <div className="flex justify-between items-center bg-[#496a9d]/10 text-[#0b2545] px-4 py-3 rounded-lg border border-[#496a9d]/30">
                <span className="text-[11px] uppercase tracking-widest font-semibold">Grand Total</span>
                <span className="text-xl font-black tabular-nums text-[#0b2545]">{grandTotal.toLocaleString()}৳</span>
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
            <p className="text-[11px] text-slate-400">Thank you for choosing {AGENCY.name}.</p>
          </div>
        </div>
        </div>
      </div>

      <style>{`
        .invoice-print { width: 100%; max-width: 210mm; min-height: 297mm; font-size: 13pt; }
        .invoice-print .inv-watermark { opacity: 0.06 !important; }
        .invoice-print .invoice-agency-name { font-size: 20pt; }
        .invoice-print .invoice-title { font-size: 18pt; }
        .invoice-print .inv-contact { flex-wrap: nowrap; gap: 0.55rem; width: 100%; justify-content: space-between; }
        .invoice-print .inv-contact p { font-size: 9pt; line-height: 1.3; white-space: nowrap; }
        .invoice-print .inv-ico { height: 18pt; width: 18pt; }
        .invoice-print .inv-ico svg { height: 11pt; width: 11pt; }
        .invoice-print .inv-banner { padding-left: 10mm !important; padding-right: 10mm !important; }
        /* On-screen preview of A5: shrink so what you see matches the half-page print. */
        .invoice-print.paper-a5 { zoom: 0.704; }
        .invoice-print, .invoice-print * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
        @media print {
          @page { size: ${paperSize}; margin: 0; }
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
          /* A5 = half of A4: keep the full A4 layout but scale it to 70.4%
             (148mm / 210mm) so the complete invoice fits one A5 sheet. */
          .invoice-print.paper-a5 {
            zoom: 0.704 !important;
            width: 210mm !important; max-width: 210mm !important;
          }
          .invoice-print .inv-banner { border-radius: 0 !important; padding-left: 8mm !important; padding-right: 8mm !important; }
          .invoice-print p, .invoice-print td, .invoice-print th, .invoice-print div, .invoice-print span, .invoice-print li {
            font-size: 13pt !important;
            line-height: 1.4 !important;
          }
          .invoice-print .invoice-agency-name { font-size: 22pt !important; }
          .invoice-print .invoice-title { font-size: 18pt !important; }
          .invoice-print th { font-size: 12pt !important; }
          .invoice-print .text-xs, .invoice-print .text-\\[11px\\], .invoice-print .text-\\[10px\\], .invoice-print .text-\\[9px\\] { font-size: 10.5pt !important; }
          /* Contact strip: must never overflow — force small, tight and shrinkable */
          .invoice-print .inv-contact { flex-wrap: nowrap !important; gap: 0.4rem !important; width: 100% !important; justify-content: space-between !important; }
          .invoice-print .inv-contact p, .invoice-print .inv-contact span { font-size: 8.5pt !important; line-height: 1.2 !important; white-space: nowrap !important; }
          .invoice-print .inv-ico { height: 16pt !important; width: 16pt !important; }
          .invoice-print .inv-ico svg { height: 10pt !important; width: 10pt !important; }
        }
      `}</style>
    </div>
  );
}

/* ----------------------------- form helpers ----------------------------- */

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b pb-2 text-sm font-bold uppercase tracking-wide text-foreground">
      <span className="text-primary">{icon}</span>
      {title}
    </div>
  );
}

/* --------------------- module-specific item edit fields ------------------- */

function ItemFields({ it, onChange }: { it: InvoiceItem; onChange: (patch: Partial<InvoiceItem>) => void }) {
  const CustomServiceName = it.type === "manual" || it.type === "other" ? (
    <div className="sm:col-span-2">
      <Label className="text-xs">Service Name</Label>
      <LookupSelect kind={it.type === "other" ? "other_service" : "invoice_service_item"} value={it.serviceLabel}
        onChange={(v) => onChange({ serviceLabel: v })} />
    </div>
  ) : null;

  if (it.type === "tickets" || (it.type === "other")) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {CustomServiceName}
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
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{CustomServiceName}</div>;
}

/* ---------------------- per-service editor (search + fields) -------------- */

function ItemEditor({
  index,
  item,
  allEntries,
  canRemove,
  onChange,
  onChangeService,
  onRemove,
  onLoadEntry,
}: {
  index: number;
  item: InvoiceItem;
  allEntries: ServiceEntry[];
  canRemove: boolean;
  onChange: (patch: Partial<InvoiceItem>) => void;
  onChangeService: (type: string) => void;
  onRemove: () => void;
  onLoadEntry: (e: ServiceEntry) => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (item.type === "manual") return [];
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return allEntries
      .filter((e) => e.moduleKey === item.type)
      .filter((e) => `${e.id} ${e.passenger} ${e.passport} ${e.mobile}`.toLowerCase().includes(q))
      .slice(0, 20);
  }, [allEntries, search, item.type]);

  return (
    <div className="rounded-lg border bg-card/60 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
          Service {index + 1}
        </span>
        <span className="text-xs text-muted-foreground truncate">{(item.serviceLabel || "—").toUpperCase()}</span>
        <div className="flex-1" />
        {canRemove && (
          <Button type="button" variant="ghost" size="icon" onClick={onRemove} title="মুছুন" className="h-8 w-8">
            <Trash2 className="h-4 w-4 text-rose-500" />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[0.85fr_1.15fr] gap-2">
        <Field label="Service">
          <Select value={item.type} onValueChange={(t) => { onChangeService(t); setSearch(""); }}>
            <SelectTrigger><SelectValue placeholder="সার্ভিস বাছাই করুন" /></SelectTrigger>
            <SelectContent>
              {ITEM_TYPES.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Search Existing Entry">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={item.type === "manual"}
              placeholder={item.type === "manual" ? "Manual entry selected" : "ID / নাম / পাসপোর্ট / মোবাইল"}
              className="pl-8"
            />
          </div>
        </Field>
      </div>

      {item.type !== "manual" && search.trim() && filtered.length === 0 && (
        <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">কোনো এন্ট্রি পাওয়া যায়নি</div>
      )}
      {search.trim() && filtered.length > 0 && (
        <div className="max-h-56 overflow-auto rounded-md border">
          {filtered.map((e) => (
            <button
              key={e.moduleKey + e.id}
              type="button"
              onClick={() => { onLoadEntry(e); setSearch(""); }}
              className="flex w-full items-center justify-between gap-3 border-b p-2.5 text-left transition-colors last:border-b-0 hover:bg-accent/70"
            >
              <span className="min-w-0 flex-1 text-sm">
                <span className="flex items-center gap-1.5 truncate font-medium">
                  <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{e.passenger}
                  {e.passport && <span className="text-xs font-mono text-muted-foreground">· {e.passport}</span>}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  <span className="font-mono">{e.id}</span> · {e.module}{e.mobile ? ` · ${e.mobile}` : ""}{e.amount ? ` · ${e.amount.toLocaleString()}৳` : ""}
                </span>
              </span>
              <span className="shrink-0 rounded-md border px-2.5 py-1 text-xs font-semibold text-primary">Use</span>
            </button>
          ))}
        </div>
      )}

      <ItemFields it={item} onChange={onChange} />

      <div className="grid grid-cols-2 gap-2">
        <Field label="Price">
          <Input
            type="number"
            value={item.rate || ""}
            placeholder="0"
            onChange={(e) => onChange({ rate: Number(e.target.value) || 0 })}
          />
        </Field>
      </div>
    </div>
  );
}
