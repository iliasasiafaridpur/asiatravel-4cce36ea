import { createFileRoute } from "@tanstack/react-router";
import { PartyLedgerPage } from "@/components/PartyLedgerPage";

export const Route = createFileRoute("/agency-ledger/$name")({
  head: () => ({ meta: [{ title: "Agency Ledger — Travel Manager" }] }),
  component: AgencyLedgerRoute,
});

function AgencyLedgerRoute() {
  const { name } = Route.useParams();
  return <PartyLedgerPage kind="customer" name={decodeURIComponent(name)} />;
}
