import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dashboard } from "@/components/Dashboard";
import { ActionBoard } from "@/components/ActionBoard";
import { Toaster } from "@/components/ui/sonner";
import { Plane, Moon, Sun, LayoutDashboard, ListChecks } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Manpower Travel Manager — ড্যাশবোর্ড" },
      { name: "description", content: "প্যাসেঞ্জার ম্যানেজমেন্ট অ্যাপ — ড্যাশবোর্ড ও একশন বোর্ড সহ।" },
    ],
  }),
  component: Index,
});

function Index() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <div className="min-h-screen bg-background">
      <header
        className="sticky top-0 z-40 border-b border-border backdrop-blur-md"
        style={{ background: "color-mix(in oklab, var(--color-background) 85%, transparent)" }}
      >
        <div className="container mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="h-9 w-9 rounded-lg flex items-center justify-center text-primary-foreground"
              style={{ background: "var(--gradient-hero)", boxShadow: "var(--shadow-glow)" }}
            >
              <Plane className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-bold text-base sm:text-lg leading-tight">Manpower Manager</h1>
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">Travel & Passenger Tracking</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setDark((d) => !d)} aria-label="Toggle theme">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-6 pb-24">
        <Tabs defaultValue="dashboard">
          <TabsList className="grid grid-cols-2 w-full sm:w-80 mb-6">
            <TabsTrigger value="dashboard" className="gap-1.5">
              <LayoutDashboard className="h-4 w-4" /> ড্যাশবোর্ড
            </TabsTrigger>
            <TabsTrigger value="action" className="gap-1.5">
              <ListChecks className="h-4 w-4" /> একশন বোর্ড
            </TabsTrigger>
          </TabsList>
          <TabsContent value="dashboard"><Dashboard /></TabsContent>
          <TabsContent value="action"><ActionBoard /></TabsContent>
        </Tabs>
      </main>

      <Toaster richColors position="top-center" />
    </div>
  );
}
