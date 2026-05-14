import type { LucideIcon } from "lucide-react";

export type StatTone = "primary" | "success" | "warning" | "info" | "danger" | "neutral";

const TONE_MAP: Record<StatTone, string> = {
  primary: "from-primary/15 to-primary/5 text-primary border-primary/20",
  success: "from-emerald-500/15 to-emerald-500/5 text-emerald-600 border-emerald-500/20",
  warning: "from-amber-500/15 to-amber-500/5 text-amber-600 border-amber-500/20",
  info:    "from-sky-500/15 to-sky-500/5 text-sky-600 border-sky-500/20",
  danger:  "from-rose-500/15 to-rose-500/5 text-rose-600 border-rose-500/20",
  neutral: "from-muted/60 to-muted/20 text-foreground border-border",
};

interface StatCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: StatTone;
  format?: "number" | "currency" | "raw";
  hint?: string;
  onClick?: () => void;
}

const fmt = (v: number | string, kind: StatCardProps["format"]) => {
  if (typeof v === "string") return v;
  if (kind === "raw") return String(v);
  if (kind === "currency") return `৳ ${(v || 0).toLocaleString()}`;
  return (v || 0).toLocaleString();
};

export function StatCard({ label, value, icon: Icon, tone = "primary", format = "number", hint, onClick }: StatCardProps) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`text-left w-full rounded-xl border bg-gradient-to-br ${TONE_MAP[tone]} p-3 sm:p-4 transition-all hover:shadow-md ${onClick ? "hover:scale-[1.01] active:scale-[0.99] cursor-pointer" : ""}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] sm:text-xs font-medium opacity-80 truncate">{label}</span>
        <Icon className="h-4 w-4 opacity-70 shrink-0" />
      </div>
      <div className="text-lg sm:text-2xl font-bold tabular-nums tracking-tight truncate">
        {fmt(value, format)}
      </div>
      {hint && <div className="text-[10px] opacity-60 mt-0.5 truncate">{hint}</div>}
    </Wrapper>
  );
}
