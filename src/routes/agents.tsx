import { createFileRoute } from "@tanstack/react-router";
import { ModulePage } from "@/components/ModulePage";
import { moduleByKey } from "@/lib/modules";

export const Route = createFileRoute("/agents")({
  head: () => ({ meta: [{ title: "Agent List — Travel Manager" }] }),
  component: () => <ModulePage module={moduleByKey("agents")!} />,
});
