// Central module schema. Each module = one table + list of fields.
// A generic ModulePage component renders list/form using this schema.

export type FieldType = "text" | "number" | "date" | "select" | "textarea" | "boolean";

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
  showInList?: boolean; // include in table view
}

export interface ModuleSchema {
  key: string;            // route key, e.g. "tickets"
  label: string;          // display name (Bengali)
  short: string;          // sidebar short label
  table: string;          // supabase table name
  idColumn: string;       // human ID column (e.g. "ticket_id")
  idPrefix: string;       // for auto-gen, e.g. "TKT" → TKT-2605-001
  monthlyId?: boolean;    // true → uses next_module_id (YYMM in id)
  statuses?: string[];
  fields: Field[];        // editable fields (excluding idColumn, created_at)
  // Computed columns added to list view (e.g. due = sold - received)
  computed?: { name: string; label: string; compute: (row: Record<string, unknown>) => number }[];
}

const STATUS_DEFAULT = ["Pending", "Processing", "Done", "Cancelled"];
const STATUS_DELIVERY = ["Pending", "Processing", "Ready", "Delivered", "Cancelled"];
const STATUS_VISA = ["Pending", "Applied", "Medical", "Finger", "MOFA", "Visa Issued", "Delivered", "Cancelled"];

const DUE = (sold: string, recv: string) => (r: Record<string, unknown>) =>
  Number(r[sold] ?? 0) - Number(r[recv] ?? 0);

const PROFIT = (sold: string, cost: string) => (r: Record<string, unknown>) =>
  Number(r[sold] ?? 0) - Number(r[cost] ?? 0);

export const MODULES: ModuleSchema[] = [
  {
    key: "manpower",
    label: "Manpower",
    short: "Manpower",
    table: "passengers",
    idColumn: "passenger_id",
    idPrefix: "MAN",
    monthlyId: true,
    statuses: STATUS_DEFAULT,
    fields: [
      { name: "passenger_name", label: "Passenger Name", type: "text", required: true, showInList: true },
      { name: "passport", label: "Passport", type: "text", required: true, showInList: true },
      { name: "status", label: "Status", type: "select", options: STATUS_DEFAULT, showInList: true },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
  {
    key: "tickets",
    label: "বিমান টিকিট",
    short: "Tickets",
    table: "tickets",
    idColumn: "ticket_id",
    idPrefix: "TKT",
    monthlyId: true,
    statuses: STATUS_DELIVERY,
    fields: [
      { name: "entry_date", label: "Date", type: "date", showInList: true },
      { name: "passenger_name", label: "Passenger Name", type: "text", required: true, showInList: true },
      { name: "passport", label: "Passport", type: "text", showInList: true },
      { name: "mobile", label: "Mobile", type: "text" },
      { name: "airline", label: "Airline", type: "text", showInList: true },
      { name: "pnr", label: "PNR", type: "text" },
      { name: "flight_date", label: "Flight Date", type: "date", showInList: true },
      { name: "agency_sold", label: "Agency Sold", type: "text" },
      { name: "vendor_bought", label: "Vendor Bought", type: "text" },
      { name: "sold_price", label: "Sold Price", type: "number", showInList: true },
      { name: "cost_price", label: "Cost Price", type: "number" },
      { name: "received", label: "Received", type: "number", showInList: true },
      { name: "status", label: "Status", type: "select", options: STATUS_DELIVERY, showInList: true },
      { name: "entry_by", label: "Entry By", type: "text" },
      { name: "notes", label: "Notes", type: "textarea" },
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
    statuses: STATUS_DELIVERY,
    fields: [
      { name: "entry_date", label: "Date", type: "date", showInList: true },
      { name: "passenger_name", label: "Passenger Name", type: "text", required: true, showInList: true },
      { name: "passport", label: "Passport", type: "text", showInList: true },
      { name: "mobile", label: "Mobile", type: "text" },
      { name: "country_name", label: "Country", type: "text", showInList: true },
      { name: "attested_date", label: "Attested Date", type: "date" },
      { name: "agency_sold", label: "Agency Sold", type: "text" },
      { name: "vendor_sent_date", label: "Vendor Sent Date", type: "date" },
      { name: "received_date", label: "Received Date", type: "date" },
      { name: "vendor_bought", label: "Vendor Bought", type: "text" },
      { name: "sold_price", label: "Sold Price", type: "number", showInList: true },
      { name: "cost_price", label: "Cost Price", type: "number" },
      { name: "received_amount", label: "Received", type: "number", showInList: true },
      { name: "status", label: "Status", type: "select", options: STATUS_DELIVERY, showInList: true },
      { name: "delivery_date", label: "Delivery Date", type: "date" },
      { name: "entry_by", label: "Entry By", type: "text" },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
    computed: [{ name: "due", label: "Due", compute: DUE("sold_price", "received_amount") }],
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
      { name: "entry_date", label: "Date", type: "date", showInList: true },
      { name: "passenger_name", label: "Passenger Name", type: "text", required: true, showInList: true },
      { name: "passport", label: "Passport", type: "text", showInList: true },
      { name: "mobile", label: "Mobile", type: "text" },
      { name: "visa_type", label: "Visa Type", type: "text", showInList: true },
      { name: "sponsor_name", label: "Sponsor", type: "text" },
      { name: "visa_no", label: "Visa No", type: "text" },
      { name: "id_no", label: "ID No", type: "text" },
      { name: "mofa_no", label: "MOFA No", type: "text" },
      { name: "medical_status", label: "Medical Status", type: "text" },
      { name: "rl_no", label: "RL No", type: "text" },
      { name: "vendor_sent_date", label: "Vendor Sent Date", type: "date" },
      { name: "tasheer_finger_date", label: "Tasheer Finger Date", type: "date" },
      { name: "final_visa_no", label: "Final Visa No", type: "text" },
      { name: "bmet_training", label: "BMET Training", type: "boolean" },
      { name: "bmet_finger", label: "BMET Finger", type: "boolean" },
      { name: "bmet_status", label: "BMET Status", type: "text" },
      { name: "agency_sold", label: "Agency Sold", type: "text" },
      { name: "vendor_bought", label: "Vendor Bought", type: "text" },
      { name: "sold_price", label: "Sold Price", type: "number", showInList: true },
      { name: "cost_price", label: "Cost Price", type: "number" },
      { name: "received_amount", label: "Received", type: "number", showInList: true },
      { name: "status", label: "Status", type: "select", options: STATUS_VISA, showInList: true },
      { name: "delivery_date", label: "Delivery Date", type: "date" },
      { name: "entry_by", label: "Entry By", type: "text" },
      { name: "notes", label: "Notes", type: "textarea" },
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
      { name: "entry_date", label: "Date", type: "date", showInList: true },
      { name: "passenger_name", label: "Passenger Name", type: "text", required: true, showInList: true },
      { name: "passport", label: "Passport", type: "text", showInList: true },
      { name: "mobile", label: "Mobile", type: "text" },
      { name: "visa_no", label: "Visa No", type: "text", showInList: true },
      { name: "sponsor_name", label: "Sponsor", type: "text" },
      { name: "medical_status", label: "Medical Status", type: "text" },
      { name: "agency_sold", label: "Agency Sold", type: "text" },
      { name: "vendor_bought", label: "Vendor Bought", type: "text" },
      { name: "sold_price", label: "Sold Price", type: "number", showInList: true },
      { name: "cost_price", label: "Cost Price", type: "number" },
      { name: "received", label: "Received", type: "number", showInList: true },
      { name: "status", label: "Status", type: "select", options: STATUS_VISA, showInList: true },
      { name: "delivery_date", label: "Delivery Date", type: "date" },
      { name: "entry_by", label: "Entry By", type: "text" },
      { name: "notes", label: "Notes", type: "textarea" },
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
      { name: "passenger_name", label: "Passenger", type: "text", showInList: true },
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
      { name: "passenger_name", label: "Passenger", type: "text", showInList: true },
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
      { name: "name", label: "Name", type: "text", required: true, showInList: true },
      { name: "phone", label: "Phone", type: "text", showInList: true },
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
      { name: "name", label: "Name", type: "text", required: true, showInList: true },
      { name: "phone", label: "Phone", type: "text", showInList: true },
      { name: "address", label: "Address", type: "text", showInList: true },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
];

export const moduleByKey = (key: string) => MODULES.find((m) => m.key === key);

// Service categories selectable from the universal Action Board form.
// Keys must match MODULES keys.
export const SERVICE_CATEGORIES = [
  { key: "tickets", label: "Ticket" },
  { key: "bmet", label: "BMET Card" },
  { key: "saudi-visa", label: "Saudi Visa" },
  { key: "kuwait-visa", label: "Kuwait Visa" },
  { key: "manpower", label: "Manpower" },
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
