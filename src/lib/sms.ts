// Client-safe SMS helpers: number normalisation + template fill.
export const SMS_MODULES = [
  { key: "tickets", label: "Air Ticket" },
  { key: "bmet", label: "BMET Card" },
  { key: "saudi-visa", label: "Saudi Visa" },
  { key: "kuwait-visa", label: "Kuwait Visa" },
  { key: "other", label: "Other" },
] as const;

export const SMS_TAGS = ["{customer_name}", "{passport_no}", "{service_name}", "{status}", "{ref_id}", "{bill_amount}", "{paid_amount}", "{due_amount}", "{company}"];

export const DEFAULT_STATUS_TEMPLATE =
  "প্রিয় {customer_name}, আপনার {service_name} ({ref_id}) এর বর্তমান অবস্থা: {status}। ধন্যবাদ, {company}";
export const DEFAULT_DUE_TEMPLATE =
  "প্রিয় {customer_name}, আপনার {service_name} ({ref_id}) বাবদ ৳{due_amount} বকেয়া আছে। অনুগ্রহ করে পরিশোধ করুন। {company}";

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
  const out = body.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m === "{company}" ? "" : ""));
  // SMS-এ BMET কার্ডের নাম সবসময় "BMET EC CARD" লেখা হবে।
  return out.replace(/BMET\s+(?:EC\s+)?(?:Card|কার্ড)/gi, "BMET EC CARD");
}

import { supabase } from "@/integrations/supabase/client";
import { sendSms } from "./sms.functions";

/** Send the status-change SMS for one booking row, using the saved template. */
export async function sendStatusSms(opts: {
  row: Record<string, unknown>; moduleKey: string; status: string; serviceName: string; refId: string; due?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const [{ data: tpl }, { data: s }] = await Promise.all([
    supabase.from("sms_templates").select("body").eq("module_key", opts.moduleKey).eq("status", opts.status).maybeSingle(),
    supabase.from("sms_settings").select("company_name").eq("id", 1).maybeSingle(),
  ]);
  const message = fillTemplate(tpl?.body || DEFAULT_STATUS_TEMPLATE, {
    customer_name: String(opts.row.passenger_name ?? ""), passport_no: String(opts.row.passport ?? ""),
    service_name: opts.serviceName, status: opts.status, ref_id: opts.refId,
    due_amount: opts.due ?? 0, company: s?.company_name ?? "",
  });
  return sendSms({ data: { mobile: String(opts.row.mobile ?? ""), message, kind: "status", module_key: opts.moduleKey, ref_id: opts.refId, passenger_name: String(opts.row.passenger_name ?? "") } });
}

// ---- Payment receipt / agency reminder / latest status ----
export const PAYMENT_RECEIPT_STATUS = "PAYMENT_RECEIPT";
export const PAYMENT_PAID_STATUS = "PAYMENT_PAID";
export const AGENCY_MODULE_KEY = "agency";
export const AGENCY_DUE_STATUS = "AGENCY_DUE_REMINDER";
export const DEFAULT_PAYMENT_RECEIPT_TEMPLATE =
  "Dear {customer_name}, we received BDT {paid_amount} for your {service_name} ({ref_id}). Receipt: {receipt_no}. Current Due: BDT {due_amount}. Thank you, {company}";
export const DEFAULT_PAYMENT_PAID_TEMPLATE =
  "Dear {customer_name}, we received BDT {paid_amount} for your {service_name} ({ref_id}). Receipt: {receipt_no}. Your bill is fully paid. Thank you, {company}";
export const DEFAULT_AGENCY_DUE_TEMPLATE =
  "Dear {agency_name}, this is a gentle reminder that your current outstanding balance with {company} is BDT {due_amount}. Please settle the due at your earliest convenience. Thank you, {company}";
export const DEFAULT_LATEST_STATUS_TEMPLATE =
  "Dear {customer_name}, your {service_name} ({ref_id}) status: {status}. Total Bill: BDT {bill_amount}, Paid: BDT {paid_amount}, Due: BDT {due_amount}. Thank you, {company}";

const money = (n: unknown) => {
  const v = Number(String(n ?? 0).replace(/,/g, ""));
  return (Number.isFinite(v) ? Math.max(0, v) : 0).toLocaleString("en-US");
};

async function loadTpl(moduleKey: string, status: string) {
  const [{ data: tpl }, { data: s }] = await Promise.all([
    supabase.from("sms_templates").select("body").eq("module_key", moduleKey).eq("status", status).maybeSingle(),
    supabase.from("sms_settings").select("company_name").eq("id", 1).maybeSingle(),
  ]);
  return { body: tpl?.body as string | undefined, company: s?.company_name ?? "" };
}

export async function buildPaymentReceiptSms(o: { moduleKey: string; customerName: string; serviceName: string; refId: string; paid: number; due: number; receiptNo: string }) {
  const paidOff = o.due <= 0;
  const t = await loadTpl(o.moduleKey, paidOff ? PAYMENT_PAID_STATUS : PAYMENT_RECEIPT_STATUS);
  return fillTemplate(t.body || (paidOff ? DEFAULT_PAYMENT_PAID_TEMPLATE : DEFAULT_PAYMENT_RECEIPT_TEMPLATE), {
    customer_name: o.customerName, service_name: o.serviceName, ref_id: o.refId,
    paid_amount: money(o.paid), due_amount: money(o.due), due: money(o.due), receipt_no: o.receiptNo, company: t.company,
  });
}

export async function sendPaymentReceiptSms(o: Parameters<typeof buildPaymentReceiptSms>[0] & { mobile: string }) {
  const message = await buildPaymentReceiptSms(o);
  return sendSms({ data: { mobile: o.mobile, message, kind: "payment", module_key: o.moduleKey, ref_id: o.refId, passenger_name: o.customerName } });
}

export async function buildAgencyDueSms(agencyName: string, due: number) {
  const t = await loadTpl(AGENCY_MODULE_KEY, AGENCY_DUE_STATUS);
  return fillTemplate(t.body || DEFAULT_AGENCY_DUE_TEMPLATE, { agency_name: agencyName, due_amount: money(due), due: money(due), company: t.company });
}

/** Latest-status message for a booking row: uses the saved status template, else a generic one. */
export async function buildLatestStatusSms(o: { row: Record<string, unknown>; moduleKey: string; serviceName: string; refId: string; due: number; bill?: number; paid?: number }) {
  const status = String(o.row.status ?? "").trim() || "PROCESSING";
  // Profile SMS always carries status + bill summary; editable via the "LATEST_STATUS" template.
  const t = await loadTpl(o.moduleKey, "LATEST_STATUS");
  return fillTemplate(t.body || DEFAULT_LATEST_STATUS_TEMPLATE, {
    customer_name: String(o.row.passenger_name ?? ""), passport_no: String(o.row.passport ?? ""),
    service_name: o.serviceName, status, ref_id: o.refId,
    price: money(o.row.sold_price), fare: money(o.row.sold_price), due_amount: money(o.due), due: money(o.due),
    bill_amount: money(o.bill ?? o.row.sold_price), bill: money(o.bill ?? o.row.sold_price),
    paid_amount: money(o.paid ?? 0), paid: money(o.paid ?? 0), company: t.company,
  });
}
