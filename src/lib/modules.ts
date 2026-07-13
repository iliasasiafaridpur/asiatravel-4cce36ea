// Central module schema. Each module = one table + list of fields.

export type FieldType = "text" | "number" | "date" | "select" | "textarea" | "boolean";
export type FormatKind = "name" | "passport" | "mobile";
export type LookupKind = string;
export type Section = "passenger" | "agency" | "vendor";

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
  showInList?: boolean;
  format?: FormatKind; // input formatting
  lookup?: LookupKind; // dynamic dropdown (overrides type)
  lookupDefaults?: string[]; // built-in seed values for the lookup
  section?: Section; // grouping in form
  defaultEmpty?: boolean; // for selects: start empty instead of first option
  filterable?: boolean; // show as filter dropdown above table
  hideInForm?: boolean; // hide from entry/edit form (still shown in list)
  /** Only show this field in the form when another field equals one of these values. */
  showWhen?: { field: string; equals: string[] };
  /** For date fields: disallow selecting/entering a future date (max = today). */
  noFuture?: boolean;
}

export const LEDGER_SERVICE_TYPES = [
  "AIR TICKET",
  "BMET CARD",
  "SAUDI VISA",
  "KUWAIT VISA",
  "OTHERS",
];

const RECEIPT_METHODS = ["Cash", "bKash", "Nagad", "Rocket", "Bank Transfer", "Cheque", "Md cash"];
const PAYMENT_METHODS = ["Cash", "bKash", "Nagad", "Rocket", "Bank Transfer", "Cheque", "Card", "Md cash"];

export interface ModuleSchema {
  key: string;
  label: string;
  short: string;
  table: string;
  idColumn: string;
  idPrefix: string;
  monthlyId?: boolean;
  /** Generate yearly serial IDs like SAV-26-001 instead of monthly. */
  yearlyId?: boolean;
  /** Show list one calendar month at a time (latest first) with prev/next paging. */
  paginateByMonth?: boolean;
  statuses?: string[];
  fields: Field[];
  /** Optional explicit ordering for list columns. Mix field names and computed names. */
  listOrder?: string[];
  computed?: { name: string; label: string; compute: (row: Record<string, unknown>) => number }[];
  deriveStatus?: (row: Record<string, unknown>) => string | undefined;
  /** Sum these field/computed names across filtered rows for a totals card. */
  summaryFields?: { name: string; label: string }[];
  /** Group filtered rows by this field for "per agent / per vendor" outstanding view. */
  groupBy?: { field: string; label: string; metrics: { name: string; label: string }[] };
}

const STATUS_DELIVERY = ["Pending", "Processing", "Ready", "Delivered", "Cancelled"];
// Other Service uses a simplified 4-stage flow (first entry = NEW).
const STATUS_OTHER = ["NEW", "Process", "Pending Delivery", "Delivery"];
const STATUS_TICKET = ["BOOK", "ISSUE", "DELIVERED"];
// Visa modules now share BMET's exact hierarchy per product requirement.
const STATUS_VISA = ["NEW", "File Process", "Card Ready", "Pending Delivery", "Delivered"];
const STATUS_BMET = ["NEW", "File Process", "Card Ready", "Pending Delivery", "Delivery But Due", "Delivered"];

const DUE = (sold: string, recv: string, discount?: string) => (r: Record<string, unknown>) =>
  Math.max(0, Number(r[sold] ?? 0) - Number(r[recv] ?? 0) - Number(discount ? r[discount] ?? 0 : 0));

const PROFIT = (sold: string, cost: string, discount?: string) => (r: Record<string, unknown>) =>
  Number(r[sold] ?? 0) - Number(discount ? r[discount] ?? 0 : 0) - Number(r[cost] ?? 0);

export const MODULES: ModuleSchema[] = [
  {
    key: "tickets",
    label: "AIR TICKET",
    short: "Air Ticket",
    table: "tickets",
    idColumn: "ticket_id",
    idPrefix: "TKT",
    monthlyId: true,
    paginateByMonth: true,
    statuses: STATUS_TICKET,
    fields: [
      // 1) Passenger Details & price
      { name: "entry_date", label: "Date", type: "date", showInList: true, section: "passenger" },
      {
        name: "passenger_name",
        label: "Passenger Name",
        type: "text",
        required: true,
        showInList: true,
        format: "name",
        section: "passenger",
      },
      {
        name: "passport",
        label: "Passport",
        type: "text",
        showInList: true,
        format: "passport",
        section: "passenger",
      },
      {
        name: "mobile",
        label: "Mobile",
        type: "text",
        showInList: true,
        format: "mobile",
        section: "passenger",
      },
      {
        name: "airline",
        label: "Airline",
        type: "text",
        showInList: true,
        lookup: "airline",
        section: "passenger",
      },
      {
        name: "trip_road",
        label: "TRIP ROAD",
        type: "text",
        showInList: true,
        lookup: "route",
        section: "passenger",
        required: true,
      },
      {
        name: "flight_date",
        label: "Flight Date",
        type: "date",
        showInList: true,
        section: "passenger",
        required: true,
      },
      {
        name: "status",
        label: "Status",
        type: "text",
        showInList: true,
        section: "passenger",
        lookup: "status_delivery",
        lookupDefaults: STATUS_DELIVERY,
        hideInForm: true,
      },
      {
        name: "sold_price",
        label: "Price",
        type: "number",
        required: true,
        showInList: true,
        section: "passenger",
      },
      // 2) Sub Agency / Reference & price
      {
        name: "agency_sold",
        label: "Sub Agency / Reference",
        type: "text",
        showInList: true,
        lookup: "sub_agency",
        section: "agency",
        filterable: true,
      },
      {
        name: "received",
        label: "Received Amount",
        type: "number",
        showInList: true,
        section: "agency",
      },
      {
        name: "discount_amount",
        label: "Discount",
        type: "number",
        showInList: true,
        section: "agency",
      },
      {
        name: "payment_date",
        label: "Payment Date",
        type: "date",
        section: "agency",
      },
      // 3) Vendor information
      {
        name: "vendor_bought",
        label: "Vendor",
        type: "text",
        required: true,
        showInList: true,
        lookup: "vendor",
        section: "vendor",
        filterable: true,
      },
      {
        name: "cost_price",
        label: "Cost Price",
        type: "number",
        showInList: true,
        section: "vendor",
      },
      { name: "pnr", label: "PNR", type: "text", section: "vendor" },
      { name: "entry_by", label: "Entry By", type: "text", showInList: true, section: "vendor" },
      { name: "notes", label: "Notes", type: "textarea", showInList: true, section: "vendor" },
    ],
    listOrder: [
      "entry_date",
      "passenger_name",
      "passport",
      "mobile",
      "airline",
      "trip_road",
      "flight_date",
      "agency_sold",
      "vendor_bought",
      "status",
      "sold_price",
      "cost_price",
      "received",
      "discount_amount",
      "due",
      "profit",
      "notes",
      "entry_by",
    ],
    computed: [
      { name: "due", label: "Due", compute: DUE("sold_price", "received", "discount_amount") },
      { name: "profit", label: "Profit", compute: PROFIT("sold_price", "cost_price", "discount_amount") },
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
    paginateByMonth: true,
    statuses: STATUS_BMET,
    fields: [
      // 1) Passenger Details & price
      { name: "entry_date", label: "Date", type: "date", showInList: true, section: "passenger" },
      {
        name: "passenger_name",
        label: "Passenger Name",
        type: "text",
        required: true,
        showInList: true,
        format: "name",
        section: "passenger",
      },
      {
        name: "passport",
        label: "Passport",
        type: "text",
        showInList: true,
        format: "passport",
        section: "passenger",
      },
      {
        name: "mobile",
        label: "Mobile",
        type: "text",
        showInList: true,
        format: "mobile",
        section: "passenger",
      },
      {
        name: "country_name",
        label: "Country",
        type: "text",
        showInList: true,
        filterable: true,
        lookup: "country",
        section: "passenger",
        required: true,
      },
      {
        name: "attested_date",
        label: "Attested Date",
        type: "date",
        showInList: true,
        section: "passenger",
      },
      {
        name: "sold_price",
        label: "PRICE",
        type: "number",
        showInList: true,
        section: "passenger",
        required: true,
      },
      {
        name: "status",
        label: "Status",
        type: "text",
        showInList: true,
        section: "passenger",
        lookup: "status_bmet",
        lookupDefaults: STATUS_BMET,
        defaultEmpty: true,
      },
      {
        name: "delivery_date",
        label: "Delivery Date",
        type: "date",
        showInList: true,
        section: "passenger",
      },
      // 2) Sub Agency / Reference & price
      {
        name: "agency_sold",
        label: "Agency",
        type: "text",
        showInList: true,
        filterable: true,
        lookup: "sub_agency",
        section: "agency",
      },
      {
        name: "without_passport",
        label: "Without Passport (পাসপোর্ট ছাড়া — পেমেন্ট হলেই ডেলিভারি)",
        type: "boolean",
        section: "agency",
      },
      {
        name: "received_amount",
        label: "Received Amount",
        type: "number",
        showInList: true,
        section: "agency",
      },
      {
        name: "discount_amount",
        label: "Discount",
        type: "number",
        showInList: true,
        section: "agency",
      },
      {
        name: "payment_date",
        label: "Payment Date",
        type: "date",
        section: "agency",
      },
      // 3) Vendor information
      {
        name: "vendor_bought",
        label: "Vendor",
        type: "text",
        showInList: true,
        filterable: true,
        lookup: "vendor",
        section: "vendor",
      },
      {
        name: "cost_price",
        label: "Cost Price",
        type: "number",
        showInList: true,
        section: "vendor",
      },
      {
        name: "vendor_sent_date",
        label: "Vendor Sent Date",
        type: "date",
        showInList: true,
        section: "vendor",
      },
      {
        name: "received_date",
        label: "Received Date From Vendor",
        type: "date",
        showInList: true,
        section: "vendor",
        noFuture: true,
      },
      { name: "entry_by", label: "Entry By", type: "text", showInList: true, section: "vendor" },
      { name: "notes", label: "Notes", type: "textarea", showInList: true, section: "vendor" },
    ],
    listOrder: [
      "entry_date",
      "passenger_name",
      "passport",
      "mobile",
      "country_name",
      "attested_date",
      "agency_sold",
      "vendor_bought",
      "vendor_sent_date",
      "received_date",
      "status",
      "delivery_date",
      "sold_price",
      "cost_price",
      "received_amount",
      "discount_amount",
      "due",
      "profit",
      "notes",
      "entry_by",
    ],
    computed: [
      { name: "due", label: "Due", compute: DUE("sold_price", "received_amount", "discount_amount") },
      { name: "profit", label: "Profit", compute: PROFIT("sold_price", "cost_price", "discount_amount") },
    ],
    deriveStatus: (r) => {
      // Auto-update status based on date fields. Manual selection wins only when no later date is set.
      if (r.delivery_date) {
        // Delivered with leftover due is a distinct "Delivery But Due" stage.
        const due = Number(r.sold_price ?? 0) - Number(r.received_amount ?? 0) - Number(r.discount_amount ?? 0);
        return due > 0 ? "Delivery But Due" : "Delivered";
      }
      const cur = String(r.status ?? "");
      if (r.received_date) return "Pending Delivery";
      if (cur === "Card Ready" && r.vendor_sent_date) return "Card Ready";
      if (r.vendor_sent_date) return "File Process";
      return cur || "NEW";
    },
  },
  {
    key: "saudi-visa",
    label: "সৌদি ভিসা",
    short: "Saudi Visa",
    table: "saudi_visas",
    idColumn: "saudi_id",
    idPrefix: "SAV",
    yearlyId: true,
    statuses: STATUS_VISA,
    fields: [
      // 1) Passenger
      { name: "entry_date", label: "Date", type: "date", showInList: true, section: "passenger" },
      {
        name: "passenger_name",
        label: "Passenger Name",
        type: "text",
        required: true,
        showInList: true,
        format: "name",
        section: "passenger",
      },
      {
        name: "passport",
        label: "Passport",
        type: "text",
        showInList: true,
        format: "passport",
        section: "passenger",
      },
      { name: "mobile", label: "Mobile", type: "text", format: "mobile", section: "passenger" },
      {
        name: "visa_type",
        label: "Visa Type",
        type: "text",
        showInList: true,
        section: "passenger",
        lookup: "visa_type",
        lookupDefaults: ["Work", "Hajj", "Umrah", "Visit", "Family"],
        required: true,
      },
      { name: "sponsor_name", label: "Sponsor", type: "text", section: "passenger" },
      { name: "visa_no", label: "Visa No", type: "text", section: "passenger" },
      { name: "id_no", label: "ID No", type: "text", section: "passenger" },
      { name: "mofa_no", label: "MOFA No", type: "text", section: "passenger" },
      {
        name: "medical_status",
        label: "Medical Status",
        type: "text",
        section: "passenger",
        lookup: "medical_status",
        lookupDefaults: ["Pending", "Fit", "Unfit", "Re-check"],
      },
      {
        name: "rl_no",
        label: "RL No",
        type: "text",
        section: "passenger",
        lookup: "rl_no",
        lookupDefaults: [],
        required: true,
      },
      { name: "bmet_training", label: "BMET Training", type: "boolean", section: "passenger" },
      { name: "bmet_finger", label: "BMET Finger", type: "boolean", section: "passenger" },
      {
        name: "bmet_status",
        label: "BMET Status",
        type: "text",
        section: "passenger",
        lookup: "bmet_status",
        lookupDefaults: STATUS_BMET,
      },
      {
        name: "sold_price",
        label: "Sold Price",
        type: "number",
        required: true,
        showInList: true,
        section: "passenger",
      },
      {
        name: "status",
        label: "Status",
        type: "text",
        showInList: true,
        section: "passenger",
        lookup: "status_visa",
        lookupDefaults: STATUS_VISA,
      },
      { name: "delivery_date", label: "Delivery Date", type: "date", section: "passenger" },
      // 2) Sub Agency
      {
        name: "agency_sold",
        label: "Sub Agency / Reference",
        type: "text",
        showInList: true,
        filterable: true,
        lookup: "sub_agency",
        section: "agency",
      },

      {
        name: "received_amount",
        label: "Received Amount",
        type: "number",
        showInList: true,
        section: "agency",
      },
      {
        name: "discount_amount",
        label: "Discount",
        type: "number",
        showInList: true,
        section: "agency",
      },
      {
        name: "payment_date",
        label: "Payment Date",
        type: "date",
        section: "agency",
      },
      // 3) Vendor
      { name: "vendor_bought", label: "Vendor", type: "text", showInList: true, filterable: true, lookup: "vendor", section: "vendor" },

      { name: "cost_price", label: "Cost Price", type: "number", section: "vendor" },
      { name: "vendor_sent_date", label: "Vendor Sent Date", type: "date", section: "vendor" },
      { name: "received_date", label: "Received Date From Vendor", type: "date", section: "vendor", noFuture: true },
      {
        name: "tasheer_finger_date",
        label: "Tasheer Finger Date",
        type: "date",
        section: "vendor",
      },
      { name: "final_visa_no", label: "Final Visa No", type: "text", section: "vendor" },
      { name: "entry_by", label: "Entry By", type: "text", section: "vendor" },
      { name: "notes", label: "Notes", type: "textarea", section: "vendor" },
    ],
    computed: [
      { name: "due", label: "Due", compute: DUE("sold_price", "received_amount", "discount_amount") },
      { name: "profit", label: "Profit", compute: PROFIT("sold_price", "cost_price", "discount_amount") },
    ],
    deriveStatus: (r) => {
      // Auto-update status from date fields, mirroring BMET/Kuwait's flow.
      // Manual selection (e.g. Card Ready) wins only when no later date is set.
      if (r.delivery_date) return "Delivered";
      const cur = String(r.status ?? "");
      if (r.received_date) return "Pending Delivery";
      if (cur === "Card Ready" && r.vendor_sent_date) return "Card Ready";
      if (r.vendor_sent_date) return "File Process";
      return cur || "NEW";
    },
  },
  {
    key: "kuwait-visa",
    label: "কুয়েত ভিসা",
    short: "Kuwait Visa",
    table: "kuwait_visas",
    idColumn: "kuwait_id",
    idPrefix: "KUV",
    yearlyId: true,
    statuses: STATUS_VISA,
    fields: [
      { name: "entry_date", label: "Date", type: "date", showInList: true, section: "passenger" },
      {
        name: "passenger_name",
        label: "Passenger Name",
        type: "text",
        required: true,
        showInList: true,
        format: "name",
        section: "passenger",
      },
      {
        name: "passport",
        label: "Passport",
        type: "text",
        showInList: true,
        format: "passport",
        section: "passenger",
      },
      { name: "mobile", label: "Mobile", type: "text", format: "mobile", section: "passenger" },
      { name: "visa_no", label: "Visa No", type: "text", showInList: true, section: "passenger" },
      { name: "sponsor_name", label: "Sponsor", type: "text", section: "passenger" },
      {
        name: "medical_status",
        label: "Medical Status",
        type: "text",
        section: "passenger",
        lookup: "medical_status",
        lookupDefaults: ["Pending", "Fit", "Unfit", "Re-check"],
      },
      {
        name: "sold_price",
        label: "Sold Price",
        type: "number",
        required: true,
        showInList: true,
        section: "passenger",
      },
      {
        name: "status",
        label: "Status",
        type: "text",
        showInList: true,
        section: "passenger",
        lookup: "status_visa",
        lookupDefaults: STATUS_VISA,
        defaultEmpty: true,
      },
      { name: "delivery_date", label: "Delivery Date", type: "date", showInList: true, section: "passenger" },
      {
        name: "agency_sold",
        label: "Sub Agency / Reference",
        type: "text",
        showInList: true,
        filterable: true,
        lookup: "sub_agency",
        section: "agency",
      },
      {
        name: "received",
        label: "Received Amount",
        type: "number",
        showInList: true,
        section: "agency",
      },
      {
        name: "discount_amount",
        label: "Discount",
        type: "number",
        showInList: true,
        section: "agency",
      },
      {
        name: "payment_date",
        label: "Payment Date",
        type: "date",
        section: "agency",
      },
      { name: "vendor_bought", label: "Vendor", type: "text", showInList: true, filterable: true, lookup: "vendor", section: "vendor" },

      { name: "cost_price", label: "Cost Price", type: "number", showInList: true, section: "vendor" },
      { name: "vendor_sent_date", label: "Vendor Sent Date", type: "date", showInList: true, section: "vendor" },
      { name: "received_date", label: "Received Date From Vendor", type: "date", showInList: true, section: "vendor", noFuture: true },
      { name: "entry_by", label: "Entry By", type: "text", showInList: true, section: "vendor" },
      { name: "notes", label: "Notes", type: "textarea", showInList: true, section: "vendor" },
    ],
    listOrder: [
      "entry_date",
      "passenger_name",
      "passport",
      "mobile",
      "visa_no",
      "agency_sold",
      "vendor_bought",
      "vendor_sent_date",
      "received_date",
      "status",
      "delivery_date",
      "sold_price",
      "cost_price",
      "received",
      "discount_amount",
      "due",
      "profit",
      "notes",
      "entry_by",
    ],
    computed: [
      { name: "due", label: "Due", compute: DUE("sold_price", "received", "discount_amount") },
      { name: "profit", label: "Profit", compute: PROFIT("sold_price", "cost_price", "discount_amount") },
    ],
    deriveStatus: (r) => {
      // Auto-update status from date fields, mirroring BMET's flow. Manual
      // selection (e.g. Card Ready) wins only when no later date is set.
      if (r.delivery_date) return "Delivered";
      const cur = String(r.status ?? "");
      if (r.received_date) return "Pending Delivery";
      if (cur === "Card Ready" && r.vendor_sent_date) return "Card Ready";
      if (r.vendor_sent_date) return "File Process";
      return cur || "NEW";
    },
  },
  {
    key: "other",
    label: "Other Service",
    short: "Other",
    table: "others",
    idColumn: "other_id",
    idPrefix: "OTH",
    monthlyId: true,
    statuses: STATUS_OTHER,
    fields: [
      // 1) Passenger Details & price
      { name: "entry_date", label: "Date", type: "date", showInList: true, section: "passenger" },
      {
        name: "passenger_name",
        label: "Passenger Name",
        type: "text",
        required: true,
        showInList: true,
        format: "name",
        section: "passenger",
      },
      {
        name: "passport",
        label: "Passport",
        type: "text",
        showInList: true,
        format: "passport",
        section: "passenger",
      },
      {
        name: "mobile",
        label: "Mobile",
        type: "text",
        showInList: true,
        format: "mobile",
        section: "passenger",
      },
      {
        name: "service_name",
        label: "Service Name",
        type: "text",
        showInList: true,
        filterable: true,
        lookup: "other_service",
        section: "passenger",
        required: true,
      },
      // Air Ticket details — only shown when Service Name = "Date Change"
      {
        name: "airline",
        label: "Airline",
        type: "text",
        lookup: "airline",
        section: "passenger",
        showWhen: { field: "service_name", equals: ["Date Change"] },
      },
      {
        name: "trip_road",
        label: "Trip Road",
        type: "text",
        lookup: "route",
        section: "passenger",
        showWhen: { field: "service_name", equals: ["Date Change"] },
      },
      {
        name: "flight_date",
        label: "Flight Date",
        type: "date",
        section: "passenger",
        showWhen: { field: "service_name", equals: ["Date Change"] },
      },
      {
        name: "sold_price",
        label: "Service Price",
        type: "number",
        showInList: true,
        section: "passenger",
        required: true,
      },
      {
        name: "status",
        label: "Status",
        type: "text",
        showInList: true,
        section: "passenger",
        lookup: "status_other",
        lookupDefaults: STATUS_OTHER,
      },
      {
        name: "delivery_date",
        label: "Delivery Date",
        type: "date",
        showInList: true,
        section: "passenger",
      },
      // 2) Sub Agency / Reference & price
      {
        name: "agency_sold",
        label: "Agency",
        type: "text",
        showInList: true,
        filterable: true,
        lookup: "sub_agency",
        section: "agency",
      },
      {
        name: "received_amount",
        label: "Received Amount",
        type: "number",
        showInList: true,
        section: "agency",
      },
      {
        name: "discount_amount",
        label: "Discount",
        type: "number",
        showInList: true,
        section: "agency",
      },
      {
        name: "payment_date",
        label: "Payment Date",
        type: "date",
        section: "agency",
      },
      // 3) Vendor information
      {
        name: "vendor_bought",
        label: "Vendor",
        type: "text",
        showInList: true,
        filterable: true,
        lookup: "vendor",
        section: "vendor",
      },
      {
        name: "cost_price",
        label: "Cost Price",
        type: "number",
        showInList: true,
        section: "vendor",
      },
      { name: "entry_by", label: "Entry By", type: "text", showInList: true, section: "vendor" },
      { name: "notes", label: "Notes", type: "textarea", showInList: true, section: "vendor" },
    ],
    computed: [
      { name: "due", label: "Due", compute: DUE("sold_price", "received_amount", "discount_amount") },
      { name: "profit", label: "Profit", compute: PROFIT("sold_price", "cost_price", "discount_amount") },
    ],
  },
  {
    key: "agency-ledger",
    label: "Customers Data",
    short: "Agency Ledger",
    table: "agency_ledger",
    idColumn: "ledger_id",
    idPrefix: "AGL",
    monthlyId: true,
    fields: [
      { name: "entry_date", label: "Date", type: "date", showInList: true },
      {
        name: "agent_name",
        label: "Agent Name",
        type: "text",
        required: true,
        showInList: true,
        lookup: "sub_agency",
        filterable: true,
      },
      {
        name: "passenger_name",
        label: "Passenger",
        type: "text",
        showInList: true,
        format: "name",
      },
      { name: "passport", label: "Passport", type: "text", showInList: true, format: "passport" },
      { name: "mobile", label: "Phone", type: "text", showInList: true, format: "mobile" },
      {
        name: "service_type",
        label: "Service Type",
        type: "text",
        showInList: true,
        lookup: "ledger_service_type",
        lookupDefaults: LEDGER_SERVICE_TYPES,
      },
      {
        name: "country_route",
        label: "Country / Route",
        type: "text",
        showInList: true,
        lookup: "route",
      },
      { name: "total_bill", label: "Total Bill", type: "number", showInList: true },
      { name: "received_amount", label: "Received", type: "number", showInList: true },
      { name: "discount_amount", label: "Discount", type: "number", showInList: true },
      { name: "payment_date", label: "Payment Date", type: "date" },
      {
        name: "payment_method",
        label: "Payment Method (Cash/Bank)",
        type: "select",
        options: RECEIPT_METHODS,
        required: true,
      },
      { name: "profit", label: "Profit", type: "number", showInList: true },
      { name: "remarks", label: "Remarks", type: "textarea" },
    ],
    computed: [
      { name: "balance", label: "Balance Due", compute: DUE("total_bill", "received_amount", "discount_amount") },
    ],
    summaryFields: [
      { name: "total_bill", label: "মোট বিল" },
      { name: "received_amount", label: "মোট Received" },
      { name: "discount_amount", label: "মোট Discount" },
      { name: "balance", label: "মোট Due" },
    ],
    groupBy: {
      field: "agent_name",
      label: "Customer/ Sub-Agent",
      metrics: [
        { name: "total_bill", label: "Total Bill" },
        { name: "received_amount", label: "Received" },
        { name: "discount_amount", label: "Discount" },
        { name: "balance", label: "Due" },
      ],
    },
  },
  {
    key: "vendor-ledger",
    label: "Vendor Data",
    short: "Vendor Ledger",
    table: "vendor_ledger",
    idColumn: "ledger_id",
    idPrefix: "VDL",
    monthlyId: true,
    fields: [
      { name: "entry_date", label: "Date", type: "date", showInList: true },
      {
        name: "vendor_name",
        label: "Vendor Name",
        type: "text",
        required: true,
        showInList: true,
        lookup: "vendor",
        filterable: true,
      },
      {
        name: "passenger_name",
        label: "Passenger",
        type: "text",
        showInList: true,
        format: "name",
      },
      { name: "passport", label: "Passport", type: "text", showInList: true, format: "passport" },
      { name: "mobile", label: "Phone", type: "text", showInList: true, format: "mobile" },
      {
        name: "service_type",
        label: "Service Type",
        type: "text",
        showInList: true,
        lookup: "ledger_service_type",
        lookupDefaults: LEDGER_SERVICE_TYPES,
      },
      {
        name: "country_route",
        label: "Country / Route",
        type: "text",
        showInList: true,
        lookup: "route",
      },
      { name: "total_payable", label: "Total Payable", type: "number", showInList: true },
      { name: "paid_amount", label: "Paid", type: "number", showInList: true },
      { name: "payment_date", label: "Payment Date", type: "date" },
      {
        name: "payment_method",
        label: "Payment Method (Cash/Bank)",
        type: "select",
        options: PAYMENT_METHODS,
        required: true,
      },
      { name: "profit", label: "Profit", type: "number", showInList: true },
      { name: "remarks", label: "Remarks", type: "textarea" },
    ],
    computed: [
      { name: "balance", label: "Balance Due", compute: DUE("total_payable", "paid_amount") },
    ],
    summaryFields: [
      { name: "total_payable", label: "মোট Payable" },
      { name: "paid_amount", label: "মোট Paid" },
      { name: "balance", label: "মোট Due" },
    ],
    groupBy: {
      field: "vendor_name",
      label: "Vendor",
      metrics: [
        { name: "total_payable", label: "Payable" },
        { name: "paid_amount", label: "Paid" },
        { name: "balance", label: "Due" },
      ],
    },
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
      {
        name: "name",
        label: "Name",
        type: "text",
        required: true,
        showInList: true,
        format: "name",
      },
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
      {
        name: "name",
        label: "Name",
        type: "text",
        required: true,
        showInList: true,
        format: "name",
      },
      { name: "phone", label: "Phone", type: "text", showInList: true, format: "mobile" },
      { name: "address", label: "Address", type: "text", showInList: true },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
];

export const moduleByKey = (key: string) => MODULES.find((m) => m.key === key);

/**
 * A received payment counts as "Advance" when it was taken before the service
 * was delivered. Rule: payment date < delivery date. If the service has no
 * delivery date yet (not delivered), every received payment is an advance.
 */
export function isAdvancePayment(
  paymentDate?: string | null,
  deliveryDate?: string | null
): boolean {
  if (!deliveryDate) return true; // not delivered yet → received money is advance
  if (!paymentDate) return false; // delivered & no specific payment date → settled
  const p = String(paymentDate).slice(0, 10);
  const d = String(deliveryDate).slice(0, 10);
  return p < d;
}

export const SERVICE_CATEGORIES = [
  { key: "tickets", label: "Ticket" },
  { key: "bmet", label: "BMET Card" },
  { key: "saudi-visa", label: "Saudi Visa" },
  { key: "kuwait-visa", label: "Kuwait Visa" },
  { key: "other", label: "Other" },
];

const APP_TZ = "Asia/Dhaka";


// Get tz-stable parts so SSR (UTC) and CSR (local) render identical strings.
function tzParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    dd: get("day"),
    mm: Number(get("month")),
    yyyy: get("year"),
    hh: get("hour"),
    mi: get("minute"),
    ampm: (get("dayPeriod") || "AM").toUpperCase(),
  };
}

const MONTHS_ABBR = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function monAbbr(monthNum: number): string {
  return MONTHS_ABBR[monthNum - 1] ?? String(monthNum).padStart(2, "0");
}

export function formatDate(d?: string | null): string {
  if (!d) return "";
  // Pure date input — format without TZ conversion to avoid day-shift.
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) {
    const [y, m, day] = d.trim().split("-");
    return `${day}-${monAbbr(Number(m))}-${y}`;
  }
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d);
  const p = tzParts(date);
  return `${String(p.dd).padStart(2, "0")}-${monAbbr(Number(p.mm))}-${p.yyyy}`;
}

export function formatDateTime(d?: string | null): string {
  if (!d) return "";
  // Pure date without time — don't fabricate a time.
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())) return formatDate(d);
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d);
  const p = tzParts(date);
  return `${String(p.dd).padStart(2, "0")}-${monAbbr(Number(p.mm))}-${p.yyyy} ${p.hh}:${p.mi} ${p.ampm}`;
}


export function statusBadgeClass(status?: string | null): string {
  const s = String(status ?? "").toLowerCase();
  switch (s) {
    case "done":
    case "delivered":
    case "delivery":
    case "visa issued":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
    case "processing":
    case "process":
    case "applied":
    case "medical":
    case "finger":
    case "mofa":
    case "ready":
    case "file process":
    case "card ready":
    case "issue":
      return "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30";
    case "pending delivery":
      return "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30";
    case "delivery but due":
      return "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30";
    case "new":
    case "book":
      return "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30";
    case "cancelled":
      return "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30";
    default:
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
  }
}
