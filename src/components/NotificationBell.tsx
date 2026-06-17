import { useEffect, useState } from "react";
import {
  Bell,
  CheckCheck,
  Trash2,
  CircleCheck,
  CircleAlert,
  CircleX,
  Info,
  RefreshCw,
  Download,
  CloudDownload,
  User,
  Briefcase,
  MapPin,
} from "lucide-react";
import { prefetchMonthData } from "@/lib/offline-prefetch";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  getNotifications,
  getUnreadCount,
  markAllRead,
  clearNotifications,
  subscribeNotifications,
  type NotificationItem,
} from "@/lib/notification-store";
import { drainQueue, getQueue, getQueueCount } from "@/lib/offline-queue";
import { supabase } from "@/integrations/supabase/client";

function timeAgo(iso: string) {
  const d = new Date(iso).getTime();
  const s = Math.max(1, Math.floor((Date.now() - d) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function iconFor(t: NotificationItem["type"]) {
  switch (t) {
    case "success": return <CircleCheck className="h-4 w-4 text-emerald-500" />;
    case "error":   return <CircleX className="h-4 w-4 text-rose-500" />;
    case "warning": return <CircleAlert className="h-4 w-4 text-amber-500" />;
    default:        return <Info className="h-4 w-4 text-sky-500" />;
  }
}

function pad(n: number) { return n.toString().padStart(2, "0"); }
function tsForFile(d = new Date()) {
  return `${pad(d.getDate())}_${pad(d.getMonth() + 1)}_${d.getFullYear()}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function downloadQueueBackup() {
  const items = getQueue();
  if (items.length === 0) {
    toast.info("কোনো অফলাইন এন্ট্রি নেই");
    return;
  }
  try {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `offline_backup_${tsForFile()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(`${items.length} টি এন্ট্রি ব্যাকআপ ডাউনলোড হয়েছে`);
  } catch {
    toast.error("ব্যাকআপ ডাউনলোড ব্যর্থ");
  }
}

async function forceResync() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    toast.error("ইন্টারনেট নেই — আগে কানেকশন ঠিক করুন");
    return;
  }
  try {
    // Refresh token first so replays don't 401 after long offline gaps.
    await supabase.auth.refreshSession().catch(() => null);
  } catch { /* ignore */ }
  const before = getQueueCount();
  if (before === 0) {
    toast.info("কোনো অপেক্ষমান এন্ট্রি নেই");
    return;
  }
  toast.info(`${before} টি এন্ট্রি সিঙ্ক করার চেষ্টা চলছে...`);
  const { ok, failed } = await drainQueue();
  if (ok > 0) toast.success(`${ok} টি এন্ট্রি সফলভাবে সিঙ্ক হয়েছে`);
  if (failed > 0) toast.error(`${failed} টি এন্ট্রি সিঙ্ক ব্যর্থ`);
  if (ok === 0 && failed === 0) toast.info("কোনো পরিবর্তন হয়নি");
}

function MetaRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="opacity-70">{icon}</span>
      <span className="truncate">{text}</span>
    </div>
  );
}

export function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [prefetching, setPrefetching] = useState(false);

  const runPrefetch = async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast.error("ইন্টারনেট নেই — আগে কানেকশন ঠিক করে নিন");
      return;
    }
    setPrefetching(true);
    toast.info("একমাসের ডাটা ডাউনলোড হচ্ছে…");
    try {
      const { ok, failed, rows } = await prefetchMonthData(31);
      if (failed > 0) {
        toast.warning(`${ok} মডিউল সেভ হয়েছে, ${failed} টি ব্যর্থ (${rows} এন্ট্রি)`);
      } else {
        toast.success(`একমাসের ডাটা অফলাইনে সেভ হয়েছে (${rows} এন্ট্রি) — নেট ছাড়াও দেখা যাবে`);
      }
    } catch {
      toast.error("ডাটা ডাউনলোড ব্যর্থ");
    } finally {
      setPrefetching(false);
    }
  };

  useEffect(() => {
    const refresh = () => {
      setItems(getNotifications());
      setUnread(getUnreadCount());
    };
    refresh();
    return subscribeNotifications(refresh);
  }, []);

  // Reset unread badge as soon as the dropdown is opened.
  useEffect(() => {
    if (open && unread > 0) markAllRead();
  }, [open, unread]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-[10px] font-bold text-white flex items-center justify-center leading-none">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <div className="text-sm font-semibold">নোটিফিকেশন</div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => markAllRead()}
              disabled={items.every((i) => i.read)}
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1" /> Mark read
            </Button>
            <Button
              variant="ghost" size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => clearNotifications()}
              disabled={items.length === 0}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <ScrollArea className="max-h-96">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              কোনো নোটিফিকেশন নেই
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => (
                <li key={n.id} className={`px-3 py-2 flex gap-2 ${n.read ? "" : "bg-accent/40"}`}>
                  <div className="mt-0.5">{iconFor(n.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium leading-snug break-words">{n.title}</p>
                      <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(n.created_at)}</span>
                    </div>
                    {n.message && (
                      <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 break-words">{n.message}</p>
                    )}
                    {n.meta && (n.meta.passenger || n.meta.country || n.meta.vendor || n.meta.service || n.meta.refId || n.meta.receiptId) && (
                      <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 break-words">
                        {[
                          n.meta.vendor ? `→ ${n.meta.vendor}` : null,
                          n.meta.service,
                          n.meta.passenger,
                          n.meta.refId,
                          n.meta.country,
                          n.meta.receiptId && n.meta.receiptId !== "—" ? `রিসিট: ${n.meta.receiptId}` : null,
                        ].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
        <div className="border-t border-border p-2 bg-muted/30">
          <Button
            variant="outline" size="sm"
            className="w-full h-8 text-xs mb-2"
            disabled={prefetching}
            onClick={runPrefetch}
          >
            <CloudDownload className={`h-3.5 w-3.5 mr-1 ${prefetching ? "animate-pulse" : ""}`} />
            {prefetching ? "ডাউনলোড হচ্ছে…" : "একমাসের ডাটা সেভ করুন (অফলাইন)"}
          </Button>
          <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm"
            className="flex-1 h-8 text-xs"
            disabled={syncing}
            onClick={async () => { setSyncing(true); await forceResync(); setSyncing(false); }}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${syncing ? "animate-spin" : ""}`} />
            Force Re-Sync
          </Button>
          <Button
            variant="outline" size="sm"
            className="flex-1 h-8 text-xs"
            onClick={() => downloadQueueBackup()}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Backup
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
