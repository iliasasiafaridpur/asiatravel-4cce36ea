import { createFileRoute } from "@tanstack/react-router";
import { PartyLedgerPage } from "@/components/PartyLedgerPage";

interface VendorLedgerSearch {
  pay?: string;
}

export const Route = createFileRoute("/vendor-ledger/$name")({
  head: () => ({ meta: [{ title: "Vendor Ledger — Travel Manager" }] }),
  validateSearch: (search: Record<string, unknown>): VendorLedgerSearch => ({
    pay: typeof search.pay === "string" ? search.pay : undefined,
  }),
  component: VendorLedgerRoute,
});

function VendorLedgerRoute() {
  const { name } = Route.useParams();
  const { pay } = Route.useSearch();
  return (
    <PartyLedgerPage
      kind="vendor"
      name={decodeURIComponent(name)}
      autoPayTarget={pay}
    />
  );
}
