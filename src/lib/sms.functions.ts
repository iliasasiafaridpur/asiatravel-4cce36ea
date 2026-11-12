import { normalizeBdMobile } from "./sms";
import { supabase } from "@/integrations/supabase/client";

type Input = {
  mobile: string;
  message: string;
  kind?: string;
  module_key?: string;
  ref_id?: string;
  passenger_name?: string;
};

export async function sendSms(args: { data: Input }): Promise<{ ok: boolean; error?: string }> {
  const i = args.data;
  const message = String(i?.message ?? "").trim();
  const number = normalizeBdMobile(i?.mobile ?? "");

  if (!message) return { ok: false, error: "মেসেজ খালি" };
  if (!number) return { ok: false, error: "সঠিক মোবাইল নম্বর নেই" };

  // ১. ডেটাবেস থেকে Gateway সেটিংস লোড করা
  const { data: s, error: se } = await supabase
    .from("sms_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (se) return { ok: false, error: "সেটিংস লোড হয়নি: " + se.message };
  if (!s || !s.enabled) return { ok: false, error: "SMS বন্ধ আছে (Gateway সেটিংস দেখুন)" };
  if (!s.api_url || !s.api_key) return { ok: false, error: "Gateway URL বা API Key সেট করা নেই" };

  // ২. স্বয়ংক্রিয়ভাবে https নিশ্চিত করা ও ভ্যারিয়েবল রিপ্লেস করা
  const enc = encodeURIComponent;
  let apiUrl = (s.api_url || "").trim();
  if (apiUrl.startsWith("http://")) {
    apiUrl = "https://" + apiUrl.slice(7);
  }

  const url = apiUrl
    .replace(/\{api_key\}/g, enc(s.api_key))
    .replace(/\{sender_id\}/g, enc(s.sender_id ?? ""))
    .replace(/\{number\}/g, enc(number))
    .replace(/\{message\}/g, enc(message));

  // ৩. হিস্ট্রির জন্য এসএমএস লগ সংরক্ষণ
  const { data: u } = await supabase.auth.getUser();
  const saveLog = async (success: boolean, response: string) => {
    try {
      await supabase.from("sms_logs").insert({
        mobile: number,
        message,
        kind: i.kind ?? "manual",
        module_key: i.module_key ?? null,
        ref_id: i.ref_id ?? null,
        passenger_name: i.passenger_name ?? null,
        success,
        response: response.slice(0, 500),
        sent_by: u.user?.id ?? null,
      });
    } catch {
      // লগ টেবিল সংক্রান্ত ব্যর্থতা মূল মেসেজ পাঠানোতে বাধা দেবে না
    }
  };

  // ৪. সরাসরি ব্রাউজার থেকে BulkSMSBD সার্ভারে রিকোয়েস্ট পাঠানো (সার্ভারলেস)
  try {
    const res = await fetch(url, { method: "GET" });
    const text = await res.text();
    let ok = res.ok;
    let detailMsg = text;

    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      const code = j.response_code ?? j.code ?? j.status_code;
      if (code !== undefined && ![200, 202, "200", "202", "SENT", "success"].includes(code as never)) {
        ok = false;
        detailMsg = String(j.error_message || j.message || text);
      }
      if (j.error && j.error !== 0 && j.error !== "0") {
        ok = false;
        detailMsg = String(j.error_message || j.message || text);
      }
    } catch {
      // সাধারণ টেক্সট রেসপন্স
    }

    await saveLog(ok, `${res.status} ${text}`);

    if (ok) {
      return { ok: true };
    } else {
      return { ok: false, error: detailMsg.slice(0, 150) };
    }
  } catch (e) {
    const errText = e instanceof Error ? e.message : String(e);
    await saveLog(false, "Fetch Error: " + errText);
    return { ok: false, error: "ব্রাউজার সংযোগ ত্রুটি (" + errText + ")" };
  }
}
