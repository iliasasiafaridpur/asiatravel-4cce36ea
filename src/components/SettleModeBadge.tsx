import { Badge } from "@/components/ui/badge";

/**
 * Small badge showing a party's saved settlement preference:
 * - "total"      → মোটের উপর (Auto FIFO)
 * - "one_by_one" → এক একটা বিল (Bill-by-Bill)
 */
export function SettleModeBadge({ mode }: { mode?: string | null }) {
  const oneByOne = mode === "one_by_one";
  return (
    <Badge
      variant="outline"
      className={
        oneByOne
          ? "border-amber-500/50 text-amber-600 text-[10px] whitespace-nowrap"
          : "border-sky-500/50 text-sky-600 text-[10px] whitespace-nowrap"
      }
    >
      {oneByOne ? "এক একটা বিল" : "মোটের উপর"}
    </Badge>
  );
}
