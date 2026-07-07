import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Clock, CheckCircle2, History as HistoryIcon, Printer } from "lucide-react";
import { formatDateTime, formatDate } from "@/lib/modules";
import { buildFileTitle, printDocHtml } from "@/lib/print-export";

const fmt = (n: number) => `৳ ${(n || 0).toLocaleString()}`;

function printHandover(h: Hand) {
  const status = h.status ?? "approved";
  const sub = Number(h.submitted_amount ?? h.amount ?? 0);
  const conf = Number(h.confirmed_amount ?? 0);
  const variance = conf > 0 ? conf - sub : 0;
  const docTitle = buildFileTitle(
    "Cash_Handover",
    h.handover_id ?? h.id.slice(0, 8),
    h.from_name ?? "",
    formatDate(h.closing_date || h.entry_date),
  );
  const row = (label: string, value: string) =>
    `<div class="row"><b>${label}</b><span>${value}</span></div>`;
  const html = `<!doctype html><html><head><title>${docTitle}</title>
    <style>
      @page { size: A5; margin: 10mm; }
      body { font-family: ui-sans-serif, system-ui, sans-serif; color:#111; margin:0; padding:16px; }
      .r { max-width:520px; margin:0 auto; }
      .h { text-align:center; border-bottom:2px solid #111; padding-bottom:8px; margin-bottom:12px; }
      .h h1 { margin:0; font-size:18px; }
      .h .sub { font-size:11px; color:#555; }
      .row { display:flex; justify-content:space-between; gap:8px; font-size:12px; padding:3px 0; }
      .row b { font-weight:600; }
      .sect { margin-top:10px; padding-top:8px; border-top:1px dashed #aaa; }
      .total { font-size:14px; font-weight:700; border-top:2px solid #111; margin-top:8px; padding-top:6px; display:flex; justify-content:space-between; }
      .ft { margin-top:18px; font-size:10px; color:#666; text-align:center; }
      .sig { margin-top:36px; display:flex; justify-content:space-between; font-size:11px; }
      .sig div { border-top:1px solid #111; padding-top:4px; width:40%; text-align:center; }
    </style></head><body>
      <div class="r">
        <div class="h">
          <h1>Asia Travels & Tours</h1>
          <div class="sub">Cash Handover Slip</div>
        </div>
        ${row("Handover #", h.handover_id ?? h.id.slice(0, 8))}
        ${row("Status", status)}
        ${row("Submitted", formatDateTime(h.created_at))}
        ${row("Closing Date", formatDate(h.closing_date || h.entry_date))}
        <div class="sect">
          ${row("প্রেরক (From)", h.from_name ?? "—")}
          ${h.to_name ? row("গ্রহীতা (To)", h.to_name) : ""}
        </div>
        <div class="sect">
          <div class="total"><span>Submitted Amount</span><span>${fmt(sub)}</span></div>
          ${conf > 0 ? row("Confirmed Amount", fmt(conf)) : ""}
          ${variance !== 0 ? row("Variance", `${variance > 0 ? "+" : ""}${fmt(variance)}`) : ""}
        </div>
        ${h.remarks ? `<div class="sect" style="font-size:12px"><b>Remarks:</b> ${h.remarks}</div>` : ""}
        <div class="sig">
          <div>প্রেরক<br/>${h.from_name ?? ""}</div>
          <div>গ্রহীতা<br/>${h.to_name ?? ""}</div>
        </div>
        <div class="ft">Computer generated cash handover slip.</div>
      </div>
    </body></html>`;
  printDocHtml(html, docTitle);
}

interface Hand {
  id: string;
  handover_id: string | null;
  entry_date: string;
  closing_date: string | null;
  submitted_amount: number | null;
  confirmed_amount: number | null;
  amount: number;
  status: string | null;
  remarks: string | null;
  from_name: string | null;
  to_name: string | null;
  created_at: string;
}

export function StaffHandoverHistoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { user } = useCurrentUser();
  const [rows, setRows] = useState<Hand[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !user?.id) return;
    let cancelled = false;
    const loadRows = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("cash_handovers")
        .select("id,handover_id,entry_date,closing_date,submitted_amount,confirmed_amount,amount,status,remarks,from_name,to_name,created_at")
        .eq("from_user", user.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      const allRows = ((data ?? []) as unknown as Hand[]).filter((row) => !["cancelled", "canceled"].includes((row.status ?? "").toLowerCase()));
      const pendingIds = allRows.filter((row) => (row.status ?? "approved") === "pending").map((row) => row.id);
      if (pendingIds.length === 0) {
        setRows(allRows);
        setLoading(false);
        return;
      }
      const [receipts, expenses] = await Promise.all([
        supabase.from("payment_receipts").select("handover_id").in("handover_id", pendingIds),
        supabase.from("cash_expenses").select("handover_id").in("handover_id", pendingIds),
      ]);
      const linkedIds = new Set<string>();
      for (const row of ((receipts.data ?? []) as Array<{ handover_id: string | null }>)) if (row.handover_id) linkedIds.add(row.handover_id);
      for (const row of ((expenses.data ?? []) as Array<{ handover_id: string | null }>)) if (row.handover_id) linkedIds.add(row.handover_id);
      setRows(allRows.filter((row) => (row.status ?? "approved") !== "pending" || linkedIds.has(row.id)));
      setLoading(false);
    };
    void loadRows();

    const ch = supabase
      .channel(`staff-handover-history-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_handovers", filter: `from_user=eq.${user.id}` }, () => { void loadRows(); })
      .subscribe();

    return () => { cancelled = true; void supabase.removeChannel(ch); };
  }, [open, user?.id]);

  const pending = rows.filter((r) => (r.status ?? "approved") === "pending");
  const history = rows.filter((r) => (r.status ?? "approved") !== "pending");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HistoryIcon className="h-4 w-4" /> আমার Cash Handover
          </DialogTitle>
          <DialogDescription>Pending Approval ও সম্পূর্ণ History।</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="pending" className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="pending" className="gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Pending Approval
              {pending.length > 0 && <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full bg-amber-500 text-amber-950 text-[11px] font-bold">{pending.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> History ({history.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="flex-1 overflow-y-auto mt-3">
            <HandList rows={pending} loading={loading} emptyText="কোনো pending handover নেই" />
          </TabsContent>
          <TabsContent value="history" className="flex-1 overflow-y-auto mt-3">
            <HandList rows={history} loading={loading} emptyText="কোনো history নেই" />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function HandList({ rows, loading, emptyText }: { rows: Hand[]; loading: boolean; emptyText: string }) {
  if (loading) return <div className="p-6 text-sm text-muted-foreground text-center">লোড হচ্ছে…</div>;
  if (rows.length === 0) return <div className="p-6 text-sm text-muted-foreground text-center">{emptyText}</div>;
  return (
    <div className="divide-y border rounded-lg">
      {rows.map((h) => {
        const status = h.status ?? "approved";
        const cls = status === "pending" ? "bg-amber-500/15 text-amber-500 border-amber-500/30"
          : status === "approved" ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
          : "bg-rose-500/15 text-rose-500 border-rose-500/30";
        const sub = Number(h.submitted_amount ?? h.amount ?? 0);
        const conf = Number(h.confirmed_amount ?? 0);
        const variance = conf > 0 ? conf - sub : 0;
        return (
          <div key={h.id} className="p-3 hover:bg-muted/30">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant="outline" className={cls}>{status}</Badge>
                <span className="font-mono text-[11px] text-muted-foreground">{h.handover_id ?? h.id.slice(0, 8)}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="text-sm font-bold tabular-nums text-sky-500">{fmt(sub)}</div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  title="Print / PDF"
                  onClick={() => printHandover(h)}
                >
                  <Printer className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
              <span>📅 Submitted: {formatDateTime(h.created_at)}</span>
              <span>Closing: {formatDate(h.closing_date || h.entry_date)}</span>
              <span>প্রেরক: {h.from_name ?? "—"}</span>
              {h.to_name && <span>→ গ্রহীতা: {h.to_name}</span>}
              {conf > 0 && <span>Confirmed: <span className="font-semibold text-foreground">{fmt(conf)}</span></span>}
              {variance !== 0 && (
                <span className={variance > 0 ? "text-emerald-500" : "text-rose-500"}>
                  Variance: {variance > 0 ? "+" : ""}{fmt(variance)}
                </span>
              )}
            </div>
            {h.remarks && <p className="mt-1 text-[11px] text-muted-foreground/80 truncate">📝 {h.remarks}</p>}
          </div>
        );
      })}
    </div>
  );
}
