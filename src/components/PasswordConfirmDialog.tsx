import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { toast } from "sonner";
import type { ReactNode } from "react";

/** Verify the currently signed-in user's password without disturbing the session. */
export async function verifyCurrentPassword(email: string, password: string): Promise<boolean> {
  if (!email || !password) return false;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return !error;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title?: string;
  description?: ReactNode;
  confirmLabel?: string;
  confirmClassName?: string;
  onConfirmed: () => void | Promise<void>;
}

export function PasswordConfirmDialog({
  open,
  onOpenChange,
  title = "পাসওয়ার্ড দিয়ে নিশ্চিত করুন",
  description = "নিশ্চিত করতে আপনার লগইন পাসওয়ার্ড দিন।",
  confirmLabel = "নিশ্চিত করুন",
  confirmClassName,
  onConfirmed,
}: Props) {
  const { user } = useCurrentUser();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  const close = (o: boolean) => {
    if (busy) return;
    if (!o) setPw("");
    onOpenChange(o);
  };

  const verify = async () => {
    if (!pw.trim()) {
      toast.error("পাসওয়ার্ড দিন");
      return;
    }
    if (!user?.email) {
      toast.error("ইউজার তথ্য পাওয়া যায়নি");
      return;
    }
    setBusy(true);
    try {
      const ok = await verifyCurrentPassword(user.email, pw);
      if (!ok) {
        toast.error("ভুল পাসওয়ার্ড");
        return;
      }
      await onConfirmed();
      setPw("");
      onOpenChange(false);
    } catch {
      toast.error("সমস্যা হয়েছে, আবার চেষ্টা করুন");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" /> {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-sm">আপনার পাসওয়ার্ড</Label>
          <Input
            type="password"
            autoFocus
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") verify(); }}
            placeholder="••••••••"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>ফিরে যান</Button>
          <Button onClick={verify} disabled={busy} className={confirmClassName}>
            {busy ? "যাচাই হচ্ছে..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
