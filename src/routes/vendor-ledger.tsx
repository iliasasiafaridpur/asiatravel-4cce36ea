import { createFileRoute } from "@tanstack/react-router";
import { ModulePage } from "@/components/ModulePage";
import { moduleByKey } from "@/lib/modules";

export const Route = createFileRoute("/vendor-ledger")({
  head: () => ({ meta: [{ title: "Vendor খাতা — Travel Manager" }] }),
  component: () => <ModulePage module={moduleByKey("vendor-ledger")!} />,
});
