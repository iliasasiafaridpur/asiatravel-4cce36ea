import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A tiny inline copy button sized to the surrounding font (1em). Tapping it
 * copies the provided text to the clipboard and briefly shows a check mark.
 * Placed to the right of passport / mobile numbers in the data list.
 */
export function CopyInlineButton({
  value,
  className,
}: {
  value: string | null | undefined;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  if (!value) return null;

  return (
    <button
      type="button"
      title="কপি করুন"
      aria-label="কপি করুন"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = value;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand("copy");
          } catch {
            /* ignore */
          }
          document.body.removeChild(ta);
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      className={cn(
        "inline-flex items-center justify-center rounded align-middle ml-1 text-muted-foreground transition-colors hover:text-primary",
        className,
      )}
      style={{ width: "1.15em", height: "1.15em" }}
    >
      {copied ? (
        <Check style={{ width: "0.9em", height: "0.9em" }} className="text-emerald-500" strokeWidth={3} />
      ) : (
        <Copy style={{ width: "0.9em", height: "0.9em" }} strokeWidth={2.5} />
      )}
    </button>
  );
}
