import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MasterSearch } from "@/components/MasterSearch";

export function MasterSearchHeaderButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="সব কিছু খুঁজুন"
        title="সব কিছু খুঁজুন"
      >
        <Search className="h-4 w-4" />
      </Button>
      <MasterSearch open={open} onOpenChange={setOpen} />
    </>
  );
}
