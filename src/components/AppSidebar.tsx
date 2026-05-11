import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ClipboardList,
  Plane,
  IdCard,
  StickyNote,
  Users,
  Truck,
  BookOpen,
  FileText,
  UserCog,
  Globe2,
} from "lucide-react";
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

const NAV = [
  { group: "মেইন", items: [
    { to: "/", title: "Dashboard", icon: LayoutDashboard },
    { to: "/action-board", title: "Action Board", icon: ClipboardList },
    { to: "/day-book", title: "Day Book", icon: BookOpen },
  ]},
  { group: "Services", items: [
    { to: "/tickets", title: "বিমান টিকিট", icon: Plane },
    { to: "/bmet", title: "BMET Card", icon: IdCard },
    { to: "/saudi-visa", title: "Saudi Visa", icon: Globe2 },
    { to: "/kuwait-visa", title: "Kuwait Visa", icon: Globe2 },
    
  ]},
  { group: "হিসাব", items: [
    { to: "/agency-ledger", title: "Agency খাতা", icon: Users },
    { to: "/vendor-ledger", title: "Vendor খাতা", icon: Truck },
  ]},
  { group: "তালিকা", items: [
    { to: "/agents", title: "Agent List", icon: UserCog },
    { to: "/vendors", title: "Vendor List", icon: Truck },
    { to: "/invoice", title: "Invoice", icon: FileText },
  ]},
];

export function AppSidebar() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (to: string) => (to === "/" ? path === "/" : path === to || path.startsWith(to + "/"));

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
        {NAV.map((g) => (
          <SidebarGroup key={g.group}>
            <SidebarGroupLabel>{g.group}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={isActive(item.to)} tooltip={item.title}>
                      <Link to={item.to} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
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
