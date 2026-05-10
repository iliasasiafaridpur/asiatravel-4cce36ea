import { createFileRoute } from "@tanstack/react-router";
import { ModulePage } from "@/components/ModulePage";
import { moduleByKey } from "@/lib/modules";

export const Route = createFileRoute("/vendors")({
  head: () => ({ meta: [{ title: "Vendor List — Travel Manager" }] }),
  component: () => <ModulePage module={moduleByKey("vendors")!} />,
});
