interface Props {
  text: string;
}

/**
 * Fixed, angled watermark shown OVER the page content with very low opacity,
 * so it reads "through" the data (rows have solid backgrounds that would
 * otherwise hide a behind-the-content watermark). Stays in the same screen
 * position while the page scrolls and never intercepts clicks.
 */
export function PageWatermark({ text }: Props) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center overflow-hidden select-none print:hidden"
    >
      <span
        className="whitespace-nowrap font-extrabold uppercase tracking-widest text-foreground/[0.07] dark:text-foreground/[0.08]"
        style={{
          transform: "rotate(-30deg)",
          fontSize: "clamp(1.5rem, 6vw, 5.5rem)",
          lineHeight: 1,
        }}
      >
        {text}
      </span>
    </div>
  );
}
