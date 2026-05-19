import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { LookupSelect } from "@/components/LookupSelect";
import { Zap } from "lucide-react";

type Row = Record<string, unknown> & { id: string };
type Mode = "send" | "receive";

interface Props {
  rows: Row[];
  onChanged: () => void | Promise<void>;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function BmetQuickManage({ rows, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("send");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [vendor, setVendor] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const list = useMemo(() => {
    if (mode === "send") {
      return rows.filter((r) => !r.vendor_sent_date);
    }
    return rows.filter((r) => !r.received_date);
  }, [rows, mode]);

  const allChecked = list.length > 0 && list.every((r) => selected.has(r.id));
  const someChecked = list.some((r) => selected.has(r.id));

  const toggleAll = (v: boolean) => {
    const next = new Set(selected);
    if (v) list.forEach((r) => next.add(r.id));
    else list.forEach((r) => next.delete(r.id));
    setSelected(next);
  };

  const toggleOne = (id: string, v: boolean) => {
    const next = new Set(selected);
    if (v) next.add(id); else next.delete(id);
    setSelected(next);
  };

  const reset = () => { setSelected(new Set()); setVendor(""); };

  const handleModeChange = (m: Mode) => { setMode(m); reset(); };

  const submit = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) { toast.error("কমপক্ষে একটি রেকর্ড সিলেক্ট করুন"); return; }
    if (!vendor.trim()) { toast.error("Vendor সিলেক্ট করুন"); return; }

    setSaving(true);
    try {
      const patch: Record<string, unknown> = mode === "send"
        ? { vendor_bought: vendor, vendor_sent_date: todayIso() }
        : { received_date: todayIso(), status: "Card Ready" };

      const { error } = await supabase.from("bmet_cards").update(patch).in("id", ids);
      if (error) throw error;
      toast.success(`${ids.length}টি রেকর্ড আপডেট হয়েছে`);
      reset();
      setOpen(false);
      await onChanged();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("সমস্যা: " + msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="default"
        onClick={() => setOpen(true)}
        className="h-10 gap-1.5 bg-amber-500 hover:bg-amber-600 text-white"
        title="Quickly Manage BMET"
      >
        <Zap className="h-4 w-4" /> Quickly Manage Bmet
      </Button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Quickly Manage BMET</DialogTitle>
          </DialogHeader>

          <RadioGroup
            value={mode}
            onValueChange={(v) => handleModeChange(v as Mode)}
            className="grid sm:grid-cols-2 gap-3"
          >
            <label className="flex items-center gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/40">
              <RadioGroupItem value="send" id="qm-send" />
              <span className="text-sm font-medium">একাধিক BMET vendor কে Send করো</span>
            </label>
            <label className="flex items-center gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/40">
              <RadioGroupItem value="receive" id="qm-recv" />
              <span className="text-sm font-medium">একাধিক BMET vendor থেকে Receive করো</span>
            </label>
          </RadioGroup>

          <div className="text-sm text-muted-foreground">
            মোট {list.length} টি রেকর্ড পাওয়া গেছে
            {mode === "send" ? " (Vendor Sent Date খালি)" : " (Received Date খালি)"}
            · সিলেক্টেড: {selected.size}
          </div>

          <div className="border rounded-md overflow-x-auto max-h-[50vh] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allChecked ? true : (someChecked ? "indeterminate" : false)}
                      onCheckedChange={(v) => toggleAll(Boolean(v))}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Passenger</TableHead>
                  <TableHead>Passport</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Current Vendor</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      কোনো রেকর্ড পাওয়া যায়নি
                    </TableCell>
                  </TableRow>
                ) : list.map((r) => (
                  <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(r.id)}
                        onCheckedChange={(v) => toggleOne(r.id, Boolean(v))}
                      />
                    </TableCell>
                    <TableCell>{String(r.entry_date ?? "")}</TableCell>
                    <TableCell className="font-medium">{String(r.passenger_name ?? "")}</TableCell>
                    <TableCell>{String(r.passport ?? "")}</TableCell>
                    <TableCell>{String(r.country_name ?? "")}</TableCell>
                    <TableCell>{String(r.vendor_bought ?? "")}</TableCell>
                    <TableCell>{String(r.status ?? "")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 sm:items-end sm:justify-between pt-2 border-t">
            <div className="space-y-1.5 flex-1 max-w-md">
              <Label className="text-sm font-medium">Vendor</Label>
              <LookupSelect kind="vendor" value={vendor} onChange={setVendor} compact />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>বাতিল</Button>
              <Button onClick={submit} disabled={saving || selected.size === 0 || !vendor}>
                {saving ? "প্রসেস হচ্ছে..." : (mode === "send" ? "Send" : "Receive Summary")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
