import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Shared per-mobile-number color tag.
 * A staff member can tag a mobile number with a color (default / blue / green)
 * from a passenger / customer profile. The chosen color is then reflected on
 * the mobile number everywhere it appears: every module data page, the customer
 * data page, and the profile drawers.
 */
export type MobileColor = "default" | "blue" | "green";

export const MOBILE_COLOR_OPTIONS: { value: MobileColor; label: string; swatch: string; text: string }[] = [
  { value: "default", label: "সাদা", swatch: "text-foreground", text: "" },
  { value: "blue", label: "নীল", swatch: "text-blue-500", text: "text-blue-500" },
  { value: "green", label: "সবুজ", swatch: "text-emerald-500", text: "text-emerald-500" },
];

/** Tailwind text-color class for a given mobile color (empty = inherit/default). */
export function mobileColorTextClass(color: MobileColor | undefined): string {
  if (color === "blue") return "text-blue-500";
  if (color === "green") return "text-emerald-500";
  return "";
}

const normalize = (mobile: string) => mobile.trim();

const QUERY_KEY = ["mobile_colors"] as const;

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
  return color === "blue" || color === "green" ? color : "default";
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
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<MobileColorMap> => {
      const { data, error } = await supabase
        .from("mobile_colors" as never)
        .select("mobile,color");
      if (error) throw error;
      const map: MobileColorMap = {};
      for (const r of (data as unknown as Row[]) ?? []) {
        map[normalize(r.mobile)] = (r.color as MobileColor) ?? "default";
      }
      return map;
    },
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // Realtime: refresh the map when any color tag changes.
  useEffect(() => {
    const ch = supabase
      .channel("rt_mobile_colors")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mobile_colors" },
        () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const colorFor = (mobile: string | null | undefined): MobileColor => {
    if (!mobile || !data) return "default";
    return data[normalize(mobile)] ?? "default";
  };

  return { map: data, colorFor };
}

/** Hook providing a setter that upserts/deletes a mobile color tag. */
export function useSetMobileColor() {
  const qc = useQueryClient();
  return async (mobile: string, color: MobileColor) => {
    const m = normalize(mobile);
    if (!m) return;
    if (color === "default") {
      await supabase.from("mobile_colors" as never).delete().eq("mobile", m);
    } else {
      await supabase
        .from("mobile_colors" as never)
        .upsert({ mobile: m, color, updated_at: new Date().toISOString() } as never, {
          onConflict: "mobile",
        } as never);
    }
    await qc.invalidateQueries({ queryKey: QUERY_KEY });
  };
}
