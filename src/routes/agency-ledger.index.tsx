import { createFileRoute } from "@tanstack/react-router";
import { PartyLedgerPage } from "@/components/PartyLedgerPage";

export const Route = createFileRoute("/agency-ledger/")({
  head: () => ({ meta: [{ title: "Agency Ledger — Travel Manager" }] }),
  component: () => <PartyLedgerPage kind="customer" name="" />,
});
