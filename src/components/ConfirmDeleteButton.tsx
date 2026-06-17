import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { PasswordConfirmDialog } from "@/components/PasswordConfirmDialog";

interface Props {
  onConfirm: () => void | Promise<void>;
  title?: string;
  description?: ReactNode;
  disabled?: boolean;
  /**
   * The user id of whoever created this row. When provided and it does not
   * match the signed-in user, deletion is blocked (only the creator may
   * delete their own entry).
   */
  ownerId?: string | null;
  /**
   * The calling page already guarantees this row belongs to the current user
   * (e.g. a personal cash-drawer list) — skip the ownerId comparison.
   */
  allowOwner?: boolean;
}

export function ConfirmDeleteButton({
  onConfirm,
  title = "ডিলেট নিশ্চিত করুন?",
  description = "এই এন্ট্রি স্থায়ীভাবে মুছে যাবে এবং সংশ্লিষ্ট সকল হিসাব থেকেও সরে যাবে। নিশ্চিত করতে আপনার লগইন পাসওয়ার্ড দিন।",
  disabled,
  ownerId,
  allowOwner = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const { user } = useCurrentUser();

  const handleClick = () => {
    // Only the creator can delete their own entry.
    if (!allowOwner && ownerId != null && user?.id && ownerId !== user.id) {
      toast.error("এটি অন্য ইউজারের এন্ট্রি — আপনি ডিলিট করতে পারবেন না।");
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
      <PasswordConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel="হ্যাঁ, ডিলেট"
        confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onConfirmed={onConfirm}
      />
    </>
  );
}
