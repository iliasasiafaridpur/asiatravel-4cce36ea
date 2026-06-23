import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LedgerPage } from "@/components/LedgerPage";
import { moduleByKey } from "@/lib/modules";

interface CustomerLedgerSearch {
  pay?: string;
}

export const Route = createFileRoute("/customer-data")({
  head: () => ({ meta: [{ title: "Customers Data — Travel Manager" }] }),
  validateSearch: (search: Record<string, unknown>): CustomerLedgerSearch => ({
    pay: typeof search.pay === "string" ? search.pay : undefined,
  }),
  component: CustomerLedgerRoute,
});

function CustomerLedgerRoute() {
  const { pay } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <LedgerPage
      module={moduleByKey("agency-ledger")!}
      autoPay={pay}
      onAutoPayHandled={() => navigate({ to: "/customer-data", search: {}, replace: true })}
    />
  );
}
