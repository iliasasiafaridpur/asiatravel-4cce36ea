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
import { Printer, Search, Plus, Trash2, ArrowRight, Plane, User } from "lucide-react";

export const Route = createFileRoute("/invoice")({
  head: () => ({ meta: [{ title: "Invoice — Asia Tours and Travels" }] }),
  component: InvoicePage,
});

interface ServiceEntry {
  module: string; moduleKey: string; id: string; date: string;
  passenger: string; passport: string; mobile?: string;
  airline?: string; pnr?: string; flightDate?: string;
  amount: number; received: number;
}

interface InvoiceItem {
  uid: string;
  serviceItem: string;   // dropdown
  airline: string;       // dropdown
  fromRoute: string;     // dropdown
  toRoute: string;       // dropdown
  detail?: string;
  date?: string;
  qty: number;
  rate: number;
}

const AGENCY = {
  name: "ASIA TOURS AND TRAVELS",
  slogan: "Customer satisfaction is our primary goal.",
  address: "Bariplaza 4th Floor, Thana Road, Faridpur",
  phone: "+8801721-399599",
};

const genUid = () => Math.random().toString(36).slice(2, 10);

function InvoicePage() {
  const [allEntries, setAllEntries] = useState<ServiceEntry[]>([]);
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState<string>("all");

  const [invoiceNo, setInvoiceNo] = useState<string>(
    "INV-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.floor(Math.random() * 900 + 100),
  );
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().slice(0, 10));

  const [bill, setBill] = useState({ name: "", passport: "", nationality: "Bangladeshi", mobile: "" });
  const [pnr, setPnr] = useState("");
  const [items, setItems] = useState<InvoiceItem[]>([]);
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
            module: m.label, moduleKey: m.key,
            id: String(r[m.idColumn] ?? ""),
            date: String(r.entry_date ?? r.created_at ?? ""),
            passenger: String(r.passenger_name ?? "—"),
            passport: String(r.passport ?? ""),
            mobile: String(r.mobile ?? ""),
            airline: String(r.airline ?? ""),
            pnr: String(r.pnr ?? ""),
            flightDate: String(r.flight_date ?? ""),
            amount: Number(r.sold_price ?? 0),
            received: Number(r.received ?? r.received_amount ?? 0),
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
    if (q) list = list.filter((e) => `${e.id} ${e.passenger} ${e.passport} ${e.mobile} ${e.pnr}`.toLowerCase().includes(q));
    else if (moduleFilter === "all") return [];
    return list.slice(0, 30);
  }, [allEntries, search, moduleFilter]);

  const loadEntry = (e: ServiceEntry) => {
    // Auto-fill ALL passenger info from the service entry (overwrites)
    setBill({
      name: e.passenger || "",
      passport: e.passport || "",
      nationality: bill.nationality || "Bangladeshi",
      mobile: e.mobile || "",
    });
    if (e.pnr) setPnr(e.pnr);
    setItems((prev) => [...prev, {
      uid: genUid(),
      serviceItem: e.module,
      airline: e.airline || "",
      fromRoute: "",
      toRoute: "",
      detail: e.id,
      date: e.flightDate || e.date,
      qty: 1,
      rate: e.amount || 0,
    }]);
    setReceived((r) => r + (e.received || 0));
    setSearch("");
    setModuleFilter("all");
  };

  const addBlankItem = () => setItems((p) => [...p, {
    uid: genUid(), serviceItem: "", airline: "", fromRoute: "", toRoute: "",
    detail: "", date: "", qty: 1, rate: 0,
  }]);
  const removeItem = (uid: string) => setItems((p) => p.filter((i) => i.uid !== uid));
  const updateItem = (uid: string, patch: Partial<InvoiceItem>) =>
    setItems((p) => p.map((i) => (i.uid === uid ? { ...i, ...patch } : i)));

  const subtotal = items.reduce((s, i) => s + i.qty * i.rate, 0);
  const grandTotal = Math.max(0, subtotal - discount);
  const due = Math.max(0, grandTotal - received);
  const paid = received >= grandTotal && grandTotal > 0;

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-10">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Invoice</h1>
          <p className="text-sm text-muted-foreground">পেশাদার ইনভয়েচ — একাধিক সার্ভিস যোগ করুন</p>
        </div>
        <Button onClick={() => window.print()} className="gap-2">
          <Printer className="h-4 w-4" /> Print / PDF
        </Button>
      </div>

      <Card className="print:hidden">
        <CardContent className="p-3 sm:p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><Label>Invoice No</Label><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className="mt-1.5" /></div>
            <div><Label>Invoice Date</Label><Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="mt-1.5" /></div>
            <div><Label>PNR / Booking Ref</Label><Input value={pnr} onChange={(e) => setPnr(e.target.value)} className="mt-1.5" /></div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
              <Search className="h-3.5 w-3.5" /> Service Module থেকে যাত্রী খুঁজুন
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2">
              <Select value={moduleFilter} onValueChange={setModuleFilter}>
                <SelectTrigger><SelectValue placeholder="সব মডিউল" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">সব মডিউল</SelectItem>
                  {serviceModules.map((m) => (
                    <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="ID / নাম / পাসপোর্ট / মোবাইল / PNR..." className="pl-8" />
              </div>
            </div>
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


          <div className="space-y-2 pt-2">
            <div className="text-xs font-semibold text-muted-foreground">Passenger Info</div>
            <Input placeholder="Passenger Name" value={bill.name} onChange={(e) => setBill({ ...bill, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Passport No" value={bill.passport} onChange={(e) => setBill({ ...bill, passport: e.target.value })} />
              <Input placeholder="Nationality" value={bill.nationality} onChange={(e) => setBill({ ...bill, nationality: e.target.value })} />
            </div>
            <Input placeholder="Mobile" value={bill.mobile} onChange={(e) => setBill({ ...bill, mobile: e.target.value })} />
          </div>

          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-muted-foreground">Invoice Items</div>
              <Button size="sm" variant="outline" className="gap-1" onClick={addBlankItem}>
                <Plus className="h-3.5 w-3.5" /> Add Item
              </Button>
            </div>
            <div className="space-y-3">
              {items.length === 0 && (
                <p className="text-xs text-muted-foreground p-2 border border-dashed rounded">
                  কোনো আইটেম নেই — উপরের লিস্ট থেকে Add করুন বা "Add Item" দিন
                </p>
              )}
              {items.map((it) => (
                <div key={it.uid} className="rounded-md border p-2 space-y-2 bg-muted/30">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Service Item</Label>
                      <LookupSelect kind="service_item" value={it.serviceItem}
                        onChange={(v) => updateItem(it.uid, { serviceItem: v })} />
                    </div>
                    <div>
                      <Label className="text-xs">Airline</Label>
                      <LookupSelect kind="airline" value={it.airline}
                        onChange={(v) => updateItem(it.uid, { airline: v })} />
                    </div>
                    <div>
                      <Label className="text-xs">From</Label>
                      <LookupSelect kind="route" value={it.fromRoute}
                        onChange={(v) => updateItem(it.uid, { fromRoute: v })} />
                    </div>
                    <div>
                      <Label className="text-xs">To</Label>
                      <LookupSelect kind="route" value={it.toRoute}
                        onChange={(v) => updateItem(it.uid, { toRoute: v })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-12 sm:col-span-4">
                      <Label className="text-xs">Detail / Note</Label>
                      <Input placeholder="optional" value={it.detail ?? ""}
                        onChange={(e) => updateItem(it.uid, { detail: e.target.value })} />
                    </div>
                    <div className="col-span-6 sm:col-span-3">
                      <Label className="text-xs">Date</Label>
                      <Input type="date" value={it.date ?? ""} onChange={(e) => updateItem(it.uid, { date: e.target.value })} />
                    </div>
                    <div className="col-span-3 sm:col-span-2">
                      <Label className="text-xs">Qty</Label>
                      <Input type="number" value={it.qty || ""} placeholder="0" onChange={(e) => updateItem(it.uid, { qty: Number(e.target.value) || 0 })} />
                    </div>
                    <div className="col-span-3 sm:col-span-2">
                      <Label className="text-xs">Rate</Label>
                      <Input type="number" value={it.rate || ""} placeholder="0" onChange={(e) => updateItem(it.uid, { rate: Number(e.target.value) || 0 })} />
                    </div>
                    <Button size="icon" variant="ghost" className="col-span-12 sm:col-span-1 text-destructive"
                      onClick={() => removeItem(it.uid)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div><Label>Discount</Label><Input type="number" value={discount || ""} placeholder="0" onChange={(e) => setDiscount(Number(e.target.value) || 0)} className="mt-1.5" /></div>
            <div><Label>Received</Label><Input type="number" value={received || ""} placeholder="0" onChange={(e) => setReceived(Number(e.target.value) || 0)} className="mt-1.5" /></div>
            <div><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional remarks" className="mt-1.5" /></div>
          </div>
        </CardContent>
      </Card>

      {/* === PRINTABLE INVOICE === */}
      <div className="invoice-print bg-white text-slate-900 mx-auto shadow-lg print:shadow-none print:rounded-none rounded-lg overflow-hidden border border-slate-200 print:border-0">
        <div className="flex">
          <div className="w-2 shrink-0 bg-gradient-to-b from-[#0b2545] via-[#13315c] to-[#c8a45c]" />
          <div className="flex-1 p-8 sm:p-10">
            <div className="flex justify-between items-center gap-4 border-b border-slate-200 pb-4">
              <div className="min-w-0 flex items-center gap-2">
                <div className="h-9 w-9 rounded-md bg-gradient-to-br from-[#0b2545] to-[#c8a45c] flex items-center justify-center text-white shrink-0">
                  <Plane className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-[#0b2545] leading-tight truncate">{AGENCY.name}</h2>
                  <p className="text-[10px] italic text-[#c8a45c] font-semibold leading-tight">"{AGENCY.slogan}"</p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg sm:text-xl font-black tracking-widest text-[#0b2545] leading-none">INVOICE</p>
                <p className="font-mono text-[11px] mt-0.5">{invoiceNo}</p>
              </div>
            </div>
            <div className="flex justify-between text-[11px] text-slate-600 mt-2 gap-4">
              <div>
                <p>{AGENCY.address}</p>
                <p>📞 {AGENCY.phone}</p>
              </div>
              <div className="text-right">
                <p>Date: {formatDate(invoiceDate)}</p>
                {pnr && <p>PNR: <span className="font-mono">{pnr}</span></p>}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 p-4 mt-6">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Passenger Info</p>
              <p className="text-base font-bold mt-1">{bill.name || "—"}</p>
              <div className="text-xs text-slate-600 mt-1 space-y-0.5">
                {bill.passport && <p>Passport: <span className="font-mono">{bill.passport}</span></p>}
                {bill.nationality && <p>Nationality: {bill.nationality}</p>}
                {bill.mobile && <p>Mobile: {bill.mobile}</p>}
              </div>
            </div>

            <div className="mt-6 rounded-lg overflow-hidden border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#0b2545] text-white">
                    <th className="text-left p-2.5 text-xs font-semibold uppercase tracking-wider">Service</th>
                    <th className="text-right p-2.5 text-xs font-semibold uppercase tracking-wider">Qty</th>
                    <th className="text-right p-2.5 text-xs font-semibold uppercase tracking-wider">Rate</th>
                    <th className="text-right p-2.5 text-xs font-semibold uppercase tracking-wider">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr><td colSpan={4} className="p-6 text-center text-slate-400 text-xs">No items</td></tr>
                  )}
                  {items.map((it) => (
                    <tr key={it.uid} className="border-t border-slate-200 align-top">
                      <td className="p-2.5">
                        <div className="font-bold text-[#0b2545] uppercase tracking-wide text-sm">
                          {(it.serviceItem || "—").toUpperCase()}
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5">
                          {(it.fromRoute || it.toRoute) ? (
                            <span className="inline-flex items-center gap-1">
                              ROUTE: {it.fromRoute || "?"}
                              <ArrowRight className="h-3 w-3 text-[#c8a45c]" />
                              {it.toRoute || "?"}
                            </span>
                          ) : it.detail ? `Ref: ${it.detail}` : null}
                        </div>
                        {it.date && (
                          <div className="text-xs text-slate-500 mt-0.5">
                            Flight date: {formatDate(it.date)}
                          </div>
                        )}
                        {it.airline && (
                          <div className="text-[11px] text-slate-500">Airline: {it.airline}</div>
                        )}
                      </td>
                      <td className="p-2.5 text-right tabular-nums">{it.qty}</td>
                      <td className="p-2.5 text-right tabular-nums">{it.rate.toLocaleString()}</td>
                      <td className="p-2.5 text-right tabular-nums font-semibold">{(it.qty * it.rate).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-6 flex flex-col sm:flex-row justify-between gap-6">
              <div className="flex-1 text-xs text-slate-600 space-y-1">
                {notes && (<><p className="font-semibold text-slate-700">Notes:</p><p>{notes}</p></>)}
              </div>
              <div className="sm:w-72 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-slate-600">Subtotal</span><span className="tabular-nums">{subtotal.toLocaleString()}৳</span></div>
                {discount > 0 && (<div className="flex justify-between text-sm"><span className="text-slate-600">Discount</span><span className="tabular-nums">- {discount.toLocaleString()}৳</span></div>)}
                <div className="flex justify-between items-center bg-gradient-to-r from-[#0b2545] to-[#13315c] text-white px-3 py-2.5 rounded-md">
                  <span className="text-xs uppercase tracking-wider font-semibold">Grand Total (Net)</span>
                  <span className="text-lg font-black tabular-nums">{grandTotal.toLocaleString()}৳</span>
                </div>
                <div className="flex justify-between text-sm"><span className="text-slate-600">Received</span><span className="tabular-nums">{received.toLocaleString()}৳</span></div>
                <div className="flex justify-between text-sm font-semibold"><span className="text-slate-700">Due</span><span className="tabular-nums">{due.toLocaleString()}৳</span></div>
              </div>
            </div>

            <div className="mt-8 pt-4 border-t border-slate-200 text-center">
              <p className="text-[11px] text-slate-500 italic">This is a system-generated document and requires no physical signature.</p>
              <p className="text-[10px] text-slate-400 mt-1">Thank you for choosing {AGENCY.name}.</p>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 10mm; }
          body { background: white !important; }
          .invoice-print { box-shadow: none !important; border: 0 !important; }
        }
        .invoice-print { width: 100%; max-width: 210mm; }
      `}</style>
    </div>
  );
}
