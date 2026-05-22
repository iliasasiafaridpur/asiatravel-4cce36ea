import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { drainQueue, getQueueCount, subscribeQueue } from "@/lib/offline-queue";

export function OfflineSyncManager() {
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState<number>(() =>
    typeof window === "undefined" ? 0 : getQueueCount(),
  );

  useEffect(() => {
    const unsub = subscribeQueue(() => setPending(getQueueCount()));
    return unsub;
  }, []);

  // Snapshot queue size on mount so we can detect "restored from previous session"
  const [initialPending] = useState<number>(() =>
    typeof window === "undefined" ? 0 : getQueueCount(),
  );
  const [restoredAnnounced, setRestoredAnnounced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tryDrain = async () => {
      if (cancelled) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (getQueueCount() === 0) return;
      if (syncing) return;
      setSyncing(true);
      try {
        const { ok, failed } = await drainQueue();
        if (ok > 0 && getQueueCount() === 0) {
          // If we started this session with pre-existing queued items, this
          // means we just recovered from a previous crash / power-cut.
          if (initialPending > 0 && !restoredAnnounced) {
            toast.success("Successfully restored all offline entries from previous session.", { duration: 4000 });
            setRestoredAnnounced(true);
          } else {
            toast.success("সব অফলাইন হিসাব সফলভাবে সার্ভারে যুক্ত হয়েছে!", { duration: 4000 });
          }
          qc.invalidateQueries();
          try { window.dispatchEvent(new CustomEvent("offline-sync:completed")); } catch { /* ignore */ }
        } else if (failed > 0) {
          toast.error(`${failed} টি অফলাইন এন্ট্রি সিঙ্ক করা যায়নি`, { duration: 5000 });
        }
      } finally {
        setSyncing(false);
      }
    };

    const onOnline = () => { void tryDrain(); };
    const onFocus = () => { void tryDrain(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    // Periodic safety net
    const id = window.setInterval(tryDrain, 30_000);
    // Initial attempt on mount
    void tryDrain();

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!syncing && pending === 0) return null;

  return (
    <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-2 rounded-full border border-border bg-background/95 px-4 py-2 text-xs shadow-lg backdrop-blur">
        {syncing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>অফলাইন ডাটা সার্ভারে সিঙ্ক হচ্ছে, দয়া করে অপেক্ষা করুন...</span>
          </>
        ) : (
          <>
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
            <span>{pending} টি এন্ট্রি অপেক্ষমান (ইন্টারনেট এলেই অটো-সিঙ্ক হবে)</span>
          </>
        )}
      </div>
    </div>
  );
}
