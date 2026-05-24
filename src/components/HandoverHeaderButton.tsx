import { useEffect, useState, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { Crown, HandCoins, Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useRole } from "@/hooks/useRole";
import { Button } from "@/components/ui/button";

import { toast } from "sonner";

/**
 * Header button shown in the top menu:
 *  - For MD: "MD Panel" with big pending-handover count badge.
 *  - For Staff: "MD কে ক্যাশ বুঝিয়ে দিন" with own pending-submission badge.
 * Notifies only once for each new pending handover id.
 */
export function HandoverHeaderButton() {
  const { user } = useCurrentUser();
  const { isMd, isStaff, isAdmin } = useRole();
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    let q = supabase.from("cash_handovers").select("id").eq("status", "pending");
    if (isStaff && !isMd && !isAdmin) q = q.eq("from_user", user.id);
    const { data } = await q;
    const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id).filter(Boolean);
    setPendingIds(ids);
    setPendingCount(ids.length);
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

  // Toast ONCE per pending handover id, persisted so remount/reload cannot repeat it.
  useEffect(() => {
    if (!user?.id || pendingIds.length === 0) return;
    const storageKey = `handover_notified_once_${isMd ? "md" : "staff"}_${user.id}`;
    let seen = new Set<string>();
    try {
      seen = new Set(JSON.parse(localStorage.getItem(storageKey) || "[]") as string[]);
    } catch { /* ignore bad localStorage */ }
    const freshIds = pendingIds.filter((id) => !seen.has(id));
    if (freshIds.length === 0) return;
    const msg = isMd
      ? `🔔 ${pendingCount} টি Cash Handover Approval এর অপেক্ষায়`
      : `🔔 ${pendingCount} টি Handover MD Approval এর অপেক্ষায়`;
    toast.info(msg);
    for (const id of freshIds) seen.add(id);
    try { localStorage.setItem(storageKey, JSON.stringify(Array.from(seen).slice(-300))); } catch { /* ignore quota */ }
  }, [pendingCount, pendingIds, isMd, user?.id]);

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
          <span className="hidden sm:inline">স্টাফ ক্যাশ রিকোয়েস্ট</span>
          <span className="sm:hidden">ক্যাশ</span>
          {Badge}
          {hasPending && <Bell className="h-3.5 w-3.5 ml-0.5 animate-pulse" />}
        </Link>
      </Button>
    );
  }

  if (isStaff || isAdmin) {
    return (
      <Button
        asChild
        size="sm"
        className={`h-10 px-3 gap-1.5 font-semibold ${hasPending ? "bg-amber-500 hover:bg-amber-500/90 text-amber-950" : "bg-sky-500/15 hover:bg-sky-500/25 text-sky-400"}`}
      >
        <Link to="/my-handover">
          <HandCoins className="h-4 w-4" />
          <span className="hidden sm:inline">MD কে ক্যাশ দিন</span>
          <span className="sm:hidden">ক্যাশ</span>
          {Badge}
          {hasPending && <Bell className="h-3.5 w-3.5 ml-0.5 animate-pulse" />}
        </Link>
      </Button>
    );
  }


  return null;
}
