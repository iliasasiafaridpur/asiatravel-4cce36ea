import { createFileRoute } from "@tanstack/react-router";
import { PartyLedgerPage } from "@/components/PartyLedgerPage";

export const Route = createFileRoute("/vendor-ledger/$name")({
  head: () => ({ meta: [{ title: "Vendor Ledger — Travel Manager" }] }),
  component: VendorLedgerRoute,
});

function VendorLedgerRoute() {
  const { name } = Route.useParams();
  return <PartyLedgerPage kind="vendor" name={decodeURIComponent(name)} />;
}
