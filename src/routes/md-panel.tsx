import { useCallback, useEffect, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/useRole";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldCheck, CheckCircle2, XCircle, ChevronDown, ChevronRight, Clock, History } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/modules";

export const Route = createFileRoute("/md-panel")({
  head: () => ({ meta: [{ title: "MD Cash Control Panel" }] }),
  component: MdPanelPage,
});

type Handover = {
  id: string;
  handover_id: string;
  entry_date: string;
  closing_date: string | null;
  from_user: string | null;
  from_name: string | null;
  submitted_amount: number | null;
  confirmed_amount: number | null;
  amount: number;
  status: string;
  remarks: string | null;
  created_at: string;
};

type Receipt = {
  id: string;
  receipt_id: string;
  entry_date: string;
  passenger_name: string;
  amount: number;
  method: string;
  service_type: string;
  approval_status: string;
  received_by_name: string | null;
  handover_id: string | null;
};

const fmt = (n: number) => `৳ ${(Number(n) || 0).toLocaleString()}`;

function MdPanelPage() {
  const { isMd, loading: roleLoading } = useRole();
  const canApprove = isMd;
  const { user, loading: userLoading } = useCurrentUser();
  const [pending, setPending] = useState<Handover[]>([]);
  const [all, setAll] = useState<Handover[]>([]);
  const [allReceipts, setAllReceipts] = useState<Receipt[]>([]);
  const [expanded, setExpanded] = useState<Record<string, Receipt[]>>({});
  const [confirmAmt, setConfirmAmt] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [{ data: pendingData }, { data: allData }, { data: recData }] = await Promise.all([
      supabase
        .from("cash_handovers")
        .select("id,handover_id,entry_date,closing_date,from_user,from_name,submitted_amount,confirmed_amount,amount,status,remarks,created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("cash_handovers")
        .select("id,handover_id,entry_date,closing_date,from_user,from_name,submitted_amount,confirmed_amount,amount,status,remarks,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("payment_receipts")
        .select("id,receipt_id,entry_date,passenger_name,amount,method,service_type,approval_status,received_by_name,handover_id")
        .not("source", "eq", "discount")
        .not("method", "ilike", "discount")
        .order("entry_date", { ascending: false })
        .limit(200),
    ]);
    setPending((pendingData ?? []) as Handover[]);
    setAll((allData ?? []) as Handover[]);
    setAllReceipts((recData ?? []) as Receipt[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    void reload();
    const ch = supabase
      .channel("md_panel_v1")
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_handovers" }, () => void reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_receipts" }, () => void reload())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user?.id, reload]);

  if (userLoading || roleLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!canApprove) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            This panel is restricted to MD only.
          </CardContent>
        </Card>
      </div>
    );
  }

  const toggleExpand = async (h: Handover) => {
    if (expanded[h.id]) {
      const copy = { ...expanded };
      delete copy[h.id];
      setExpanded(copy);
      return;
    }
    const { data } = await supabase
      .from("payment_receipts")
      .select("id,receipt_id,entry_date,passenger_name,amount,method,service_type,approval_status,received_by_name,handover_id")
      .eq("handover_id", h.id)
      .order("entry_date");
    setExpanded((p) => ({ ...p, [h.id]: (data ?? []) as Receipt[] }));
  };

  const approve = async (h: Handover) => {
    const raw = confirmAmt[h.id];
    const amt = raw ? Number(raw) : Number(h.submitted_amount ?? h.amount);
    if (!amt || amt < 0) return toast.error("Confirmed amount invalid");
    setBusy(h.id);
    const { error } = await supabase.rpc("approve_handover" as never, {
      _handover_id: h.id,
      _confirmed_amount: amt,
    } as never);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(`Approved ${fmt(amt)} from ${h.from_name ?? "staff"}`);
    void reload();
  };

  const reject = async (h: Handover) => {
    if (!confirm(`Reject handover from ${h.from_name}? This unlocks the day and reverts receipts to pending.`)) return;
    setBusy(h.id);
    const { error } = await supabase.rpc("reject_handover" as never, {
      _handover_id: h.id,
      _reason: "Rejected by MD",
    } as never);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Handover rejected");
    void reload();
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-primary/15 text-primary">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold">MD Cash Control Panel</h1>
          <p className="text-xs text-muted-foreground">
            Approve staff handovers and monitor all cash activity
          </p>
        </div>
      </div>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending" className="gap-2">
            <Clock className="h-3.5 w-3.5" /> Pending ({pending.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-3.5 w-3.5" /> History
          </TabsTrigger>
          <TabsTrigger value="logs" className="gap-2">
            All Receipt Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-3">
          {loading ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>
          ) : pending.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No pending handovers</CardContent></Card>
          ) : pending.map((h) => {
            const variance = (Number(h.submitted_amount ?? h.amount) || 0);
            return (
              <Card key={h.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        {h.from_name ?? "Staff"} <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">Pending</Badge>
                      </CardTitle>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {h.handover_id} · Closing {formatDate(h.closing_date || h.entry_date)}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => toggleExpand(h)} className="gap-1">
                      {expanded[h.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      Details
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="rounded-md border p-2">
                      <div className="text-[11px] text-muted-foreground">Declared by Staff</div>
                      <div className="text-base font-bold tabular-nums">{fmt(variance)}</div>
                    </div>
                    <div className="rounded-md border p-2">
                      <div className="text-[11px] text-muted-foreground">Confirm Amount (৳)</div>
                      <Input
                        type="number"
                        inputMode="numeric"
                        placeholder={String(variance)}
                        value={confirmAmt[h.id] ?? ""}
                        onChange={(e) => setConfirmAmt((p) => ({ ...p, [h.id]: e.target.value }))}
                        className="h-8 mt-1"
                      />
                    </div>
                    {h.remarks && (
                      <div className="rounded-md border p-2 col-span-2 sm:col-span-1">
                        <div className="text-[11px] text-muted-foreground">Remarks</div>
                        <div className="text-xs">{h.remarks}</div>
                      </div>
                    )}
                  </div>

                  {expanded[h.id] && (
                    <div className="rounded-md border overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr className="text-left">
                            <th className="px-2 py-1.5 font-medium">Date</th>
                            <th className="px-2 py-1.5 font-medium">Passenger</th>
                            <th className="px-2 py-1.5 font-medium">Service</th>
                            <th className="px-2 py-1.5 font-medium text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(expanded[h.id] ?? []).length === 0 ? (
                            <tr><td colSpan={4} className="px-2 py-3 text-center text-muted-foreground">No linked receipts</td></tr>
                          ) : (expanded[h.id] ?? []).map((r) => (
                            <tr key={r.id} className="border-t">
                              <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(r.entry_date)}</td>
                              <td className="px-2 py-1.5">{r.passenger_name}</td>
                              <td className="px-2 py-1.5">{r.service_type}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums font-medium">{fmt(r.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => reject(h)}
                      disabled={busy === h.id}
                      className="text-rose-600 border-rose-300 hover:bg-rose-50"
                    >
                      <XCircle className="h-4 w-4" /> Reject
                    </Button>
                    <Button size="sm" onClick={() => approve(h)} disabled={busy === h.id}>
                      <CheckCircle2 className="h-4 w-4" /> Confirm &amp; Approve
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="px-2 py-2 font-medium">Date</th>
                    <th className="px-2 py-2 font-medium">Staff</th>
                    <th className="px-2 py-2 font-medium">Handover ID</th>
                    <th className="px-2 py-2 font-medium text-right">Declared</th>
                    <th className="px-2 py-2 font-medium text-right">Confirmed</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {all.length === 0 ? (
                    <tr><td colSpan={6} className="px-2 py-8 text-center text-muted-foreground">No handovers yet</td></tr>
                  ) : all.map((h) => (
                    <tr key={h.id} className="border-t">
                      <td className="px-2 py-2 whitespace-nowrap">{formatDate(h.entry_date)}</td>
                      <td className="px-2 py-2">{h.from_name ?? "—"}</td>
                      <td className="px-2 py-2 font-mono text-[10px]">{h.handover_id}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmt(Number(h.submitted_amount ?? h.amount))}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmt(Number(h.confirmed_amount ?? h.amount))}</td>
                      <td className="px-2 py-2">
                        <Badge
                          variant="outline"
                          className={
                            h.status === "approved"
                              ? "text-emerald-600 border-emerald-300 bg-emerald-50"
                              : h.status === "rejected"
                                ? "text-rose-600 border-rose-300 bg-rose-50"
                                : "text-amber-600 border-amber-300 bg-amber-50"
                          }
                        >
                          {h.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="px-2 py-2 font-medium">Date</th>
                    <th className="px-2 py-2 font-medium">Passenger</th>
                    <th className="px-2 py-2 font-medium">Service</th>
                    <th className="px-2 py-2 font-medium">Received By</th>
                    <th className="px-2 py-2 font-medium text-right">Amount</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {allReceipts.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(r.entry_date)}</td>
                      <td className="px-2 py-1.5">{r.passenger_name}</td>
                      <td className="px-2 py-1.5">{r.service_type}</td>
                      <td className="px-2 py-1.5">{r.received_by_name ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.amount)}</td>
                      <td className="px-2 py-1.5">
                        <ApprovalBadge status={r.approval_status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ApprovalBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    auto_approved: { label: "Self-Approved", cls: "text-emerald-600 border-emerald-300 bg-emerald-50" },
    approved: { label: "Approved by MD", cls: "text-emerald-600 border-emerald-300 bg-emerald-50" },
    pending_md: { label: "Pending MD", cls: "text-amber-600 border-amber-300 bg-amber-50" },
    rejected: { label: "Rejected", cls: "text-rose-600 border-rose-300 bg-rose-50" },
  };
  const m = map[status] ?? { label: status, cls: "" };
  return <Badge variant="outline" className={m.cls}>{m.label}</Badge>;
}
