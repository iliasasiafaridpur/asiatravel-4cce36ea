import { format } from "date-fns";

export const STATUSES = ["Pending", "Processing", "Done", "Cancelled"] as const;
export type Status = (typeof STATUSES)[number];

export const statusStyle: Record<Status, string> = {
  Pending: "bg-warning/15 text-warning border-warning/30",
  Processing: "bg-info/15 text-info border-info/30",
  Done: "bg-success/15 text-success border-success/30",
  Cancelled: "bg-destructive/15 text-destructive border-destructive/30",
};

export function formatDate(date: string | Date) {
  return format(new Date(date), "dd/MM/yyyy");
}
