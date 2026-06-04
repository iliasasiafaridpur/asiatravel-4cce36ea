import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MOBILE_COLOR_OPTIONS,
  useMobileColors,
  useSetMobileColor,
  type MobileColor,
} from "@/hooks/useMobileColors";

/**
 * Three colored tick-mark buttons (white/default, blue, green) shown next to a
 * mobile number inside a profile. Tapping a color tags the mobile number with
 * that color; the active color shows a filled tick. The size of each button
 * matches the surrounding text font size (1em).
 */
export function MobileColorPicker({
  mobile,
  className,
}: {
  mobile: string | null | undefined;
  className?: string;
}) {
  const { colorFor } = useMobileColors();
  const setColor = useSetMobileColor();
  const current = colorFor(mobile);

  if (!mobile) return null;

  return (
    <span className={cn("inline-flex items-center gap-1 align-middle", className)}>
      {MOBILE_COLOR_OPTIONS.map((opt) => {
        const active = current === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.label}
            aria-label={opt.label}
            aria-pressed={active}
            onClick={(e) => {
              e.stopPropagation();
              void setColor(mobile, opt.value as MobileColor);
            }}
            className={cn(
              "inline-flex items-center justify-center rounded-full border transition-colors",
              opt.swatch,
              active
                ? "border-current bg-current/10 ring-1 ring-current"
                : "border-border opacity-60 hover:opacity-100",
            )}
            style={{ width: "1.15em", height: "1.15em" }}
          >
            <Check style={{ width: "0.8em", height: "0.8em" }} strokeWidth={3.5} />
          </button>
        );
      })}
    </span>
  );
}
