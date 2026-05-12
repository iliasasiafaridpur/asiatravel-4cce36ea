import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { MODULES, formatDate } from "@/lib/modules";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, Search, Plus, Trash2, ArrowRight, Plane } from "lucide-react";

export const Route = createFileRoute("/invoice")({
  head: () => ({ meta: [{ title: "Invoice — Asia Tours and Travels" }] }),
  component: InvoicePage,
});

interface ServiceEntry {
  module: string;
  moduleKey: string;
  id: string;
  date: string;
  passenger: string;
  passport: string;
  mobile?: string;
  nationality?: string;
  airline?: string;
  pnr?: string;
  flightDate?: string;
  ticketClass?: string;
  status?: string;
  amount: number;
  received: number;
}

interface InvoiceItem {
  uid: string;
  description: string;
  detail?: string;
  date?: string;
  qty: number;
  rate: number;
}

const AGENCY_DEFAULT = {
  name: "ASIA TOURS AND TRAVELS",
  slogan: "Customer satisfaction is our primary goal.",
  address: "Bariplaza 4th Floor, Thana Road, Faridpur",
  phone: "+8801721-399599",
};

function genUid() {
  return Math.random().toString(36).slice(2, 10);
}

function InvoicePage() {
  const [allEntries, setAllEntries] = useState<ServiceEntry[]>([]);
  const [moduleFilter, setModuleFilter] = useState<string>("tickets");
  const [search, setSearch] = useState("");
  const [agency] = useState(AGENCY_DEFAULT);

  const [invoiceNo, setInvoiceNo] = useState<string>(
    "INV-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.floor(Math.random() * 900 + 100),
  );
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().slice(0, 10));

  const [bill, setBill] = useState({ name: "", passport: "", nationality: "Bangladeshi", mobile: "" });
  const [booking, setBooking] = useState({ pnr: "", ticketClass: "Economy", status: "Confirmed" });
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [received, setReceived] = useState<number>(0);
  const [discount, setDiscount] = useState<number>(0);
  const [notes, setNotes] = useState<string>("");

  useEffect(() => {
    (async () => {
      const all: ServiceEntry[] = [];
      const targets = MODULES.filter(
        (m) => !["agents", "vendors", "agency-ledger", "vendor-ledger"].includes(m.key),
      );
      await Promise.all(
        targets.map(async (m) => {
          const { data } = await supabase
            .from(m.table as never)
            .select("*")
            .order("created_at", { ascending: false })
            .limit(300);
          for (const r of ((data as unknown) as Record<string, unknown>[] | null) ?? []) {
            all.push({
              module: m.label,
              moduleKey: m.key,
              id: String(r[m.idColumn] ?? ""),
              date: String(r.entry_date ?? r.created_at ?? ""),
              passenger: String(r.passenger_name ?? "—"),
              passport: String(r.passport ?? ""),
              mobile: String(r.mobile ?? ""),
              airline: String(r.airline ?? ""),
              pnr: String(r.pnr ?? ""),
              flightDate: String(r.flight_date ?? ""),
              status: String(r.status ?? ""),
              amount: Number(r.sold_price ?? 0),
              received: Number(r.received ?? r.received_amount ?? 0),
            });
          }
        }),
      );
      setAllEntries(all);
    })();
  }, []);

  const filtered = useMemo(() => {
    let xs = allEntries;
    if (moduleFilter !== "all") xs = xs.filter((e) => e.moduleKey === moduleFilter);
    const q = search.trim().toLowerCase();
    if (q) xs = xs.filter((e) => `${e.id} ${e.passenger} ${e.passport}`.toLowerCase().includes(q));
    return xs.slice(0, 30);
  }, [allEntries, moduleFilter, search]);

  function loadEntry(e: ServiceEntry) {
    setBill({
      name: e.passenger,
      passport: e.passport,
      nationality: bill.nationality || "Bangladeshi",
      mobile: e.mobile || "",
    });
    setBooking({
      pnr: e.pnr || booking.pnr,
      ticketClass: booking.ticketClass,
      status: e.status || "Confirmed",
    });
    setItems((prev) => [
      ...prev,
      {
        uid: genUid(),
        description: `${e.module} — ${e.passenger}`,
        detail: e.airline ? `${e.airline}${e.pnr ? " · PNR " + e.pnr : ""}` : e.id,
        date: e.flightDate || e.date,
        qty: 1,
        rate: e.amount || 0,
      },
    ]);
    setReceived((r) => r + (e.received || 0));
  }

  function addBlankItem() {
    setItems((p) => [...p, { uid: genUid(), description: "", detail: "", date: "", qty: 1, rate: 0 }]);
  }
  function removeItem(uid: string) {
    setItems((p) => p.filter((i) => i.uid !== uid));
  }
  function updateItem(uid: string, patch: Partial<InvoiceItem>) {
    setItems((p) => p.map((i) => (i.uid === uid ? { ...i, ...patch } : i)));
  }

  const subtotal = items.reduce((s, i) => s + i.qty * i.rate, 0);
  const grandTotal = Math.max(0, subtotal - discount);
  const due = Math.max(0, grandTotal - received);
  const paid = received >= grandTotal && grandTotal > 0;

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-10">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Invoice</h1>
          <p className="text-sm text-muted-foreground">পেশাদার ইনভয়েচ — একাধিক সার্ভিস যোগ করুন</p>
        </div>
        <Button onClick={() => window.print()} className="gap-2">
          <Printer className="h-4 w-4" /> Print / PDF
        </Button>
      </div>

      {/* Picker */}
      <Card className="print:hidden">
        <CardContent className="p-3 sm:p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label>Invoice No</Label>
              <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label>Invoice Date</Label>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label>Service Module</Label>
              <Select value={moduleFilter} onValueChange={setModuleFilter}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">সব Module</SelectItem>
                  {MODULES.filter((m) => !["agents", "vendors", "agency-ledger", "vendor-ledger"].includes(m.key)).map(
                    (m) => (
                      <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ID / Passenger / Passport দিয়ে খুঁজুন এবং Add করুন..."
              className="pl-8"
            />
          </div>
          <ul className="max-h-56 overflow-auto rounded-md border divide-y divide-border">
            {filtered.length === 0 && <li className="p-3 text-sm text-muted-foreground">কোনো এন্ট্রি নেই</li>}
            {filtered.map((e) => (
              <li key={e.moduleKey + e.id} className="flex items-center justify-between gap-2 p-2.5 hover:bg-accent">
                <div className="text-sm min-w-0">
                  <div className="font-medium truncate">{e.passenger}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    <span className="font-mono">{e.id}</span> · {e.module}
                    {e.amount ? ` · ${e.amount.toLocaleString()}৳` : ""}
                  </div>
                </div>
                <Button size="sm" variant="outline" className="gap-1" onClick={() => loadEntry(e)}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </li>
            ))}
          </ul>

          {/* Bill-to / Booking quick edit */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">Passenger Info</div>
              <Input placeholder="Passenger Name" value={bill.name} onChange={(e) => setBill({ ...bill, name: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Passport No" value={bill.passport} onChange={(e) => setBill({ ...bill, passport: e.target.value })} />
                <Input placeholder="Nationality" value={bill.nationality} onChange={(e) => setBill({ ...bill, nationality: e.target.value })} />
              </div>
              <Input placeholder="Mobile" value={bill.mobile} onChange={(e) => setBill({ ...bill, mobile: e.target.value })} />
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">Booking Details</div>
              <Input placeholder="PNR / Booking Reference" value={booking.pnr} onChange={(e) => setBooking({ ...booking, pnr: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Class" value={booking.ticketClass} onChange={(e) => setBooking({ ...booking, ticketClass: e.target.value })} />
                <Input placeholder="Status" value={booking.status} onChange={(e) => setBooking({ ...booking, status: e.target.value })} />
              </div>
            </div>
          </div>

          {/* Items editor */}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-muted-foreground">Invoice Items</div>
              <Button size="sm" variant="outline" className="gap-1" onClick={addBlankItem}>
                <Plus className="h-3.5 w-3.5" /> Add Item
              </Button>
            </div>
            <div className="space-y-2">
              {items.length === 0 && (
                <p className="text-xs text-muted-foreground p-2 border border-dashed rounded">
                  কোনো আইটেম নেই — উপরের লিস্ট থেকে Add করুন বা "Add Item" দিন
                </p>
              )}
              {items.map((it) => (
                <div key={it.uid} className="grid grid-cols-12 gap-2 items-start">
                  <Input
                    className="col-span-12 sm:col-span-4"
                    placeholder="Description"
                    value={it.description}
                    onChange={(e) => updateItem(it.uid, { description: e.target.value })}
                  />
                  <Input
                    className="col-span-12 sm:col-span-3"
                    placeholder="Detail (Airline / Route)"
                    value={it.detail ?? ""}
                    onChange={(e) => updateItem(it.uid, { detail: e.target.value })}
                  />
                  <Input
                    className="col-span-6 sm:col-span-2"
                    type="date"
                    value={it.date ?? ""}
                    onChange={(e) => updateItem(it.uid, { date: e.target.value })}
                  />
                  <Input
                    className="col-span-3 sm:col-span-1"
                    type="number"
                    placeholder="Qty"
                    value={it.qty}
                    onChange={(e) => updateItem(it.uid, { qty: Number(e.target.value) || 0 })}
                  />
                  <Input
                    className="col-span-3 sm:col-span-1"
                    type="number"
                    placeholder="Rate"
                    value={it.rate}
                    onChange={(e) => updateItem(it.uid, { rate: Number(e.target.value) || 0 })}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="col-span-12 sm:col-span-1 text-destructive hover:text-destructive"
                    onClick={() => removeItem(it.uid)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div>
              <Label>Discount</Label>
              <Input type="number" value={discount} onChange={(e) => setDiscount(Number(e.target.value) || 0)} className="mt-1.5" />
            </div>
            <div>
              <Label>Received</Label>
              <Input type="number" value={received} onChange={(e) => setReceived(Number(e.target.value) || 0)} className="mt-1.5" />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional remarks" className="mt-1.5" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* === PRINTABLE INVOICE === */}
      <div className="invoice-print bg-white text-slate-900 mx-auto shadow-lg print:shadow-none print:rounded-none rounded-lg overflow-hidden border border-slate-200 print:border-0">
        <div className="flex">
          {/* Left accent bar */}
          <div className="w-2 shrink-0 bg-gradient-to-b from-[#0b2545] via-[#13315c] to-[#c8a45c]" />

          <div className="flex-1 p-8 sm:p-10">
            {/* Header */}
            <div className="flex justify-between items-start gap-6 border-b border-slate-200 pb-6">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-md bg-gradient-to-br from-[#0b2545] to-[#c8a45c] flex items-center justify-center text-white">
                    <Plane className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-[#0b2545]">{agency.name}</h2>
                    <p className="text-[11px] italic text-[#c8a45c] font-medium">"{agency.slogan}"</p>
                  </div>
                </div>
                <div className="mt-3 text-xs text-slate-600 space-y-0.5">
                  <p>{agency.address}</p>
                  <p>📞 {agency.phone}</p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-3xl sm:text-4xl font-black tracking-widest text-[#0b2545]">INVOICE</p>
                <p className="font-mono text-sm mt-1">{invoiceNo}</p>
                <p className="text-xs text-slate-500">Date: {formatDate(invoiceDate)}</p>
              </div>
            </div>

            {/* Cards: Passenger / Booking */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
              <div className="rounded-lg border border-slate-200 p-4">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Passenger Info</p>
                <p className="text-base font-bold mt-1">{bill.name || "—"}</p>
                <div className="text-xs text-slate-600 mt-1 space-y-0.5">
                  {bill.passport && <p>Passport: <span className="font-mono">{bill.passport}</span></p>}
                  {bill.nationality && <p>Nationality: {bill.nationality}</p>}
                  {bill.mobile && <p>Mobile: {bill.mobile}</p>}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-4 bg-slate-50">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Booking Details</p>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  <div>
                    <p className="text-[10px] text-slate-500">PNR</p>
                    <p className="font-mono font-bold text-sm">{booking.pnr || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500">Class</p>
                    <p className="font-semibold text-sm">{booking.ticketClass || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500">Status</p>
                    <p className="font-semibold text-sm">{booking.status || "—"}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Items table */}
            <div className="mt-6 rounded-lg overflow-hidden border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#0b2545] text-white">
                    <th className="text-left p-2.5 text-xs font-semibold uppercase tracking-wider">#</th>
                    <th className="text-left p-2.5 text-xs font-semibold uppercase tracking-wider">Service / Flight & Airline</th>
                    <th className="text-left p-2.5 text-xs font-semibold uppercase tracking-wider">Route / Detail</th>
                    <th className="text-left p-2.5 text-xs font-semibold uppercase tracking-wider">Date</th>
                    <th className="text-right p-2.5 text-xs font-semibold uppercase tracking-wider">Qty</th>
                    <th className="text-right p-2.5 text-xs font-semibold uppercase tracking-wider">Rate</th>
                    <th className="text-right p-2.5 text-xs font-semibold uppercase tracking-wider">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr><td colSpan={7} className="p-6 text-center text-slate-400 text-xs">No items</td></tr>
                  )}
                  {items.map((it, idx) => (
                    <tr key={it.uid} className="border-t border-slate-200">
                      <td className="p-2.5 text-slate-500">{idx + 1}</td>
                      <td className="p-2.5 font-medium">{it.description || "—"}</td>
                      <td className="p-2.5 text-slate-600">
                        {it.detail ? (
                          <span className="inline-flex items-center gap-1">
                            {it.detail}
                            <ArrowRight className="h-3 w-3 text-[#c8a45c]" />
                          </span>
                        ) : "—"}
                      </td>
                      <td className="p-2.5 text-slate-600">{it.date ? formatDate(it.date) : "—"}</td>
                      <td className="p-2.5 text-right tabular-nums">{it.qty}</td>
                      <td className="p-2.5 text-right tabular-nums">{it.rate.toLocaleString()}</td>
                      <td className="p-2.5 text-right tabular-nums font-semibold">{(it.qty * it.rate).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="mt-6 flex flex-col sm:flex-row justify-between gap-6">
              <div className="flex-1 text-xs text-slate-600 space-y-1">
                {notes && (
                  <>
                    <p className="font-semibold text-slate-700">Notes:</p>
                    <p>{notes}</p>
                  </>
                )}
              </div>
              <div className="sm:w-72 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Subtotal</span>
                  <span className="tabular-nums">{subtotal.toLocaleString()}৳</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Discount</span>
                    <span className="tabular-nums">- {discount.toLocaleString()}৳</span>
                  </div>
                )}
                <div className="flex justify-between items-center bg-gradient-to-r from-[#0b2545] to-[#13315c] text-white px-3 py-2.5 rounded-md">
                  <span className="text-xs uppercase tracking-wider font-semibold">Grand Total (Net)</span>
                  <span className="text-lg font-black tabular-nums">{grandTotal.toLocaleString()}৳</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Received</span>
                  <span className="tabular-nums">{received.toLocaleString()}৳</span>
                </div>
                <div className="flex justify-between text-sm font-semibold">
                  <span className="text-slate-700">Due</span>
                  <span className="tabular-nums">{due.toLocaleString()}৳</span>
                </div>
                <div className="pt-1">
                  {paid ? (
                    <span className="inline-block px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold tracking-wider">
                      ● PAYMENT RECEIVED
                    </span>
                  ) : (
                    <span className="inline-block px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-[11px] font-bold tracking-wider">
                      ● PAYMENT DUE
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-8 pt-4 border-t border-slate-200 text-center">
              <p className="text-[11px] text-slate-500 italic">
                This is a system-generated document and requires no physical signature.
              </p>
              <p className="text-[10px] text-slate-400 mt-1">Thank you for choosing {agency.name}.</p>
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
