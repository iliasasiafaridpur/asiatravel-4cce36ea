import { createFileRoute } from "@tanstack/react-router";
import { LedgerPage } from "@/components/LedgerPage";
import { moduleByKey } from "@/lib/modules";

export const Route = createFileRoute("/agency-ledger")({
  head: () => ({ meta: [{ title: "Agency খাতা — Travel Manager" }] }),
  component: () => <LedgerPage module={moduleByKey("agency-ledger")!} />,
});
