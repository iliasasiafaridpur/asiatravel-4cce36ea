import { createFileRoute } from "@tanstack/react-router";
import { PartyLedgerPage } from "@/components/PartyLedgerPage";

export const Route = createFileRoute("/vendor-ledger/")({
  head: () => ({ meta: [{ title: "Vendor Ledger — Travel Manager" }] }),
  component: () => <PartyLedgerPage kind="vendor" name="" />,
});
