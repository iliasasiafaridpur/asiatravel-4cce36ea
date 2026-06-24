import { Badge } from "@/components/ui/badge";

/**
 * Small badge showing a party's saved settlement preference:
 * - "total"      → মোটের উপর (Auto FIFO)
 * - "one_by_one" → এক একটা বিল (Bill-by-Bill)
 *
 * `unset` (no contact card / no saved choice) is shown distinctly so staff can
 * see at a glance which parties are silently defaulting to Auto FIFO (M-2).
 */
export function SettleModeBadge({ mode }: { mode?: string | null }) {
  if (!mode) {
    return (
      <Badge
        variant="outline"
        className="border-orange-500/50 text-orange-600 text-[10px] whitespace-nowrap"
        title="হিসাব ধরন সেট করা নেই — নিরবে মোটের উপর (Auto FIFO) ধরা হচ্ছে"
      >
        ⚠️ সেট নেই
      </Badge>
    );
  }
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
