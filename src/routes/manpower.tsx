import { createFileRoute } from "@tanstack/react-router";
import { ModulePage } from "@/components/ModulePage";
import { moduleByKey } from "@/lib/modules";

export const Route = createFileRoute("/manpower")({
  head: () => ({ meta: [{ title: "Manpower — Travel Manager" }] }),
  component: () => <ModulePage module={moduleByKey("manpower")!} />,
});
