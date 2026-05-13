import { createFileRoute } from "@tanstack/react-router";
import AccountingModule from "@/components/AccountingModule";

export const Route = createFileRoute("/accounting")({
  head: () => ({ meta: [{ title: "Accounting Module — Travel Manager" }] }),
  component: AccountingModule,
});
