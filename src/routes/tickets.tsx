import { createFileRoute } from "@tanstack/react-router";
import { ModulePage } from "@/components/ModulePage";
import { moduleByKey } from "@/lib/modules";

export const Route = createFileRoute("/tickets")({
  head: () => ({ meta: [{ title: "AIR TICKET — Travel Manager" }] }),
  component: () => <ModulePage module={moduleByKey("tickets")!} />,
});
