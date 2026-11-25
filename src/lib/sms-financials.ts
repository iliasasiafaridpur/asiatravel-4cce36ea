/** SMS-only presentation calculations; never writes to accounting tables. */
export const SMS_BOOKINGS = {
  tickets: { table: "tickets", received: "received" },
  bmet: { table: "bmet_cards", received: "received_amount" },
  "saudi-visa": { table: "saudi_visas", received: "received_amount" },
  "kuwait-visa": { table: "kuwait_visas", received: "received" },
  other: { table: "others", received: "received_amount" },
} as const;

export function smsNumber(value: unknown): number {
  if (value == null || value === "") return 0;
  const n = Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(n)) throw new Error("SMS amount is invalid");
  return Math.max(0, n);
}

export const smsMoney = (value: unknown) => smsNumber(value).toLocaleString("en-US");

export function bookingSmsFinancials(moduleKey: string, row: Record<string, unknown>, extras: Record<string, unknown>[] = []) {
  const cfg = SMS_BOOKINGS[moduleKey as keyof typeof SMS_BOOKINGS];
  if (!cfg) throw new Error("SMS module is not supported");
  // Ticket fare/cost_price is vendor cost, never the customer's bill.
  if (row["sold_price"] == null || row["sold_price"] === "") throw new Error("SMS bill is missing");
  const accounts = [
    { bill: smsNumber(row["sold_price"]), paid: smsNumber(row[cfg.received]), discount: smsNumber(row["discount_amount"]) },
    ...extras.map((extra) => ({ bill: smsNumber(extra["service_price"]), paid: smsNumber(extra["received_amount"]), discount: smsNumber(extra["discount_amount"]) })),
  ];
  return accounts.reduce<{ bill: number; paid: number; discount: number; due: number }>((sum, account) => ({
    bill: sum.bill + account.bill,
    paid: sum.paid + account.paid,
    discount: sum.discount + account.discount,
    due: sum.due + Math.max(0, account.bill - account.paid - account.discount),
  }), { bill: 0, paid: 0, discount: 0, due: 0 });
}

export function smsFinancialTags(o: { bill?: number; paid?: number; due: number; discount?: number; payment?: number }) {
  const bill = o.bill == null ? undefined : smsMoney(o.bill);
  const paid = o.paid == null ? undefined : smsMoney(o.paid);
  const payment = o.payment == null ? paid : smsMoney(o.payment);
  return {
    total: bill, bill_amount: bill, bill, total_bill: bill, price: bill, fare: bill,
    paid_amount: payment, paid: payment, received_amount: paid, received: paid, total_paid_amount: paid,
    payment_amount: payment, due_amount: smsMoney(o.due), due: smsMoney(o.due),
    discount_amount: smsMoney(o.discount), discount: smsMoney(o.discount),
  };
}