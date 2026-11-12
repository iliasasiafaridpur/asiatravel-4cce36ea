import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeBdMobile } from "./sms";

type Input = {
  mobile: string;
  message: string;
  kind?: string;
  module_key?: string;
  ref_id?: string;
  passenger_name?: string;
};

export const sendSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: Input) => {
    const message = String(i?.message ?? "").trim();
    if (!message) throw new Error("মেসেজ খালি");
    if (message.length > 1000) throw new Error("মেসেজ অনেক বড়");
    return { ...i, message, mobile: String(i?.mobile ?? "") };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const number = normalizeBdMobile(data.mobile);
    const log = async (success: boolean, response: string) => {
      await supabase.from("sms_logs").insert({
        mobile: number ?? data.mobile, message: data.message, kind: data.kind ?? "manual",
        module_key: data.module_key ?? null, ref_id: data.ref_id ?? null,
        passenger_name: data.passenger_name ?? null, success, response: response.slice(0, 500), sent_by: userId,
      });
    };
    if (!number) return { ok: false, error: "সঠিক মোবাইল নম্বর নেই" };
    const { data: s } = await supabase.from("sms_settings").select("*").eq("id", 1).maybeSingle();
    if (!s || !s.enabled) return { ok: false, error: "SMS বন্ধ আছে (Settings দেখুন)" };
    if (!s.api_url || !s.api_key) return { ok: false, error: "SMS Gateway সেট করা হয়নি" };
    const enc = encodeURIComponent;
    const url = s.api_url
      .replace(/\{api_key\}/g, enc(s.api_key))
      .replace(/\{sender_id\}/g, enc(s.sender_id ?? ""))
      .replace(/\{number\}/g, enc(number))
      .replace(/\{message\}/g, enc(data.message));
    try {
      const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(20000) });
      const text = await res.text();
      // BulkSMSBD returns response_code 202 on success; other providers vary.
      let ok = res.ok;
      try {
        const j = JSON.parse(text) as Record<string, unknown>;
        const code = j.response_code ?? j.code ?? j.status_code;
        if (code !== undefined && ![200, 202, "200", "202", "SENT", "success"].includes(code as never)) ok = false;
        if (j.error && j.error !== 0 && j.error !== "0") ok = false;
      } catch { /* non-JSON response */ }
      await log(ok, `${res.status} ${text}`);
      return ok ? { ok: true } : { ok: false, error: "প্রোভাইডার: " + text.slice(0, 150) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await log(false, msg);
      return { ok: false, error: "প্রোভাইডারে সংযোগ হয়নি" };
    }
  });
