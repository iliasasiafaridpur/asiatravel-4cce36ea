import { createFileRoute } from "@tanstack/react-router";
import { LedgerPage } from "@/components/LedgerPage";
import { moduleByKey } from "@/lib/modules";

export const Route = createFileRoute("/vendor-ledger")({
  head: () => ({ meta: [{ title: "Vendor Data — Travel Manager" }] }),
  component: () => <LedgerPage module={moduleByKey("vendor-ledger")!} />,
});
