import { createFileRoute } from "@tanstack/react-router";
import { ModulePage } from "@/components/ModulePage";
import { moduleByKey } from "@/lib/modules";

export const Route = createFileRoute("/saudi-visa")({
  head: () => ({ meta: [{ title: "সৌদি ভিসা — Travel Manager" }] }),
  component: () => <ModulePage module={moduleByKey("saudi-visa")!} />,
});
