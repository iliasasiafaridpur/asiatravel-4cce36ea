import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, statusBadgeClass, type ModuleSchema } from "@/lib/modules";
import { ReceiptText, Layers, FileText, Clock } from "lucide-react";

type Row = Record<string, unknown> & { id: string };

type Receipt = {
  id: string;
  entry_date: string | null;
  amount: number | null;
  method: string | null;
  receipt_id: string | null;
  remarks: string | null;
  received_by_name: string | null;
  approval_status: string | null;
  service_type: string | null;
  created_at: string | null;
};

type Extra = {
  id: string;
  service_name: string;
  service_price: number;
  vendor_cost: number;
  vendor_name: string | null;
  received_amount: number;
  discount_amount: number;
  notes: string | null;
  entry_date: string | null;
};

const DASH = "—";
const fmtMoney = (n: number) => `৳${Number(n || 0).toLocaleString()}`;

function fmtDateTime(v: unknown): string {
  if (!v) return DASH;
  const d = new Date(String(v));
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function fieldValue(row: Row, name: string, type: string): string {
  const v = row[name];
  if (v === null || v === undefined || v === "") return DASH;
  if (type === "date") return formatDate(v as string | null) || DASH;
  if (type === "number") return Number(v).toLocaleString();
  if (type === "boolean") return v ? "হ্যাঁ" : "না";
  return String(v);
}

export function RowDetailDrawer({
  open,
  onOpenChange,
  row,
  module,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  row: Row | null;
  module: ModuleSchema;
}) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [extras, setExtras] = useState<Extra[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !row?.id) {
      setReceipts([]);
      setExtras([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const refId = String(row[module.idColumn] ?? "").trim();
      const orFilter = refId
        ? `service_row_id.eq.${row.id},ref_id.eq.${refId}`
        : `service_row_id.eq.${row.id}`;
      const [rcpt, ext] = await Promise.all([
        supabase
          .from("payment_receipts")
          .select("id,entry_date,amount,method,receipt_id,remarks,received_by_name,approval_status,service_type,created_at")
          .or(orFilter)
          .order("entry_date", { ascending: true }),
        supabase
          .from("extra_services")
          .select("id,service_name,service_price,vendor_cost,vendor_name,received_amount,discount_amount,notes,entry_date")
          .eq("source_table", module.table)
          .eq("source_id", row.id)
          .order("entry_date", { ascending: true }),
      ]);
      if (cancelled) return;
      // de-dupe receipts (or filter may return same row twice)
      const seen = new Set<string>();
      const list = ((rcpt.data as Receipt[]) ?? []).filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
      setReceipts(list);
      setExtras((ext.data as Extra[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, row?.id, module.idColumn, module.table]);

  if (!row) return null;

  const computed = module.computed ?? [];
  const totalReceived = receipts.reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary" />
            {String(row.passenger_name ?? row.party_name ?? "বিস্তারিত")}
            <Badge variant="outline" className="font-mono text-[11px]">
              {String(row[module.idColumn] ?? "")}
            </Badge>
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 space-y-5">
            {/* ===== Financial summary ===== */}
            {computed.length > 0 && (
              <section className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {computed.map((c) => {
                  const v = c.compute(row);
                  return (
                    <div key={c.name} className="rounded-md border bg-muted/40 px-2.5 py-2">
                      <div className="text-[11px] text-muted-foreground">{c.label}</div>
                      <div className={`text-sm font-semibold tabular-nums ${v < 0 ? "text-rose-500" : ""}`}>
                        {fmtMoney(v)}
                      </div>
                    </div>
                  );
                })}
              </section>
            )}

            {/* ===== Entry / current field data ===== */}
            <section>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold mb-2">
                <FileText className="h-3.5 w-3.5 text-primary" /> এন্ট্রি ও আপডেট তথ্য
              </h3>
              <div className="rounded-md border divide-y">
                {module.fields.map((f) => (
                  <div key={f.name} className="grid grid-cols-[40%_60%] gap-2 px-3 py-1.5 text-sm">
                    <span className="text-muted-foreground">{f.label}</span>
                    <span className="font-medium break-words">
                      {f.name === "status" ? (
                        <Badge variant="outline" className={statusBadgeClass(String(row[f.name] ?? ""))}>
                          {String(row[f.name] ?? DASH)}
                        </Badge>
                      ) : (
                        fieldValue(row, f.name, f.type)
                      )}
                    </span>
                  </div>
                ))}
                {row.cancelled ? (
                  <div className="grid grid-cols-[40%_60%] gap-2 px-3 py-1.5 text-sm">
                    <span className="text-muted-foreground">বাতিল</span>
                    <span className="font-medium text-rose-500">
                      ❌ {formatDate(row.cancel_date as string | null)} — {String(row.cancel_reason ?? "")}
                    </span>
                  </div>
                ) : null}
              </div>
            </section>

            {/* ===== Record timestamps ===== */}
            <section>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold mb-2">
                <Clock className="h-3.5 w-3.5 text-primary" /> রেকর্ড তথ্য
              </h3>
              <div className="rounded-md border divide-y text-sm">
                <div className="grid grid-cols-[40%_60%] gap-2 px-3 py-1.5">
                  <span className="text-muted-foreground">এন্ট্রি তারিখ</span>
                  <span className="font-medium">{formatDate(row.entry_date as string | null) || DASH}</span>
                </div>
                <div className="grid grid-cols-[40%_60%] gap-2 px-3 py-1.5">
                  <span className="text-muted-foreground">তৈরি হয়েছে</span>
                  <span className="font-medium">{fmtDateTime(row.created_at)}</span>
                </div>
                <div className="grid grid-cols-[40%_60%] gap-2 px-3 py-1.5">
                  <span className="text-muted-foreground">সর্বশেষ আপডেট</span>
                  <span className="font-medium">{fmtDateTime(row.updated_at)}</span>
                </div>
              </div>
            </section>

            {/* ===== Payments / transactions ===== */}
            <section>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold mb-2">
                <ReceiptText className="h-3.5 w-3.5 text-primary" /> লেনদেন / পেমেন্ট
                {receipts.length > 0 && (
                  <span className="text-xs text-muted-foreground">({receipts.length} টি · মোট {fmtMoney(totalReceived)})</span>
                )}
              </h3>
              {loading ? (
                <p className="text-sm text-muted-foreground px-1">লোড হচ্ছে…</p>
              ) : receipts.length === 0 ? (
                <p className="text-sm text-muted-foreground px-1">কোনো পেমেন্ট রেকর্ড নেই।</p>
              ) : (
                <div className="space-y-2">
                  {receipts.map((r) => (
                    <div key={r.id} className="rounded-md border px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                          {fmtMoney(Number(r.amount || 0))}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatDate(r.entry_date)}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {r.method && <span>মাধ্যম: {r.method}</span>}
                        {r.received_by_name && <span>গ্রহীতা: {r.received_by_name}</span>}
                        {r.receipt_id && <span className="font-mono">#{r.receipt_id}</span>}
                        {r.approval_status && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0">{r.approval_status}</Badge>
                        )}
                      </div>
                      {r.remarks && <div className="mt-0.5 text-xs">{r.remarks}</div>}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ===== Extra services ===== */}
            {extras.length > 0 && (
              <section>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold mb-2">
                  <Layers className="h-3.5 w-3.5 text-primary" /> অতিরিক্ত সার্ভিস ({extras.length} টি)
                </h3>
                <div className="space-y-2">
                  {extras.map((e) => (
                    <div key={e.id} className="rounded-md border px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{e.service_name}</span>
                        <span className="text-xs text-muted-foreground">{formatDate(e.entry_date)}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span>বিল: {fmtMoney(e.service_price)}</span>
                        <span>জমা: {fmtMoney(e.received_amount)}</span>
                        {e.vendor_cost ? <span>খরচ: {fmtMoney(e.vendor_cost)}</span> : null}
                        {e.vendor_name ? <span>ভেন্ডর: {e.vendor_name}</span> : null}
                      </div>
                      {e.notes && <div className="mt-0.5 text-xs">{e.notes}</div>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <Separator />
            <p className="text-[11px] text-muted-foreground text-center pb-2">
              এই রো-এর সাথে সংশ্লিষ্ট সকল তথ্য এক নজরে।
            </p>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
