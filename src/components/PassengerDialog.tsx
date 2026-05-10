import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { STATUSES, type Status } from "@/lib/passengers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const schema = z.object({
  passenger_name: z.string().min(1, "নাম দিন"),
  passport: z.string().min(1, "পাসপোর্ট দিন"),
  status: z.enum(STATUSES),
  notes: z.string().optional(),
});
type FormVals = z.infer<typeof schema>;

export type PassengerRow = {
  id: string;
  passenger_id: string;
  passenger_name: string;
  passport: string;
  status: string;
  notes: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing?: PassengerRow | null;
}

export function PassengerDialog({ open, onOpenChange, editing }: Props) {
  const qc = useQueryClient();
  const [genId, setGenId] = useState<string | null>(null);

  const form = useForm<FormVals>({
    resolver: zodResolver(schema),
    defaultValues: {
      passenger_name: editing?.passenger_name ?? "",
      passport: editing?.passport ?? "",
      status: (editing?.status as Status) ?? "Pending",
      notes: editing?.notes ?? "",
    },
    values: {
      passenger_name: editing?.passenger_name ?? "",
      passport: editing?.passport ?? "",
      status: (editing?.status as Status) ?? "Pending",
      notes: editing?.notes ?? "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (vals: FormVals) => {
      if (editing) {
        const { error } = await supabase
          .from("passengers")
          .update(vals)
          .eq("id", editing.id);
        if (error) throw error;
        return editing.passenger_id;
      } else {
        const { data: nextId, error: idErr } = await supabase.rpc("next_passenger_id");
        if (idErr) throw idErr;
        const { error } = await supabase.from("passengers").insert({
          ...vals,
          passenger_id: nextId as string,
        });
        if (error) throw error;
        setGenId(nextId as string);
        return nextId as string;
      }
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["passengers"] });
      toast.success(editing ? "আপডেট হয়েছে" : `তৈরি হয়েছে: ${id}`);
      onOpenChange(false);
      form.reset();
      setGenId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `এডিট: ${editing.passenger_id}` : "নতুন প্যাসেঞ্জার"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
          {!editing && (
            <p className="text-xs text-muted-foreground">
              ID স্বয়ংক্রিয়ভাবে তৈরি হবে: <span className="font-mono font-semibold text-primary">MAN-YYMM-###</span>
            </p>
          )}
          <div className="space-y-2">
            <Label>Passenger Name</Label>
            <Input {...form.register("passenger_name")} placeholder="পূর্ণ নাম" />
            {form.formState.errors.passenger_name && (
              <p className="text-xs text-destructive">{form.formState.errors.passenger_name.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Passport</Label>
            <Input {...form.register("passport")} placeholder="পাসপোর্ট নং" />
            {form.formState.errors.passport && (
              <p className="text-xs text-destructive">{form.formState.errors.passport.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={form.watch("status")}
              onValueChange={(v) => form.setValue("status", v as Status)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea {...form.register("notes")} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>বাতিল</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "সেভ" : "তৈরি করুন"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
