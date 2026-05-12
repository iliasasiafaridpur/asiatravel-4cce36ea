import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/users")({
  head: () => ({ meta: [{ title: "User Management — Asia Travel" }] }),
  component: UsersPage,
});

interface ProfileRow {
  user_id: string;
  full_name: string;
  mobile: string | null;
  designation: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
}

function UsersPage() {
  const { profile, loading } = useCurrentUser();
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [busy, setBusy] = useState(false);

  const isAdmin = profile?.role === "admin";

  const load = async () => {
    const { data, error } = await supabase.from("profiles")
      .select("user_id,full_name,mobile,designation,role,is_active,created_at")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setRows((data as ProfileRow[]) ?? []);
  };

  useEffect(() => { if (isAdmin) void load(); }, [isAdmin]);

  if (loading) return <div className="p-6 text-muted-foreground">লোড হচ্ছে…</div>;
  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto mt-12">
        <Card><CardContent className="p-6 text-center space-y-2">
          <ShieldOff className="mx-auto h-10 w-10 text-rose-500" />
          <h2 className="text-lg font-bold">Access Denied</h2>
          <p className="text-sm text-muted-foreground">শুধু Admin এই পেইজ দেখতে পারবেন।</p>
        </CardContent></Card>
      </div>
    );
  }

  const toggleActive = async (r: ProfileRow, v: boolean) => {
    setBusy(true);
    const { error } = await supabase.from("profiles")
      .update({ is_active: v }).eq("user_id", r.user_id);
    if (error) toast.error(error.message);
    else { toast.success(v ? "Activated" : "Deactivated"); await load(); }
    setBusy(false);
  };

  const changeRole = async (r: ProfileRow, role: string) => {
    setBusy(true);
    const { error } = await supabase.from("profiles")
      .update({ role }).eq("user_id", r.user_id);
    if (error) { toast.error(error.message); setBusy(false); return; }
    // sync user_roles table
    if (role === "admin") {
      await supabase.from("user_roles").upsert({ user_id: r.user_id, role: "admin" } as never);
    } else {
      await supabase.from("user_roles").delete().eq("user_id", r.user_id).eq("role", "admin");
    }
    toast.success("Role আপডেটেড");
    await load();
    setBusy(false);
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-6 w-6 text-emerald-600" />
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">User Management</h1>
          <p className="text-sm text-muted-foreground">নতুন user activate করুন ও role পরিবর্তন করুন</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>নাম</TableHead>
                <TableHead>মোবাইল</TableHead>
                <TableHead>পদবি</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">কোনো user নেই</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.user_id}>
                  <TableCell className="font-medium">{r.full_name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.mobile ?? "—"}</TableCell>
                  <TableCell>{r.designation ?? "—"}</TableCell>
                  <TableCell>
                    <Select value={r.role} onValueChange={(v) => changeRole(r, v)} disabled={busy}>
                      <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="staff">Staff</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {r.is_active
                      ? <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30">Active</Badge>
                      : <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30">Pending</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Switch checked={r.is_active} disabled={busy}
                      onCheckedChange={(v) => toggleActive(r, v)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="outline" onClick={() => void load()}>রিফ্রেশ</Button>
      </div>
    </div>
  );
}
