interface Props {
  text: string;
}

/**
 * Fixed, large, angled watermark shown behind the page content.
 * Stays in the same screen position while the page scrolls.
 */
export function PageWatermark({ text }: Props) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 flex items-center justify-center overflow-hidden select-none print:hidden"
    >
      <span
        className="whitespace-nowrap font-extrabold uppercase tracking-widest text-foreground/[0.05] dark:text-foreground/[0.06]"
        style={{
          transform: "rotate(-30deg)",
          fontSize: "clamp(3rem, 12vw, 11rem)",
          lineHeight: 1,
        }}
      >
        {text}
      </span>
    </div>
  );
}
