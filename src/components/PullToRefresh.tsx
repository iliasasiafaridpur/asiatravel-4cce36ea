import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Mobile pull-to-refresh. When the user pulls down from the top of the page,
 * shows an indicator; releasing past the threshold reloads the page (like
 * Facebook/native apps). Desktop is untouched (pointer-events only on touch).
 */
export function PullToRefresh() {
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const THRESHOLD = 70;
  const MAX = 110;

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Only activate on touch devices (mobile).
    if (!("ontouchstart" in window)) return;

    const getScrollTop = () =>
      Math.max(window.scrollY || 0, document.documentElement.scrollTop || 0);

    const onTouchStart = (e: TouchEvent) => {
      if (getScrollTop() > 0) { startY.current = null; return; }
      startY.current = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (startY.current == null || refreshing) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) { setPull(0); return; }
      // Resistance curve
      const eased = Math.min(MAX, dy * 0.5);
      setPull(eased);
    };
    const onTouchEnd = () => {
      if (startY.current == null) return;
      startY.current = null;
      if (pull >= THRESHOLD) {
        setRefreshing(true);
        setPull(THRESHOLD);
        window.setTimeout(() => window.location.reload(), 150);
      } else {
        setPull(0);
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [pull, refreshing]);

  if (pull <= 0 && !refreshing) return null;

  const ready = pull >= THRESHOLD || refreshing;
  return (
    <div
      className="fixed left-0 right-0 top-0 z-[60] flex justify-center pointer-events-none md:hidden"
      style={{ transform: `translateY(${Math.max(0, pull - 20)}px)`, transition: refreshing ? "transform 150ms ease" : undefined }}
    >
      <div className="mt-2 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
        <RefreshCw className={`h-4 w-4 ${refreshing || ready ? "animate-spin" : ""}`} />
      </div>
    </div>
  );
}
