// Central module schema. Each module = one table + list of fields.

export type FieldType = "text" | "number" | "date" | "select" | "textarea" | "boolean";
export type FormatKind = "name" | "passport" | "mobile";
export type LookupKind = "country" | "airline" | "sub_agency" | "vendor";
export type Section = "passenger" | "agency" | "vendor";

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
  showInList?: boolean;
  format?: FormatKind;     // input formatting
  lookup?: LookupKind;     // dynamic dropdown (overrides type)
  section?: Section;       // grouping in form
  defaultEmpty?: boolean;  // for selects: start empty instead of first option
}

export interface ModuleSchema {
  key: string;
  label: string;
  short: string;
  table: string;
  idColumn: string;
  idPrefix: string;
  monthlyId?: boolean;
  statuses?: string[];
  fields: Field[];
  computed?: { name: string; label: string; compute: (row: Record<string, unknown>) => number }[];
  deriveStatus?: (row: Record<string, unknown>) => string | undefined;
}

const STATUS_DELIVERY = ["Pending", "Processing", "Ready", "Delivered", "Cancelled"];
const STATUS_VISA = ["Pending", "Applied", "Medical", "Finger", "MOFA", "Visa Issued", "Delivered", "Cancelled"];
const STATUS_BMET = ["File Process", "Card Ready", "Ready for Delivery", "Delivered"];

const DUE = (sold: string, recv: string) => (r: Record<string, unknown>) =>
  Number(r[sold] ?? 0) - Number(r[recv] ?? 0);

const PROFIT = (sold: string, cost: string) => (r: Record<string, unknown>) =>
  Number(r[sold] ?? 0) - Number(r[cost] ?? 0);

export const MODULES: ModuleSchema[] = [
  {
    key: "tickets",
    label: "AIR TICKET",
    short: "Air Ticket",
    table: "tickets",
    idColumn: "ticket_id",
    idPrefix: "TKT",
    monthlyId: true,
    fields: [
      // 1) Passenger Details & price
      { name: "entry_date", label: "Date", type: "date", showInList: true, section: "passenger" },
      { name: "passenger_name", label: "Passenger Name", type: "text", required: true, showInList: true, format: "name", section: "passenger" },
      { name: "passport", label: "Passport", type: "text", showInList: true, format: "passport", section: "passenger" },
      { name: "mobile", label: "Mobile", type: "text", format: "mobile", section: "passenger" },
      { name: "airline", label: "Airline", type: "text", showInList: true, lookup: "airline", section: "passenger" },
      { name: "flight_date", label: "Flight Date", type: "date", showInList: true, section: "passenger" },
      { name: "sold_price", label: "Price", type: "number", showInList: true, section: "passenger" },
      // 2) Sub Agency / Reference & price
      { name: "agency_sold", label: "Sub Agency / Reference", type: "text", lookup: "sub_agency", section: "agency" },
      { name: "received", label: "Received Amount", type: "number", showInList: true, section: "agency" },
      // 3) Vendor information
      { name: "vendor_bought", label: "Vendor", type: "text", lookup: "vendor", section: "vendor" },
      { name: "cost_price", label: "Cost Price", type: "number", section: "vendor" },
      { name: "pnr", label: "PNR", type: "text", section: "vendor" },
      { name: "entry_by", label: "Entry By", type: "text", section: "vendor" },
      { name: "notes", label: "Notes", type: "textarea", section: "vendor" },
    ],
    computed: [
      { name: "profit", label: "Profit", compute: PROFIT("sold_price", "cost_price") },
      { name: "due", label: "Due", compute: DUE("sold_price", "received") },
    ],
  },
  {
    key: "bmet",
    label: "BMET কার্ড",
    short: "BMET Card",
    table: "bmet_cards",
    idColumn: "bmet_id",
    idPrefix: "BMET",
    monthlyId: true,
    statuses: STATUS_BMET,
    fields: [
      // 1) Passenger Details & price
      { name: "entry_date", label: "Date", type: "date", showInList: true, section: "passenger" },
      { name: "passenger_name", label: "Passenger Name", type: "text", required: true, showInList: true, format: "name", section: "passenger" },
      { name: "passport", label: "Passport", type: "text", showInList: true, format: "passport", section: "passenger" },
      { name: "mobile", label: "Mobile", type: "text", format: "mobile", section: "passenger" },
      { name: "country_name", label: "Country", type: "text", showInList: true, lookup: "country", section: "passenger" },
      { name: "attested_date", label: "Attested Date", type: "date", section: "passenger" },
      { name: "sold_price", label: "PRICE", type: "number", showInList: true, section: "passenger" },
      { name: "status", label: "Status", type: "select", options: STATUS_BMET, showInList: true, section: "passenger", defaultEmpty: true },
      { name: "delivery_date", label: "Delivery Date", type: "date", section: "passenger" },
      // 2) Sub Agency / Reference & price
      { name: "agency_sold", label: "Sub Agency / Reference", type: "text", lookup: "sub_agency", section: "agency" },
      { name: "received_amount", label: "Received Amount", type: "number", showInList: true, section: "agency" },
      // 3) Vendor information
      { name: "vendor_bought", label: "Vendor", type: "text", lookup: "vendor", section: "vendor" },
      { name: "cost_price", label: "Cost Price", type: "number", section: "vendor" },
      { name: "vendor_sent_date", label: "Vendor Sent Date", type: "date", section: "vendor" },
      { name: "received_date", label: "Received Date From Vendor", type: "date", section: "vendor" },
      { name: "entry_by", label: "Entry By", type: "text", section: "vendor" },
      { name: "notes", label: "Notes", type: "textarea", section: "vendor" },
    ],
    computed: [{ name: "due", label: "Due", compute: DUE("sold_price", "received_amount") }],
    deriveStatus: (r) => {
      // Auto-update status based on date fields. Manual selection wins only when no later date is set.
      if (r.delivery_date) return "Delivered";
      if (r.received_date) return "Ready for Delivery";
      // If user manually picked "Card Ready", keep it (it falls between vendor_sent and received_date)
      const cur = String(r.status ?? "");
      if (cur === "Card Ready" && r.vendor_sent_date) return "Card Ready";
      if (r.vendor_sent_date) return "File Process";
      return cur || undefined;
    },
  },
  {
    key: "saudi-visa",
    label: "সৌদি ভিসা",
    short: "Saudi Visa",
    table: "saudi_visas",
    idColumn: "saudi_id",
    idPrefix: "SAV",
    monthlyId: true,
    statuses: STATUS_VISA,
    fields: [
      // 1) Passenger
      { name: "entry_date", label: "Date", type: "date", showInList: true, section: "passenger" },
      { name: "passenger_name", label: "Passenger Name", type: "text", required: true, showInList: true, format: "name", section: "passenger" },
      { name: "passport", label: "Passport", type: "text", showInList: true, format: "passport", section: "passenger" },
      { name: "mobile", label: "Mobile", type: "text", format: "mobile", section: "passenger" },
      { name: "visa_type", label: "Visa Type", type: "text", showInList: true, section: "passenger" },
      { name: "sponsor_name", label: "Sponsor", type: "text", section: "passenger" },
      { name: "visa_no", label: "Visa No", type: "text", section: "passenger" },
      { name: "id_no", label: "ID No", type: "text", section: "passenger" },
      { name: "mofa_no", label: "MOFA No", type: "text", section: "passenger" },
      { name: "medical_status", label: "Medical Status", type: "text", section: "passenger" },
      { name: "rl_no", label: "RL No", type: "text", section: "passenger" },
      { name: "bmet_training", label: "BMET Training", type: "boolean", section: "passenger" },
      { name: "bmet_finger", label: "BMET Finger", type: "boolean", section: "passenger" },
      { name: "bmet_status", label: "BMET Status", type: "text", section: "passenger" },
      { name: "sold_price", label: "Sold Price", type: "number", showInList: true, section: "passenger" },
      { name: "status", label: "Status", type: "select", options: STATUS_VISA, showInList: true, section: "passenger" },
      { name: "delivery_date", label: "Delivery Date", type: "date", section: "passenger" },
      // 2) Sub Agency
      { name: "agency_sold", label: "Sub Agency / Reference", type: "text", lookup: "sub_agency", section: "agency" },
      { name: "received_amount", label: "Received", type: "number", showInList: true, section: "agency" },
      // 3) Vendor
      { name: "vendor_bought", label: "Vendor", type: "text", lookup: "vendor", section: "vendor" },
      { name: "cost_price", label: "Cost Price", type: "number", section: "vendor" },
      { name: "vendor_sent_date", label: "Vendor Sent Date", type: "date", section: "vendor" },
      { name: "tasheer_finger_date", label: "Tasheer Finger Date", type: "date", section: "vendor" },
      { name: "final_visa_no", label: "Final Visa No", type: "text", section: "vendor" },
      { name: "entry_by", label: "Entry By", type: "text", section: "vendor" },
      { name: "notes", label: "Notes", type: "textarea", section: "vendor" },
    ],
    computed: [{ name: "due", label: "Due", compute: DUE("sold_price", "received_amount") }],
  },
  {
    key: "kuwait-visa",
    label: "কুয়েত ভিসা",
    short: "Kuwait Visa",
    table: "kuwait_visas",
    idColumn: "kuwait_id",
    idPrefix: "KUV",
    monthlyId: true,
    statuses: STATUS_VISA,
    fields: [
      { name: "entry_date", label: "Date", type: "date", showInList: true, section: "passenger" },
      { name: "passenger_name", label: "Passenger Name", type: "text", required: true, showInList: true, format: "name", section: "passenger" },
      { name: "passport", label: "Passport", type: "text", showInList: true, format: "passport", section: "passenger" },
      { name: "mobile", label: "Mobile", type: "text", format: "mobile", section: "passenger" },
      { name: "visa_no", label: "Visa No", type: "text", showInList: true, section: "passenger" },
      { name: "sponsor_name", label: "Sponsor", type: "text", section: "passenger" },
      { name: "medical_status", label: "Medical Status", type: "text", section: "passenger" },
      { name: "sold_price", label: "Sold Price", type: "number", showInList: true, section: "passenger" },
      { name: "status", label: "Status", type: "select", options: STATUS_VISA, showInList: true, section: "passenger" },
      { name: "delivery_date", label: "Delivery Date", type: "date", section: "passenger" },
      { name: "agency_sold", label: "Sub Agency / Reference", type: "text", lookup: "sub_agency", section: "agency" },
      { name: "received", label: "Received", type: "number", showInList: true, section: "agency" },
      { name: "vendor_bought", label: "Vendor", type: "text", lookup: "vendor", section: "vendor" },
      { name: "cost_price", label: "Cost Price", type: "number", section: "vendor" },
      { name: "entry_by", label: "Entry By", type: "text", section: "vendor" },
      { name: "notes", label: "Notes", type: "textarea", section: "vendor" },
    ],
    computed: [{ name: "due", label: "Due", compute: DUE("sold_price", "received") }],
  },
  {
    key: "agency-ledger",
    label: "Agency খাতা",
    short: "Agency Ledger",
    table: "agency_ledger",
    idColumn: "ledger_id",
    idPrefix: "AGL",
    monthlyId: true,
    fields: [
      { name: "entry_date", label: "Date", type: "date", showInList: true },
      { name: "agent_name", label: "Agent Name", type: "text", required: true, showInList: true },
      { name: "passenger_name", label: "Passenger", type: "text", showInList: true, format: "name" },
      { name: "service_type", label: "Service Type", type: "text", showInList: true },
      { name: "total_bill", label: "Total Bill", type: "number", showInList: true },
      { name: "received_amount", label: "Received", type: "number", showInList: true },
      { name: "remarks", label: "Remarks", type: "textarea" },
    ],
    computed: [{ name: "balance", label: "Balance Due", compute: DUE("total_bill", "received_amount") }],
  },
  {
    key: "vendor-ledger",
    label: "Vendor খাতা",
    short: "Vendor Ledger",
    table: "vendor_ledger",
    idColumn: "ledger_id",
    idPrefix: "VDL",
    monthlyId: true,
    fields: [
      { name: "entry_date", label: "Date", type: "date", showInList: true },
      { name: "vendor_name", label: "Vendor Name", type: "text", required: true, showInList: true },
      { name: "passenger_name", label: "Passenger", type: "text", showInList: true, format: "name" },
      { name: "service_type", label: "Service Type", type: "text", showInList: true },
      { name: "total_payable", label: "Total Payable", type: "number", showInList: true },
      { name: "paid_amount", label: "Paid", type: "number", showInList: true },
      { name: "remarks", label: "Remarks", type: "textarea" },
    ],
    computed: [{ name: "balance", label: "Balance Due", compute: DUE("total_payable", "paid_amount") }],
  },
  {
    key: "agents",
    label: "Agent List",
    short: "Agents",
    table: "agents",
    idColumn: "agent_code",
    idPrefix: "AGT",
    monthlyId: false,
    fields: [
      { name: "name", label: "Name", type: "text", required: true, showInList: true, format: "name" },
      { name: "phone", label: "Phone", type: "text", showInList: true, format: "mobile" },
      { name: "address", label: "Address", type: "text", showInList: true },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
  {
    key: "vendors",
    label: "Vendor List",
    short: "Vendors",
    table: "vendors",
    idColumn: "vendor_code",
    idPrefix: "VND",
    monthlyId: false,
    fields: [
      { name: "name", label: "Name", type: "text", required: true, showInList: true, format: "name" },
      { name: "phone", label: "Phone", type: "text", showInList: true, format: "mobile" },
      { name: "address", label: "Address", type: "text", showInList: true },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
];

export const moduleByKey = (key: string) => MODULES.find((m) => m.key === key);

export const SERVICE_CATEGORIES = [
  { key: "tickets", label: "Ticket" },
  { key: "bmet", label: "BMET Card" },
  { key: "saudi-visa", label: "Saudi Visa" },
  { key: "kuwait-visa", label: "Kuwait Visa" },
  
];

export function formatDate(d?: string | null): string {
  if (!d) return "";
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d);
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${String(date.getDate()).padStart(2, "0")}-${months[date.getMonth()]}-${date.getFullYear()}`;
}

export function statusBadgeClass(status?: string | null): string {
  switch (status) {
    case "Done":
    case "Delivered":
    case "Visa Issued":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
    case "Processing":
    case "Applied":
    case "Medical":
    case "Finger":
    case "MOFA":
    case "Ready":
      return "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30";
    case "Cancelled":
      return "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30";
    default:
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
  }
}
