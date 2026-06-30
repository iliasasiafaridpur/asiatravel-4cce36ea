import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { capitalizeWords, maskMobile, partySerialCode } from "@/lib/format";

interface Props {
  kind: "agent" | "vendor";
  onCreated?: () => void;
}

/**
 * Dedicated "New ID Create" entry point for agents/vendors.
 * Inserts directly into the agents/vendors table so the DB trigger
 * (assign_agent_identity / assign_vendor_identity) always assigns the
 * next serial_no + code — independent of the module entry/edit form.
 */
export function NewPartyDialog({ kind, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const table = kind === "agent" ? "agents" : "vendors";
  const label = kind === "agent" ? "Agency" : "Vendor";

  const reset = () => {
    setName("");
    setPhone("");
    setAddress("");
    setNotes("");
  };

  const handleSave = async () => {
    const clean = capitalizeWords(name.trim());
    if (!clean) {
      toast.error("নাম লিখুন");
      return;
    }
    setSaving(true);
    try {
      // Guard against duplicate names (parties are keyed by name).
      const { data: existing } = await supabase
        .from(table)
        .select("name,serial_no")
        .ilike("name", clean)
        .limit(1);
      if (existing && existing.length > 0) {
        toast.error(`"${clean}" নামে ${label} আগে থেকেই আছে।`);
        setSaving(false);
        return;
      }

      const { data, error } = await supabase
        .from(table)
        .insert({
          name: clean,
          phone: phone.trim() || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
        } as never)
        .select("serial_no")
        .single();

      if (error) throw error;

      // Keep the dropdown lookups in sync so the new party shows in entry forms too.
      await supabase
        .from("lookups")
        .upsert(
          { category: kind === "agent" ? "agents" : "vendors", value: clean } as never,
          { onConflict: "category,value" } as never,
        );

      const serial = (data as { serial_no: number | null } | null)?.serial_no ?? null;
      toast.success(
        `নতুন ${label} তৈরি হয়েছে — ${partySerialCode(kind, serial)} ${clean}`,
      );
      reset();
      setOpen(false);
      onCreated?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`তৈরি করা যায়নি: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 gap-1">
          <Plus className="h-4 w-4" /> New ID Create
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>নতুন {label} তৈরি (আইডি সহ)</DialogTitle>
          <DialogDescription>
            নাম দিয়ে সেভ করলে স্বয়ংক্রিয়ভাবে নতুন আইডি ({kind === "agent" ? "A-###" : "V-###"})
            তৈরি হবে এবং তালিকায় যুক্ত হবে।
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="np-name">নাম *</Label>
            <Input
              id="np-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${label} এর নাম`}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-phone">মোবাইল</Label>
            <Input
              id="np-phone"
              value={phone}
              onChange={(e) => setPhone(maskMobile(e.target.value))}
              placeholder="01XXX-XXXXXX"
              inputMode="numeric"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-address">ঠিকানা</Label>
            <Input
              id="np-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="ঠিকানা (ঐচ্ছিক)"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-notes">নোট</Label>
            <Textarea
              id="np-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="নোট (ঐচ্ছিক)"
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            বাতিল
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            সেভ করুন
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
