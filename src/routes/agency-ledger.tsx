import { createFileRoute } from "@tanstack/react-router";
import { ModulePage } from "@/components/ModulePage";
import { moduleByKey } from "@/lib/modules";

export const Route = createFileRoute("/agency-ledger")({
  head: () => ({ meta: [{ title: "Agency খাতা — Travel Manager" }] }),
  component: () => <ModulePage module={moduleByKey("agency-ledger")!} />,
});
