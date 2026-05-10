import { createFileRoute } from "@tanstack/react-router";
import { ModulePage } from "@/components/ModulePage";
import { moduleByKey } from "@/lib/modules";

export const Route = createFileRoute("/bmet")({
  head: () => ({ meta: [{ title: "BMET কার্ড — Travel Manager" }] }),
  component: () => <ModulePage module={moduleByKey("bmet")!} />,
});
