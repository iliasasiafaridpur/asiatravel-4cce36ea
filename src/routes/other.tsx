import { createFileRoute } from "@tanstack/react-router";
import { ModulePage } from "@/components/ModulePage";
import { moduleByKey } from "@/lib/modules";

export const Route = createFileRoute("/other")({
  head: () => ({ meta: [{ title: "Other Service — Travel Manager" }] }),
  component: () => <ModulePage module={moduleByKey("other")!} />,
});
