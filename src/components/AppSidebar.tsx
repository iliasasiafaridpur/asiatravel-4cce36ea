import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ClipboardList,
  Plane,
  IdCard,
  Users,
  Truck,
  FileText,
  Globe2,
  Wallet,
  Settings as SettingsIcon,
  ShieldCheck,
  Crown,
  HandCoins,
  BookOpen,
} from "lucide-react";
import { useRole } from "@/hooks/useRole";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type NavItem = {
  to: string;
  title: string;
  icon: typeof LayoutDashboard;
  color: string; // tailwind text color class
  bg: string; // tailwind bg color class (soft)
};

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "মেইন",
    items: [
      { to: "/", title: "Dashboard", icon: LayoutDashboard, color: "text-sky-400", bg: "bg-sky-500/15" },
      { to: "/action-board", title: "Action Board", icon: ClipboardList, color: "text-amber-400", bg: "bg-amber-500/15" },
    ],
  },
  {
    group: "Services",
    items: [
      { to: "/tickets", title: "AIR TICKET", icon: Plane, color: "text-cyan-400", bg: "bg-cyan-500/15" },
      { to: "/bmet", title: "BMET Card", icon: IdCard, color: "text-emerald-400", bg: "bg-emerald-500/15" },
      { to: "/saudi-visa", title: "Saudi Visa", icon: Globe2, color: "text-green-400", bg: "bg-green-500/15" },
      { to: "/kuwait-visa", title: "Kuwait Visa", icon: Globe2, color: "text-red-400", bg: "bg-red-500/15" },
    ],
  },
  {
    group: "হিসাব",
    items: [
      { to: "/agency-ledger", title: "Customers Data", icon: Users, color: "text-violet-400", bg: "bg-violet-500/15" },
      { to: "/vendor-ledger", title: "Vendor Data", icon: Truck, color: "text-orange-400", bg: "bg-orange-500/15" },
      { to: "/accounts", title: "My Accounts", icon: Wallet, color: "text-yellow-400", bg: "bg-yellow-500/15" },
    ],
  },
  {
    group: "তালিকা",
    items: [
      { to: "/invoice", title: "Invoice", icon: FileText, color: "text-pink-400", bg: "bg-pink-500/15" },
    ],
  },
  {
    group: "System",
    items: [
      { to: "/help", title: "সহায়িকা / Help", icon: BookOpen, color: "text-teal-400", bg: "bg-teal-500/15" },
      { to: "/users", title: "User Management", icon: ShieldCheck, color: "text-indigo-400", bg: "bg-indigo-500/15" },
      { to: "/settings", title: "Settings", icon: SettingsIcon, color: "text-slate-300", bg: "bg-slate-500/20" },
    ],
  },
];

export function AppSidebar() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (to: string) => (to === "/" ? path === "/" : path === to || path.startsWith(to + "/"));
  const { isMd } = useRole();

  // Simple rule: only MD sees the MD Panel. Staff/Admin see আমার ক্যাশ হিসাব.
  const nav = isMd
    ? [
        ...NAV.slice(0, 3),
        {
          group: "Owner",
          items: [
            { to: "/md-panel", title: "MD Panel", icon: Crown, color: "text-amber-400", bg: "bg-amber-500/15" } as NavItem,
          ],
        },
        ...NAV.slice(3),
      ]
    : [
        ...NAV.slice(0, 3),
        {
          group: "ক্যাশ",
          items: [
            { to: "/my-handover", title: "আমার ক্যাশ হিসাব", icon: HandCoins, color: "text-sky-400", bg: "bg-sky-500/15" } as NavItem,
          ],
        },
        ...NAV.slice(3),
      ];


  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div
            className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-primary-foreground"
            style={{ background: "var(--gradient-hero)", boxShadow: "var(--shadow-glow)" }}
          >
            <Plane className="h-5 w-5" />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="font-bold text-sm leading-tight">Travel Manager</p>
            <p className="text-[10px] text-muted-foreground leading-tight truncate">All-in-one Office</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {nav.map((g) => (
          <SidebarGroup key={g.group}>
            <SidebarGroupLabel>{g.group}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(item.to)}
                      tooltip={item.title}
                      className="h-9 data-[active=true]:bg-primary/20 data-[active=true]:text-primary data-[active=true]:font-semibold data-[active=true]:ring-1 data-[active=true]:ring-primary/40 data-[active=true]:shadow-[0_0_12px_-2px_var(--primary)] data-[active=true]:border-l-4 data-[active=true]:border-primary"
                    >
                      <Link to={item.to} className="flex items-center gap-2">
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${item.bg} ring-1 ring-inset ring-white/5 shadow-sm transition-transform group-hover/menu-item:scale-105`}
                        >
                          <item.icon className={`h-[18px] w-[18px] ${item.color}`} strokeWidth={2.25} />
                        </span>
                        <span className="truncate">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
