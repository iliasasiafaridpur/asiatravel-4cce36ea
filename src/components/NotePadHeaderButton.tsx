import { useState } from "react";
import { StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotePad } from "@/components/NotePad";

export function NotePadHeaderButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="Note Pad"
        title="Note Pad"
      >
        <StickyNote className="h-4 w-4" />
      </Button>
      <NotePad open={open} onOpenChange={setOpen} />
    </>
  );
}
