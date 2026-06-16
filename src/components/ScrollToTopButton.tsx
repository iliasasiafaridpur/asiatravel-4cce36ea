import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Global "scroll to top" button. Appears on every page once the user has
 * scrolled down a bit; one click smoothly returns to the top without manual
 * scrolling. Works whether the page scrolls on window or the main element.
 */
export function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const getScrollTop = () =>
      Math.max(
        window.scrollY || 0,
        document.documentElement.scrollTop || 0,
        document.body.scrollTop || 0,
      );

    const onScroll = () => setVisible(getScrollTop() > 300);

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToTop = () => {
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      window.scrollTo(0, 0);
    }
    document.documentElement.scrollTo?.({ top: 0, behavior: "smooth" });
  };

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="উপরে যান"
      title="উপরে যান"
      className={cn(
        "fixed bottom-5 right-5 z-50 flex h-11 w-11 items-center justify-center rounded-full",
        "bg-primary text-primary-foreground shadow-lg ring-1 ring-border",
        "transition-all duration-300 hover:bg-primary/90 hover:scale-105",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        visible ? "opacity-100 translate-y-0" : "pointer-events-none opacity-0 translate-y-3",
      )}
    >
      <ArrowUp className="h-5 w-5" />
    </button>
  );
}
