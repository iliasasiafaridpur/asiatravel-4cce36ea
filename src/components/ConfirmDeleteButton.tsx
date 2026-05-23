import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface Props {
  onConfirm: () => void | Promise<void>;
  title?: string;
  description?: ReactNode;
  disabled?: boolean;
  /** Allow non-admin users (e.g. row owner on their personal accounts page). */
  allowOwner?: boolean;
}

export function ConfirmDeleteButton({
  onConfirm,
  title = "ডিলেট নিশ্চিত করুন?",
  description = "এই এন্ট্রি স্থায়ীভাবে মুছে যাবে এবং সংশ্লিষ্ট সকল হিসাব থেকেও সরে যাবে।",
  disabled,
  allowOwner = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { profile } = useCurrentUser();
  const isAdmin = profile?.role === "admin";

  const handleClick = () => {
    if (!isAdmin && !allowOwner) {
      toast.error("আপনার ডিলিট করার অনুমতি নেই। Admin-এর সাথে যোগাযোগ করুন।");
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={disabled}
        onClick={handleClick}
        aria-label="Delete"
      >
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>বাতিল</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? "ডিলেট হচ্ছে..." : "হ্যাঁ, ডিলেট"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
