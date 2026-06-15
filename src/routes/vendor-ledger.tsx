import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LedgerPage } from "@/components/LedgerPage";
import { moduleByKey } from "@/lib/modules";

interface VendorLedgerSearch {
  pay?: string;
}

export const Route = createFileRoute("/vendor-ledger")({
  head: () => ({ meta: [{ title: "Vendor Data — Travel Manager" }] }),
  validateSearch: (search: Record<string, unknown>): VendorLedgerSearch => ({
    pay: typeof search.pay === "string" ? search.pay : undefined,
  }),
  component: VendorLedgerRoute,
});

function VendorLedgerRoute() {
  const { pay } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <LedgerPage
      module={moduleByKey("vendor-ledger")!}
      autoPay={pay}
      onAutoPayHandled={() => navigate({ to: "/vendor-ledger", search: {}, replace: true })}
    />
  );
}
