import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FormSections } from "@/components/ModulePage";
import { moduleByKey } from "@/lib/modules";

export const Route = createFileRoute("/formtest")({
  component: () => {
    const mod = moduleByKey("kuwait-visa")!;
    const [form, setForm] = useState<Record<string, unknown>>({});
    return (
      <div className="p-4">
        <FormSections mod={mod} form={form} setForm={setForm} />
        <pre data-testid="dump">{JSON.stringify(mod.fields.map((f) => f.name))}</pre>
      </div>
    );
  },
});
