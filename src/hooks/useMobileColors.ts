import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Shared per-mobile-number color tag.
 * A staff member can tag a mobile number with a color (default / blue / green)
 * from a passenger / customer profile. The chosen color is then reflected on
 * the mobile number everywhere it appears: every module data page, the customer
 * data page, and the profile drawers.
 */
export type MobileColor = "default" | "red" | "green";

export const MOBILE_COLOR_OPTIONS: { value: MobileColor; label: string; swatch: string; text: string }[] = [
  { value: "default", label: "সাদা", swatch: "text-foreground", text: "" },
  { value: "red", label: "লাল", swatch: "text-red-500", text: "text-red-500" },
  { value: "green", label: "সবুজ", swatch: "text-emerald-500", text: "text-emerald-500" },
];

/** Tailwind text-color class for a given mobile color (empty = inherit/default). */
export function mobileColorTextClass(color: MobileColor | undefined): string {
  if (color === "red") return "text-red-500";
  if (color === "green") return "text-emerald-500";
  return "";
}

export const normalizeMobileForColor = (mobile: string) => {
  const raw = mobile.trim();
  // Store/compare by digits only so 01711-123456, 01711123456, or spaced
  // versions all receive the same red/green mark everywhere in the project.
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("880") && digits.length === 13) return `0${digits.slice(3)}`;
  if (digits.startsWith("88") && digits.length === 13) return `0${digits.slice(2)}`;
  return digits || raw;
};

const normalize = normalizeMobileForColor;

function mobileCandidates(mobile: string): string[] {
  const raw = String(mobile ?? "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/[,;\n|]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return [raw, ...parts]
    .map(normalize)
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i);
}

type Row = { mobile: string; color: string };

/** Plain serialization-safe map of mobile -> color. */
export type MobileColorMap = Record<string, MobileColor>;

let colorCache: MobileColorMap = {};
let loaded = false;
let loading: Promise<void> | null = null;
let realtimeStarted = false;
const listeners = new Set<(next: MobileColorMap) => void>();

const emit = () => listeners.forEach((listener) => listener(colorCache));

function coerceColor(color: string | null | undefined): MobileColor {
  return color === "red" || color === "green" ? color : "default";
}

async function loadMobileColors() {
  if (loading) return loading;
  loading = (async () => {
    const { data, error } = await supabase
      .from("mobile_colors" as never)
      .select("mobile,color");
    if (error) {
      console.warn("mobile color load failed", error);
      return;
    }
    const next: MobileColorMap = {};
    for (const r of (data as unknown as Row[]) ?? []) {
      const mobile = normalize(r.mobile);
      const color = coerceColor(r.color);
      if (mobile && color !== "default") next[mobile] = color;
    }
    colorCache = next;
    loaded = true;
    emit();
  })().finally(() => {
    loading = null;
  });
  return loading;
}

function ensureRealtime() {
  if (realtimeStarted) return;
  realtimeStarted = true;
  supabase
    .channel("rt_mobile_colors_singleton")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "mobile_colors" },
      () => void loadMobileColors(),
    )
    .subscribe();
}

/**
 * Returns a plain object of mobile -> color plus realtime updates. Cached via
 * React Query so multiple consumers share a single fetch.
 *
 * IMPORTANT: the data MUST stay JSON-serializable (a plain object, NOT a Map).
 * The React Query cache is persisted to localStorage; a Map serializes to "{}"
 * and would deserialize to a plain object, which then breaks any `.get()` call
 * and crashes every data page. Keep this a plain Record.
 */
export function useMobileColors() {
  const [map, setMap] = useState<MobileColorMap>(colorCache);

  useEffect(() => {
    listeners.add(setMap);
    ensureRealtime();
    if (!loaded) void loadMobileColors();
    return () => {
      listeners.delete(setMap);
    };
  }, []);

  const colorFor = (mobile: string | null | undefined): MobileColor => {
    if (!mobile) return "default";
    for (const key of mobileCandidates(mobile)) {
      const color = map[key];
      if (color && color !== "default") return color;
    }
    return "default";
  };

  return { map, colorFor };
}

/** Hook providing a setter that upserts/deletes a mobile color tag. */
export function useSetMobileColor() {
  return async (mobile: string, color: MobileColor) => {
    const m = normalize(mobile);
    if (!m) return;
    if (color === "default") {
      const { error } = await supabase.from("mobile_colors" as never).delete().eq("mobile", m);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("mobile_colors" as never)
        .upsert({ mobile: m, color, updated_at: new Date().toISOString() } as never, {
          onConflict: "mobile",
        } as never);
      if (error) throw error;
    }
    colorCache = { ...colorCache };
    if (color === "default") delete colorCache[m];
    else colorCache[m] = color;
    loaded = true;
    emit();
  };
}
