interface Props {
  text: string;
  /** "default" = standard size, "sm" = half size */
  size?: "default" | "sm";
}

/**
 * Fixed, angled watermark shown OVER the page content with very low opacity,
 * so it reads "through" the data (rows have solid backgrounds that would
 * otherwise hide a behind-the-content watermark). Stays in the same screen
 * position while the page scrolls and never intercepts clicks.
 */
export function PageWatermark({ text, size = "default" }: Props) {
  const fontSize =
    size === "sm"
      ? "clamp(0.75rem, 3vw, 2.75rem)"
      : "clamp(1.5rem, 6vw, 5.5rem)";
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center overflow-hidden select-none print:hidden"
    >
      <span
        className="whitespace-nowrap font-extrabold uppercase tracking-widest text-foreground/[0.07] dark:text-foreground/[0.08]"
        style={{
          transform: "rotate(-30deg)",
          fontSize,
          lineHeight: 1,
        }}
      >
        {text}
      </span>
    </div>
  );
}
