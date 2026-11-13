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

/** কমা বা স্ট্রিং থাকলেও নিরাপদভাবে আসল সংখ্যা বের করার ফাংশন */
function parseSafeNumber(val: unknown): number {
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const clean = String(val).replace(/[^0-9.-]/g, "");
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}

export function fillTemplate(body: string, vars: Record<string, string | number | null | undefined>): string {
  return body.replace(/\{(\w+)\}/g, (m, k) => {
    const val = vars[k];
    if (val !== undefined && val !== null && val !== "") return String(val);
    return m === "{company}" || m === "{company_name}" ? "" : "";
  });
}

import { supabase } from "@/integrations/supabase/client";
import { sendSms } from "./sms.functions";

const TABLE_MAP: Record<string, string> = {
  tickets: "tickets",
  bmet: "bmet_cards",
  "saudi-visa": "saudi_visas",
  "kuwait-visa": "kuwait_visas",
  other: "others",
};

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

  let rowData = { ...opts.row };

  // ১. মেমোরিতে sold_price না থাকলে বা ০ হলে সরাসরি ডাটাবেসের টেবিল থেকে আসল রেকর্ড রিড
  const initialSold = parseSafeNumber(rowData.sold_price ?? rowData.price ?? rowData.fare);
  if (initialSold <= 0 && (rowData.id || opts.refId)) {
    const tableName = TABLE_MAP[opts.moduleKey];
    if (tableName) {
      try {
        const query = rowData.id
          ? supabase.from(tableName as never).select("*").eq("id", rowData.id).maybeSingle()
          : supabase.from(tableName as never).select("*").limit(1);
        const { data: dbData } = await query;
        if (dbData) {
          rowData = { ...rowData, ...(dbData as Record<string, unknown>) };
        }
      } catch {
        /* fallback to opts.row */
      }
    }
  }

  // ২. নিখুঁত মূল্য ও বকেয়া হিসাব
  const sold = parseSafeNumber(rowData.sold_price ?? rowData.price ?? rowData.fare ?? rowData.total_bill);
  const recv = parseSafeNumber(
    opts.moduleKey === "tickets" || opts.moduleKey === "kuwait-visa"
      ? (rowData.received ?? rowData.received_amount)
      : (rowData.received_amount ?? rowData.received ?? rowData.paid_amount)
  );
  const disc = parseSafeNumber(rowData.discount_amount ?? rowData.discount);
  const autoDue = Math.max(0, sold - recv - disc);
  const effectiveDue = opts.due !== undefined ? parseSafeNumber(opts.due) : autoDue;

  // ৩. টেক্সট ফরম্যাটিং (যেমন: 8,000 বা 50,500)
  const formattedPrice = sold > 0 ? (sold >= 1000 ? sold.toLocaleString("en-US") : String(sold)) : (sold === 0 ? "0" : "");
  const formattedDue = effectiveDue > 0 ? (effectiveDue >= 1000 ? effectiveDue.toLocaleString("en-US") : String(effectiveDue)) : "0";

  const customerName = String(rowData.passenger_name ?? "");
  const passport = String(rowData.passport ?? "");
  const company = s?.company_name ?? "";

  // ৪. সব ধরনের ট্যাগের নিখুঁত ম্যাপিং
  const templateVars: Record<string, string> = {
    customer_name: customerName,
    passenger_name: customerName,
    passport_no: passport,
    passport: passport,
    service_name: opts.serviceName,
    status: opts.status,
    ref_id: opts.refId,
    // মূল্যের সব ট্যাগ
    price: formattedPrice,
    fare: formattedPrice,
    sold_price: formattedPrice,
    bill: formattedPrice,
    // বকেয়ার সব ট্যাগ
    due_amount: formattedDue,
    due: formattedDue,
    balance: formattedDue,
    // কোম্পানি
    company: company,
    company_name: company,
  };

  const message = fillTemplate(tpl?.body || DEFAULT_STATUS_TEMPLATE, templateVars);

  return sendSms({
    data: {
      mobile: String(rowData.mobile ?? opts.row.mobile ?? ""),
      message,
      kind: "status",
      module_key: opts.moduleKey,
      ref_id: opts.refId,
      passenger_name: customerName,
    },
  });
}
