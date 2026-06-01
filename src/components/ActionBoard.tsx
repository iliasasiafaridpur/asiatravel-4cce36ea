import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { STATUSES, statusStyle, formatDate, type Status } from "@/lib/passengers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PassengerDialog, type PassengerRow } from "./PassengerDialog";
import { Plus, Search, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useScrollRestore } from "@/hooks/useScrollRestore";

export function ActionBoard() {
  const qc = useQueryClient();
  const { profile } = useCurrentUser();
  const isAdmin = profile?.role === "admin";
  const [tab, setTab] = useState<"all" | Status>("all");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const saveScroll = useScrollRestore(dialogOpen);
  const [editing, setEditing] = useState<PassengerRow | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["passengers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("passengers")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as (PassengerRow & { created_at: string })[];
    },
  });

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (tab !== "all") rows = rows.filter((r) => r.status === tab);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) =>
      r.passenger_name.toLowerCase().includes(q) ||
      r.passport.toLowerCase().includes(q) ||
      r.passenger_id.toLowerCase().includes(q)
    );
    return rows;
  }, [data, tab, search]);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Status }) => {
      const { error } = await supabase.from("passengers").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["passengers"] });
      toast.success("স্ট্যাটাস আপডেট হয়েছে");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("passengers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["passengers"] });
      toast.success("ডিলিট হয়েছে");
      setDeleteId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.length ?? 0 };
    STATUSES.forEach((s) => (c[s] = (data ?? []).filter((r) => r.status === s).length));
    return c;
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">একশন বোর্ড</h2>
          <p className="text-sm text-muted-foreground">কাজের স্ট্যাটাস ম্যানেজ করুন</p>
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }} size="lg" className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" /> নতুন এন্ট্রি
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="খুঁজুন…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="shrink-0 text-xs px-2.5 py-1.5 rounded-md border bg-muted/30 text-muted-foreground whitespace-nowrap">
            ফলাফল: <span className="font-semibold text-foreground tabular-nums">{filtered.length}</span>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="grid grid-cols-5 w-full h-auto">
            <TabsTrigger value="all" className="flex-col gap-0.5 py-2 text-xs">
              <span>সব</span><span className="font-bold">{counts.all}</span>
            </TabsTrigger>
            {STATUSES.map((s) => (
              <TabsTrigger key={s} value={s} className="flex-col gap-0.5 py-2 text-xs">
                <span className="truncate w-full">{s}</span><span className="font-bold">{counts[s]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground text-center py-8">লোড হচ্ছে…</p>}
        {!isLoading && filtered.length === 0 && (
          <Card className="p-8 text-center">
            <p className="text-sm text-muted-foreground">কোনো এন্ট্রি পাওয়া যায়নি</p>
          </Card>
        )}
        {filtered.map((r) => (
          <Card key={r.id} className="p-4" style={{ background: "var(--gradient-card)" }}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-primary font-semibold">{r.passenger_id}</p>
                <p className="font-semibold truncate mt-0.5">{r.passenger_name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Passport: {r.passport}</p>
                <p className="text-xs text-muted-foreground">{formatDate(r.created_at)}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-md border whitespace-nowrap ${statusStyle[r.status as Status] ?? ""}`}>
                {r.status}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <Select value={r.status} onValueChange={(v) => updateStatus.mutate({ id: r.id, status: v as Status })}>
                <SelectTrigger className="flex-1 h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={() => { setEditing(r); setDialogOpen(true); }}>
                  <Pencil className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">এডিট</span>
                </Button>
                <Button size="sm" variant="outline" className="flex-1 sm:flex-none text-destructive hover:text-destructive" onClick={() => {
                  if (!isAdmin) {
                    toast.error("আপনার ডিলিট করার অনুমতি নেই। Admin-এর সাথে যোগাযোগ করুন।");
                    return;
                  }
                  setDeleteId(r.id);
                }}>
                  <Trash2 className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">ডিলিট</span>
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <PassengerDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>নিশ্চিতভাবে ডিলিট?</AlertDialogTitle>
            <AlertDialogDescription>এই এন্ট্রি স্থায়ীভাবে মুছে যাবে।</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>বাতিল</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && del.mutate(deleteId)} className="bg-destructive text-destructive-foreground">
              ডিলিট
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
