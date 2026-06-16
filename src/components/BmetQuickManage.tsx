import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
type Mode = "send" | "ready" | "receive";

interface Props {
  rows: Row[];
  onChanged: () => void | Promise<void>;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const OPTIONS: { value: Mode; title: string; sub: string; btn: string }[] = [
  {
    value: "send",
    title: "একাধিক BMET, vendor কে Send করো",
    sub: '"NEW" Status থেকে "File Process" Status করা হবে।',
    btn: "Send",
  },
  {
    value: "ready",
    title: "BMET, Vendor এর কাছে Ready হয়েছে।",
    sub: 'স্টাটাস পরিবর্তন - File Process থেকে Card Ready করা হবে।',
    btn: "Card Ready",
  },
  {
    value: "receive",
    title: "BMET, Vendor থেকে Receive করা হবে।",
    sub: 'স্টাটাস পরিবর্তন - Card Ready থেকে Pending Delivery করা হবে। ও খাতায় লেখা হয়েছে।',
    btn: "Receive BMET",
  },
];

export function BmetQuickManage({ rows, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("send");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [vendor, setVendor] = useState<string>("");
  const [costPrices, setCostPrices] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [nameQuery, setNameQuery] = useState("");
  const [dateQuery, setDateQuery] = useState("");

  const list = useMemo(() => {
    // বাতিল করা কার্ড চলমান কাজের তালিকায় আসবে না।
    const active = rows.filter((r) => !r.cancelled);
    let base: Row[];
    if (mode === "send") {
      base = active.filter((r) => !r.vendor_sent_date);
    } else if (mode === "ready") {
      base = active.filter((r) => r.status === "File Process");
    } else {
      // receive
      base = active.filter((r) => r.status === "Card Ready" && !r.received_date);
    }

    const name = nameQuery.trim().toLowerCase();
    const date = dateQuery.trim();
    return base.filter((r) => {
      if (name && !String(r.passenger_name ?? "").toLowerCase().includes(name)) return false;
      if (date && !String(r.entry_date ?? "").includes(date)) return false;
      return true;
    });
  }, [rows, mode, nameQuery, dateQuery]);

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

  const reset = () => { setSelected(new Set()); setVendor(""); setCostPrices({}); setNameQuery(""); setDateQuery(""); };

  const handleModeChange = (m: Mode) => { setMode(m); reset(); };

  const currentOption = OPTIONS.find((o) => o.value === mode)!;

  const submit = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) { toast.error("কমপক্ষে একটি রেকর্ড সিলেক্ট করুন"); return; }
    if (mode === "send" && !vendor.trim()) { toast.error("Vendor সিলেক্ট করুন"); return; }

    setSaving(true);
    try {
      const patch =
        mode === "send"
          ? { vendor_bought: vendor, vendor_sent_date: todayIso(), status: "File Process" }
          : mode === "ready"
          ? { status: "Card Ready" }
          : { status: "Pending Delivery", received_date: todayIso() };

      const { error } = await supabase.from("bmet_cards").update(patch).in("id", ids);
      if (error) throw error;

      // Persist any edited cost prices for the selected rows
      const costUpdates = ids
        .map((id) => {
          const raw = costPrices[id];
          if (raw === undefined || raw === "") return null;
          const n = Number(raw);
          if (Number.isNaN(n)) return null;
          const original = Number(rows.find((r) => r.id === id)?.cost_price ?? 0);
          if (n === original) return null;
          return { id, cost_price: n };
        })
        .filter(Boolean) as { id: string; cost_price: number }[];

      if (costUpdates.length) {
        await Promise.all(
          costUpdates.map((u) =>
            supabase.from("bmet_cards").update({ cost_price: u.cost_price }).eq("id", u.id),
          ),
        );
      }

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
            className="grid grid-cols-1 md:grid-cols-3 gap-3"
          >
            {OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/40 ${mode === opt.value ? "border-primary bg-muted/30" : ""}`}
              >
                <RadioGroupItem value={opt.value} id={`qm-${opt.value}`} className="mt-1" />
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium leading-snug">{opt.title}</span>
                  <span className="text-xs text-muted-foreground leading-snug">{opt.sub}</span>
                </div>
              </label>
            ))}
          </RadioGroup>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              মোট {list.length} টি রেকর্ড পাওয়া গেছে · সিলেক্টেড: {selected.size}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                type="date"
                value={dateQuery}
                onChange={(e) => setDateQuery(e.target.value)}
                className="h-8 w-full sm:w-40 text-sm"
                title="এন্ট্রি তারিখ সার্চ"
              />
              <Input
                value={nameQuery}
                onChange={(e) => setNameQuery(e.target.value)}
                placeholder="নাম সার্চ..."
                className="h-8 w-full sm:w-48 text-sm"
                title="নাম সার্চ"
              />
            </div>
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
                  <TableHead>Mobile</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Current Vendor</TableHead>
                  <TableHead className="w-32">Cost Price</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
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
                    <TableCell>{String(r.mobile ?? "")}</TableCell>
                    <TableCell>{String(r.country_name ?? "")}</TableCell>
                    <TableCell>{String(r.vendor_bought ?? "")}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        value={costPrices[r.id] ?? (r.cost_price != null ? String(r.cost_price) : "")}
                        onChange={(e) => setCostPrices((p) => ({ ...p, [r.id]: e.target.value }))}
                        className="h-8 w-28 text-sm"
                        placeholder="0"
                      />
                    </TableCell>
                    <TableCell>{String(r.status ?? "")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className={`flex flex-col sm:flex-row gap-3 sm:items-end pt-2 border-t ${mode === "send" ? "sm:justify-between" : "sm:justify-end"}`}>
            {mode === "send" && (
              <div className="space-y-1.5 flex-1 max-w-md">
                <Label className="text-sm font-medium">Vendor</Label>
                <LookupSelect kind="vendor" value={vendor} onChange={setVendor} compact />
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>বাতিল</Button>
              <Button onClick={submit} disabled={saving || selected.size === 0 || (mode === "send" && !vendor)}>
                {saving ? "প্রসেস হচ্ছে..." : currentOption.btn}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
