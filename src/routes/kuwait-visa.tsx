import { createFileRoute } from "@tanstack/react-router";
import { ModulePage } from "@/components/ModulePage";
import { moduleByKey } from "@/lib/modules";

export const Route = createFileRoute("/kuwait-visa")({
  head: () => ({ meta: [{ title: "কুয়েত ভিসা — Travel Manager" }] }),
  component: () => <ModulePage module={moduleByKey("kuwait-visa")!} />,
});
