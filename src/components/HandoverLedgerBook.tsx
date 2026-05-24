import { useEffect, useId, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatDate, formatDateTime } from "@/lib/modules";
import { BookOpen, CheckCircle2, Clock, Search, User2, Users } from "lucide-react";

const fmt = (n: number) => `৳ ${(Number(n) || 0).toLocaleString()}`;

type Handover = {
  id: string;
  handover_id: string;
  entry_date: string;
  closing_date: string | null;
  from_user: string | null;
  from_name: string | null;
  to_name: string | null;
  submitted_amount: number | null;
  confirmed_amount: number | null;
  amount: number;
  status: string;
  remarks: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
};

type Receipt = {
  id: string;
  receipt_id: string;
  entry_date: string;
  passenger_name: string;
  amount: number;
  service_type: string;
  service_table: string | null;
  service_row_id: string | null;
  ref_id: string | null;
  approval_status: string;
  handover_id: string | null;
  received_by: string | null;
  received_by_name: string | null;
  created_at: string;
};

type ServiceInfo = {
  country: string | null;
  vendor: string | null;
  passport: string | null;
  sold_price: number;
  discount: number;
};

const SERVICE_TABLES = [
  { table: "saudi_visas", country: () => "Saudi Arabia", vendorField: "vendor_bought", soldField: "sold_price", discountField: "discount_amount" },
  { table: "kuwait_visas", country: () => "Kuwait", vendorField: "vendor_bought", soldField: "sold_price", discountField: "discount_amount" },
  { table: "bmet_cards", country: "country_name", vendorField: "vendor_bought", soldField: "sold_price", discountField: "discount_amount" },
  { table: "tickets", country: "trip_road", vendorField: "vendor_bought", soldField: "sold_price", discountField: "discount_amount" },
  { table: "agency_ledger", country: "country_route", vendorField: "agent_name", soldField: "total_bill", discountField: "discount_amount" },
] as const;

export function HandoverLedgerInline({
  mode,
  title,
  enabled = true,
  approveAction,
  onlyPending = false,
  excludePending = false,
}: {
  mode: "mine" | "to-me";
  title?: string;
  enabled?: boolean;
  approveAction?: { busyId: string | null; onApprove: (receipt: { id: string; handover_id: string | null; approval_status: string }) => void };
  onlyPending?: boolean;
  excludePending?: boolean;
}) {
  const { user } = useCurrentUser();
  const instanceId = useId();
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [receiptsByH, setReceiptsByH] = useState<Record<string, Receipt[]>>({});
  const [receiptsByService, setReceiptsByService] = useState<Record<string, Receipt[]>>({});
  const [serviceMap, setServiceMap] = useState<Record<string, ServiceInfo>>({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!enabled || !user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      let q = supabase
        .from("cash_handovers")
        .select("id,handover_id,entry_date,closing_date,from_user,from_name,to_name,submitted_amount,confirmed_amount,amount,status,remarks,approved_at,approved_by,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (mode === "mine") q = q.eq("from_user", user.id);
      const { data: hvData } = await q;
      const hvs = (hvData ?? []) as Handover[];

      const ids = hvs.map((h) => h.id);
      let recs: Receipt[] = [];
      if (ids.length > 0) {
        const { data: recData } = await supabase
          .from("payment_receipts")
          .select("id,receipt_id,entry_date,passenger_name,amount,service_type,service_table,service_row_id,ref_id,approval_status,handover_id,received_by,received_by_name,created_at")
          .in("handover_id", ids)
          .not("source", "eq", "discount");
        recs = (recData ?? []) as Receipt[];
      }

      const byH: Record<string, Receipt[]> = {};
      for (const r of recs) {
        if (!r.handover_id) continue;
        (byH[r.handover_id] ??= []).push(r);
      }

      const svcKeys = new Set<string>();
      const byTable: Record<string, Set<string>> = {};
      for (const r of recs) {
        if (r.service_table && r.service_row_id) {
          svcKeys.add(`${r.service_table}:${r.service_row_id}`);
          (byTable[r.service_table] ??= new Set()).add(r.service_row_id);
        }
      }

      const byService: Record<string, Receipt[]> = {};
      if (svcKeys.size > 0) {
        const tables = Array.from(new Set(Array.from(svcKeys).map((k) => k.split(":")[0])));
        for (const t of tables) {
          const rowIds = Array.from(byTable[t] ?? []);
          if (rowIds.length === 0) continue;
          const { data: more } = await supabase
            .from("payment_receipts")
            .select("id,receipt_id,entry_date,passenger_name,amount,service_type,service_table,service_row_id,ref_id,approval_status,handover_id,received_by,received_by_name,created_at")
            .eq("service_table", t)
            .in("service_row_id", rowIds)
            .not("source", "eq", "discount");
          for (const r of ((more ?? []) as Receipt[])) {
            if (!r.service_table || !r.service_row_id) continue;
            (byService[`${r.service_table}:${r.service_row_id}`] ??= []).push(r);
          }
        }
      }

      const svcMap: Record<string, ServiceInfo> = {};
      await Promise.all(
        SERVICE_TABLES.map(async (cfg) => {
          const rowIds = Array.from(byTable[cfg.table] ?? []);
          if (rowIds.length === 0) return;
          const cols = ["id", "passport"];
          if (typeof cfg.country === "string") cols.push(cfg.country);
          cols.push(cfg.vendorField, cfg.soldField, cfg.discountField);
          const { data } = await supabase
            .from(cfg.table as never)
            .select(cols.join(","))
            .in("id", rowIds);
          for (const row of (data ?? []) as Array<Record<string, unknown>>) {
            svcMap[`${cfg.table}:${row.id as string}`] = {
              country: typeof cfg.country === "function"
                ? cfg.country()
                : (row[cfg.country] as string | null) ?? null,
              vendor: (row[cfg.vendorField] as string | null) ?? null,
              passport: (row.passport as string | null) ?? null,
              sold_price: Number(row[cfg.soldField] ?? 0),
              discount: Number(row[cfg.discountField] ?? 0),
            };
          }
        })
      );

      if (cancelled) return;
      setHandovers(hvs);
      setReceiptsByH(byH);
      setReceiptsByService(byService);
      setServiceMap(svcMap);
      setLoading(false);
    })();

    const ch = supabase
      .channel(`handover-book-${mode}-${user.id}-${instanceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_handovers" }, () => {
        if (!cancelled) setReloadTick((t) => t + 1);
      })
      .subscribe();

    return () => { cancelled = true; void supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, user?.id, mode, reloadTick]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return handovers;
    return handovers.filter((h) => {
      if (h.handover_id?.toLowerCase().includes(q)) return true;
      if ((h.from_name ?? "").toLowerCase().includes(q)) return true;
      const recs = receiptsByH[h.id] ?? [];
      return recs.some((r) => {
        if (r.passenger_name?.toLowerCase().includes(q)) return true;
        if ((r.ref_id ?? "").toLowerCase().includes(q)) return true;
        if ((r.receipt_id ?? "").toLowerCase().includes(q)) return true;
        const sk = r.service_table && r.service_row_id ? `${r.service_table}:${r.service_row_id}` : "";
        const info = sk ? serviceMap[sk] : undefined;
        if (info?.passport?.toLowerCase().includes(q)) return true;
        if (info?.vendor?.toLowerCase().includes(q)) return true;
        return false;
      });
    });
  }, [handovers, search, receiptsByH, serviceMap]);

  return (
    <div className="flex flex-col gap-3">
      {title && (
        <div className="flex items-center gap-2 text-base font-semibold">
          <BookOpen className="h-5 w-5" />
          {title}
        </div>
      )}
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="যাত্রীর নাম, পাসপোর্ট, ভেন্ডর, রেফারেন্স ID, handover ID, বা স্টাফ…"
          className="h-9 pl-7"
        />
      </div>
      <div className="space-y-3">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">লোড হচ্ছে…</div>
        ) : (() => {
          const visible = onlyPending
            ? filtered.filter((h) => (h.status ?? "pending") === "pending")
            : excludePending
              ? filtered.filter((h) => (h.status ?? "pending") !== "pending")
              : filtered;
          if (visible.length === 0) {
            return <div className="p-8 text-center text-sm text-muted-foreground">কোনো record নেই</div>;
          }
          return visible.map((h) => (
            <HandoverCard
              key={h.id}
              handover={h}
              receipts={receiptsByH[h.id] ?? []}
              receiptsByService={receiptsByService}
              serviceMap={serviceMap}
              mode={mode}
              approveAction={approveAction}
            />
          ));
        })()}
      </div>
    </div>
  );
}

export function HandoverLedgerBook({
  open,
  onOpenChange,
  mode,
  title,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "mine" | "to-me";
  title?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            {title ?? (mode === "mine" ? "আমার হিসাব বই (Handover Book)" : "স্টাফ থেকে রিসিভ করা ক্যাশের হিস্টোরি")}
          </DialogTitle>
          <DialogDescription>
            প্রতিটি কার্ডে দেখুন — কোন কোন যাত্রীর জন্য, কত টাকা, কখন বুঝিয়ে দেওয়া/বুঝে নেওয়া হয়েছে।
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto pr-1">
          <HandoverLedgerInline mode={mode} enabled={open} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HandoverCard({
  handover, receipts, receiptsByService, serviceMap, mode, approveAction,
}: {
  handover: Handover;
  receipts: Receipt[];
  receiptsByService: Record<string, Receipt[]>;
  serviceMap: Record<string, ServiceInfo>;
  mode: "mine" | "to-me";
  approveAction?: { busyId: string | null; onApprove: (receipt: Receipt) => void };
}) {
  const status = handover.status ?? "pending";
  const submitted = Number(handover.submitted_amount ?? handover.amount ?? 0);
  const confirmed = Number(handover.confirmed_amount ?? 0);
  const totalReceipts = receipts.reduce((s, r) => s + Number(r.amount || 0), 0);
  const isPending = status === "pending";

  // Highlight listener for cross-instance scroll-to (পূর্বের জমা click)
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (receipts.some((r) => r.id === id)) {
        setHighlightId(id);
        setTimeout(() => {
          const el = document.getElementById(`receipt-row-${id}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
        setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 4000);
      }
    };
    window.addEventListener("ledger-highlight-receipt", handler);
    return () => window.removeEventListener("ledger-highlight-receipt", handler);
  }, [receipts]);

  const scrollToReceipt = (id: string) => {
    window.dispatchEvent(new CustomEvent("ledger-highlight-receipt", { detail: id }));
  };

  const statusBadge =
    status === "approved" ? (
      <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 border gap-1">
        <CheckCircle2 className="h-3 w-3" /> এমডি বুঝে নিয়েছেন
      </Badge>
    ) : status === "pending" ? (
      <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 border gap-1">
        <Clock className="h-3 w-3" /> এমডিকে পাঠানো হয়েছে
      </Badge>
    ) : (
      <Badge className="bg-rose-500/15 text-rose-600 border-rose-500/30 border">{status}</Badge>
    );

  const cutoff = new Date(handover.created_at).getTime();
  const firstPendingReceipt = receipts.find((r) => r.approval_status !== "approved") ?? receipts[0];

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-muted/40 px-4 py-2.5 border-b flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {statusBadge}
          <span className="font-mono text-[11px] text-muted-foreground">{handover.handover_id}</span>
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
          <span>📅 {formatDateTime(handover.created_at)}</span>
          {mode === "to-me" ? (
            <span className="flex items-center gap-1"><User2 className="h-3 w-3" /> স্টাফ: <b className="text-foreground">{handover.from_name ?? "—"}</b></span>
          ) : (
            <span className="flex items-center gap-1"><Users className="h-3 w-3" /> গ্রহীতা: <b className="text-foreground">{handover.to_name ?? "MD Sir"}</b></span>
          )}
        </div>
        <div className="text-base font-bold tabular-nums text-primary">{fmt(submitted)}</div>
      </div>

      {status === "approved" && handover.approved_at && (
        <div className="px-4 py-1.5 bg-emerald-500/5 text-[11px] text-emerald-700 dark:text-emerald-300 border-b border-emerald-500/20">
          ✅ তারিখ: {formatDate(handover.approved_at)} | সময়: {new Date(handover.approved_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} | 👤 গ্রহীতা: {handover.to_name ?? "MD Sir"}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/30">
            <tr className="text-left">
              <th className="px-3 py-1.5 font-semibold">যাত্রী</th>
              <th className="px-3 py-1.5 font-semibold text-right">মোট বিল</th>
              <th className="px-3 py-1.5 font-semibold text-right">পূর্বের জমা</th>
              <th className="px-3 py-1.5 font-semibold text-right">এই বারের জমা</th>
              <th className="px-3 py-1.5 font-bold text-right text-sm">বাকি</th>
              {approveAction && <th className="px-3 py-1.5 font-semibold text-center w-[300px]">অনুমোদন</th>}
            </tr>
          </thead>
          <tbody>
            {receipts.length === 0 ? (
              <tr><td colSpan={approveAction ? 6 : 5} className="px-3 py-4 text-center text-muted-foreground">কোনো passenger receipt নেই</td></tr>
            ) : receipts.map((r) => {
              const sk = r.service_table && r.service_row_id ? `${r.service_table}:${r.service_row_id}` : "";
              const info = sk ? serviceMap[sk] : undefined;
              const allForSvc = sk ? (receiptsByService[sk] ?? []) : [];
              const past = allForSvc.filter((x) => x.id !== r.id && new Date(x.created_at).getTime() < cutoff);
              const future = allForSvc.filter((x) => x.id !== r.id && new Date(x.created_at).getTime() > cutoff);
              const previousPaid = past.reduce((s, x) => s + Number(x.amount || 0), 0);
              const futurePaid = future.reduce((s, x) => s + Number(x.amount || 0), 0);
              const lastPast = past.length
                ? past.reduce((a, b) => (new Date(a.created_at).getTime() > new Date(b.created_at).getTime() ? a : b))
                : null;
              const lastFuture = future.length
                ? future.reduce((a, b) => (new Date(a.created_at).getTime() < new Date(b.created_at).getTime() ? a : b))
                : null;
              const totalPaidIncl = allForSvc.reduce((s, x) => s + Number(x.amount || 0), 0);
              const bill = info?.sold_price ?? 0;
              const discount = info?.discount ?? 0;
              const due = bill > 0 ? Math.max(0, bill - totalPaidIncl - discount) : 0;
              const dueAfterThis = bill > 0 ? Math.max(0, bill - (previousPaid + Number(r.amount || 0)) - discount) : 0;
              const isHighlighted = highlightId === r.id;

              return (
                <tr
                  key={r.id}
                  id={`receipt-row-${r.id}`}
                  className={`border-t align-top transition-colors ${isHighlighted ? "bg-yellow-200 dark:bg-yellow-500/30 ring-2 ring-yellow-500" : "hover:bg-muted/20"}`}
                >
                  {/* যাত্রী */}
                  <td className="px-3 py-2">
                    <div className="font-semibold">{r.passenger_name || "—"}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {r.service_type}
                      {info?.country ? ` · ${info.country}` : ""}
                      {info?.vendor ? ` (${info.vendor})` : ""}
                    </div>
                    {info?.passport && (
                      <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{info.passport}</div>
                    )}
                    {r.ref_id && (
                      <div className="text-[10px] text-muted-foreground font-mono">{r.ref_id}</div>
                    )}
                  </td>
                  {/* মোট বিল */}
                  <td className="px-3 py-2 text-right">
                    {bill > 0 ? (
                      <>
                        <div className="font-bold tabular-nums">{fmt(bill)}</div>
                        {discount > 0 && (
                          <div className="text-[10px] tabular-nums text-emerald-600">{fmt(discount)} (ডিসকাউন্ট)</div>
                        )}
                        {due > 0.005 && (
                          <div className="text-[10px] tabular-nums text-rose-600">বাকি: {fmt(due)}</div>
                        )}
                        {due <= 0.005 && (
                          <div className="text-[10px] text-emerald-600">✓ সম্পূর্ণ পরিশোধিত</div>
                        )}
                      </>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  {/* পূর্বের জমা */}
                  <td className="px-3 py-2 text-right">
                    {previousPaid > 0 ? (
                      <button
                        type="button"
                        onClick={() => lastPast && scrollToReceipt(lastPast.id)}
                        className="text-right hover:underline focus:outline-none focus:ring-1 focus:ring-sky-500 rounded px-1"
                        title="পূর্বের জমা দেখাও"
                      >
                        <div className="font-semibold tabular-nums text-sky-600 dark:text-sky-400">{fmt(previousPaid)}</div>
                        {lastPast && (
                          <div className="text-[10px] text-sky-600">{formatDate(lastPast.entry_date)}</div>
                        )}
                        {past.length > 1 && (
                          <div className="text-[10px] text-muted-foreground">+{past.length - 1} আরও</div>
                        )}
                      </button>
                    ) : <span className="text-[11px] text-muted-foreground">— নতুন বিক্রি —</span>}
                  </td>
                  {/* এই বারের জমা */}
                  <td className="px-3 py-2 text-right tabular-nums">
                    <b className="text-emerald-700 dark:text-emerald-400">{fmt(r.amount)}</b>
                    {r.received_by_name && (
                      <div className="text-[10px] text-muted-foreground font-normal mt-0.5">আদায়কারী: {r.received_by_name}</div>
                    )}
                    {r.created_at && (
                      <div className="text-[10px] text-muted-foreground font-normal">{formatDateTime(r.created_at)}</div>
                    )}
                  </td>
                  {/* বাকি (after this handover) — bolder + larger */}
                  <td className="px-3 py-2 text-right tabular-nums text-sm font-bold">
                    {bill > 0 ? (
                      dueAfterThis <= 0.005 ? (
                        <span className="text-emerald-600 text-base">✓</span>
                      ) : (
                        <>
                          <div className="text-rose-600 text-sm font-extrabold">{fmt(dueAfterThis)}</div>
                          {futurePaid > 0 && lastFuture && (
                            <div className="text-[10px] text-emerald-600 font-semibold mt-0.5">
                              জমা: {fmt(futurePaid)}
                              <div className="text-[10px]">{formatDate(lastFuture.entry_date)}</div>
                            </div>
                          )}
                        </>
                      )
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  {approveAction && (
                    <td className="px-3 py-2 text-center">
                      {r.approval_status === "approved" ? (
                        <div className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approved
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                          <Clock className="h-3.5 w-3.5" /> অপেক্ষমাণ
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            <tr className="border-t bg-muted/30 font-semibold">
              <td className="px-3 py-1.5 text-right" colSpan={3}>মোট ({receipts.length} যাত্রী)</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{fmt(totalReceipts)}</td>
              <td className="px-3 py-1.5" />
              {approveAction && <td className="px-3 py-1.5 text-right">
                {approveAction && isPending && firstPendingReceipt && (
                  <Button
                    size="sm"
                    onClick={() => approveAction.onApprove(firstPendingReceipt)}
                    disabled={approveAction.busyId === firstPendingReceipt.id || !firstPendingReceipt.handover_id}
                    className="w-2/3 min-w-[190px] bg-emerald-600 hover:bg-emerald-700 text-white gap-2 font-bold shadow-md"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    🟢 টাকা পেলাম ({fmt(submitted)})
                  </Button>
                )}
              </td>}
            </tr>
          </tbody>
        </table>
      </div>

      {(handover.remarks || (status === "approved" && confirmed > 0 && confirmed !== submitted)) && (
        <div className="px-4 py-2 border-t bg-muted/20 text-[11px] text-muted-foreground space-y-0.5">
          {confirmed > 0 && confirmed !== submitted && (
            <div>Confirmed: <b className="text-foreground">{fmt(confirmed)}</b> · Variance: <b className={confirmed - submitted > 0 ? "text-emerald-600" : "text-rose-600"}>{confirmed - submitted > 0 ? "+" : ""}{fmt(confirmed - submitted)}</b></div>
          )}
          {handover.remarks && <div>📝 {handover.remarks}</div>}
        </div>
      )}
    </div>
  );
}

export function HandoverLedgerButton({
  mode, label,
}: { mode: "mine" | "to-me"; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <BookOpen className="h-3.5 w-3.5" />
        {label ?? (mode === "mine" ? "আমার হিসাব বই" : "ক্যাশ রিসিভ হিস্টোরি")}
      </Button>
      <HandoverLedgerBook open={open} onOpenChange={setOpen} mode={mode} />
    </>
  );
}
