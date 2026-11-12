// Client-safe SMS helpers: number normalisation + template fill.
export const SMS_MODULES = [
  { key: "tickets", label: "Air Ticket" },
  { key: "bmet", label: "BMET Card" },
  { key: "saudi-visa", label: "Saudi Visa" },
  { key: "kuwait-visa", label: "Kuwait Visa" },
  { key: "other", label: "Other" },
] as const;

export const SMS_TAGS = [
  "{customer_name}",
  "{passport_no}",
  "{service_name}",
  "{status}",
  "{ref_id}",
  "{price}",
  "{due_amount}",
  "{company}",
];

export const DEFAULT_STATUS_TEMPLATE =
  "Dear {customer_name}, your {service_name} ({ref_id}) status: {status}. Regards, {company}";
export const DEFAULT_DUE_TEMPLATE =
  "Dear {customer_name}, reminder: BDT {due_amount} is due for {service_name} ({ref_id}). Regards, {company}";

/** BD mobile → 8801XXXXXXXXX; returns null if not a valid BD mobile. */
export function normalizeBdMobile(raw: unknown): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  let n = d;
  if (n.startsWith("00")) n = n.slice(2);
  if (n.startsWith("880")) n = n.slice(3);
  if (n.startsWith("0")) n = n.slice(1);
  if (/^1[3-9]\d{8}$/.test(n)) return "880" + n;
  return null;
}

export function fillTemplate(body: string, vars: Record<string, string | number | null | undefined>): string {
  return body.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m === "{company}" ? "" : ""));
}

import { supabase } from "@/integrations/supabase/client";
import { sendSms } from "./sms.functions";

/** Send the status-change SMS for one booking row, using the saved template. */
export async function sendStatusSms(opts: {
  row: Record<string, unknown>;
  moduleKey: string;
  status: string;
  serviceName: string;
  refId: string;
  due?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const [{ data: tpl }, { data: s }] = await Promise.all([
    supabase
      .from("sms_templates")
      .select("body")
      .eq("module_key", opts.moduleKey)
      .eq("status", opts.status)
      .maybeSingle(),
    supabase.from("sms_settings").select("company_name").eq("id", 1).maybeSingle(),
  ]);

  const sold = Number(opts.row.sold_price ?? 0);
  const recv = Number(opts.row.received_amount ?? opts.row.received ?? opts.row.paid_amount ?? 0);
  const disc = Number(opts.row.discount_amount ?? 0);
  const autoDue = Math.max(0, sold - recv - disc);
  const effectiveDue = opts.due !== undefined ? opts.due : autoDue;

  const formattedPrice = sold > 0 ? (sold >= 1000 ? sold.toLocaleString("en-US") : String(sold)) : "";
  const formattedDue = effectiveDue > 0 ? (effectiveDue >= 1000 ? effectiveDue.toLocaleString("en-US") : String(effectiveDue)) : "0";

  const message = fillTemplate(tpl?.body || DEFAULT_STATUS_TEMPLATE, {
    customer_name: String(opts.row.passenger_name ?? ""),
    passport_no: String(opts.row.passport ?? ""),
    service_name: opts.serviceName,
    status: opts.status,
    ref_id: opts.refId,
    price: formattedPrice,
    due_amount: formattedDue,
    company: s?.company_name ?? "",
  });

  return sendSms({
    data: {
      mobile: String(opts.row.mobile ?? ""),
      message,
      kind: "status",
      module_key: opts.moduleKey,
      ref_id: opts.refId,
      passenger_name: String(opts.row.passenger_name ?? ""),
    },
  });
}
