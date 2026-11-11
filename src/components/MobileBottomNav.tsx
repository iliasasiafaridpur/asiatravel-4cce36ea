import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Wallet, HandCoins, BookUser, Menu } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/** Mobile-only (<768px) app-style bottom navigation. Desktop/tablet hidden. */
export function MobileBottomNav() {
  const { toggleSidebar } = useSidebar();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const items = [
    { to: "/", label: "হোম", icon: LayoutDashboard },
    { to: "/accounts", label: "ক্যাশ বুক", icon: Wallet },
    { to: "/my-handover", label: "হ্যান্ডওভার", icon: HandCoins },
    { to: "/agency-ledger", label: "এজেন্সি", icon: BookUser },
  ] as const;
  return (
    <nav className="mobile-bottom-nav md:hidden" aria-label="মোবাইল নেভিগেশন">
      {items.map(({ to, label, icon: Icon }) => {
        const active = to === "/" ? path === "/" : path.startsWith(to);
        return (
          <Link key={to} to={to} className={cn("mbn-item", active && "mbn-active")}>
            <Icon className="h-5 w-5" />
            <span>{label}</span>
          </Link>
        );
      })}
      <button type="button" onClick={toggleSidebar} className="mbn-item" aria-label="মেনু">
        <Menu className="h-5 w-5" />
        <span>মেনু</span>
      </button>
    </nav>
  );
}
