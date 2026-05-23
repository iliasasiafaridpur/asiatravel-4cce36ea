import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Clock, CheckCircle2, History as HistoryIcon } from "lucide-react";
import { formatDateTime, formatDate } from "@/lib/modules";

const fmt = (n: number) => `৳ ${(n || 0).toLocaleString()}`;

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
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("cash_handovers")
        .select("id,handover_id,entry_date,closing_date,submitted_amount,confirmed_amount,amount,status,remarks,to_name,created_at")
        .eq("from_user", user.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      setRows((data ?? []) as unknown as Hand[]);
      setLoading(false);
    })();

    const ch = supabase
      .channel(`staff-handover-history-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_handovers", filter: `from_user=eq.${user.id}` }, async () => {
        const { data } = await supabase
          .from("cash_handovers")
          .select("id,handover_id,entry_date,closing_date,submitted_amount,confirmed_amount,amount,status,remarks,to_name,created_at")
          .eq("from_user", user.id)
          .order("created_at", { ascending: false })
          .limit(200);
        if (!cancelled) setRows((data ?? []) as unknown as Hand[]);
      })
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
              <div className="text-sm font-bold tabular-nums text-sky-500">{fmt(sub)}</div>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
              <span>📅 {h.closing_date || h.entry_date}</span>
              {h.to_name && <span>→ {h.to_name}</span>}
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
