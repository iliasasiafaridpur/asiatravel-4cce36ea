import { useEffect, useState, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { Crown, HandCoins, Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useRole } from "@/hooks/useRole";
import { Button } from "@/components/ui/button";
import { StaffHandoverDialog } from "@/components/StaffHandoverDialog";
import { StaffHandoverHistoryDialog } from "@/components/StaffHandoverHistoryDialog";
import { toast } from "sonner";

/**
 * Header button shown in the top menu:
 *  - For MD: "MD Panel" with big pending-handover count badge.
 *  - For Staff: "MD কে ক্যাশ বুঝিয়ে দিন" with own pending-submission badge.
 * Re-notifies via toast every 2 minutes while pending > 0.
 */
export function HandoverHeaderButton() {
  const { user } = useCurrentUser();
  const { isMd, isStaff, isAdmin } = useRole();
  const [pendingCount, setPendingCount] = useState(0);
  const [openSubmit, setOpenSubmit] = useState(false);
  const [openHistory, setOpenHistory] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    let q = supabase.from("cash_handovers").select("id", { count: "exact", head: true }).eq("status", "pending");
    if (isStaff && !isMd && !isAdmin) q = q.eq("from_user", user.id);
    const { count } = await q;
    setPendingCount(count ?? 0);
  }, [user?.id, isMd, isStaff, isAdmin]);

  useEffect(() => {
    if (!user?.id) return;
    void load();
    const ch = supabase
      .channel(`handover-header-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_handovers" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [user?.id, load]);

  // Toast every 2 minutes while pending
  useEffect(() => {
    if (pendingCount <= 0) return;
    const msg = isMd
      ? `🔔 ${pendingCount} টি Cash Handover Approval এর অপেক্ষায়`
      : `🔔 ${pendingCount} টি Handover MD Approval এর অপেক্ষায়`;
    const id = setInterval(() => toast.info(msg), 2 * 60 * 1000);
    return () => clearInterval(id);
  }, [pendingCount, isMd]);

  if (!user) return null;

  const hasPending = pendingCount > 0;
  const Badge = hasPending ? (
    <span
      className="ml-1 inline-flex items-center justify-center min-w-[26px] h-[26px] px-1.5 rounded-full bg-rose-500 text-white text-[13px] font-extrabold tabular-nums ring-2 ring-background animate-pulse shadow-lg"
      aria-label={`${pendingCount} pending`}
    >
      {pendingCount}
    </span>
  ) : null;

  if (isMd) {
    return (
      <Button
        asChild
        size="sm"
        className={`h-10 px-3 gap-1.5 font-semibold ${hasPending ? "bg-amber-500 hover:bg-amber-500/90 text-amber-950" : "bg-amber-500/15 hover:bg-amber-500/25 text-amber-400"}`}
      >
        <Link to="/md-panel">
          <Crown className="h-4 w-4" />
          <span className="hidden sm:inline">MD Panel</span>
          <span className="sm:hidden">MD</span>
          {Badge}
          {hasPending && <Bell className="h-3.5 w-3.5 ml-0.5 animate-pulse" />}
        </Link>
      </Button>
    );
  }

  if (isStaff || isAdmin) {
    return (
      <>
        <Button
          size="sm"
          onClick={() => setOpenSubmit(true)}
          className={`h-10 px-3 gap-1.5 font-semibold ${hasPending ? "bg-amber-500 hover:bg-amber-500/90 text-amber-950" : "bg-sky-500/15 hover:bg-sky-500/25 text-sky-400"}`}
        >
          <HandCoins className="h-4 w-4" />
          <span className="hidden sm:inline">MD কে ক্যাশ দিন</span>
          <span className="sm:hidden">ক্যাশ</span>
          {Badge}
          {hasPending && <Bell className="h-3.5 w-3.5 ml-0.5 animate-pulse" />}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-9 px-2 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => setOpenHistory(true)}
          title="Pending ও History"
        >
          History
        </Button>
        <StaffHandoverDialog open={openSubmit} onOpenChange={setOpenSubmit} onSubmitted={() => void load()} />
        <StaffHandoverHistoryDialog open={openHistory} onOpenChange={setOpenHistory} />
      </>
    );
  }

  return null;
}
