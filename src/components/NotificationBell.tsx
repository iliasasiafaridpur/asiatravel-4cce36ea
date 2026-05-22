import { useEffect, useState } from "react";
import { Bell, CheckCheck, Trash2, CircleCheck, CircleAlert, CircleX, Info } from "lucide-react";
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

export function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setItems(getNotifications());
      setUnread(getUnreadCount());
    };
    refresh();
    return subscribeNotifications(refresh);
  }, []);

  // Mark all read when opening
  useEffect(() => {
    if (open && unread > 0) {
      // Small delay so badge animates out after user sees it
      const id = window.setTimeout(() => markAllRead(), 400);
      return () => window.clearTimeout(id);
    }
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
      <PopoverContent align="end" className="w-80 p-0">
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
                      <p className="text-xs font-medium leading-snug truncate">{n.title}</p>
                      <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(n.created_at)}</span>
                    </div>
                    {n.message && (
                      <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 break-words">{n.message}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
