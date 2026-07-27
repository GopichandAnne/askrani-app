"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateBusinessType } from "@/app/(app)/agent/actions";
import { BUSINESS_PRESETS } from "@/lib/business-presets";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Briefcase, Loader2 } from "lucide-react";

/**
 * Owner-facing business-type picker. Previously admin-only, so owners couldn't
 * fit the console to their kind of business. Saving relabels the panel (vertical
 * vocabulary) via a full router refresh; it does not touch the agent's wording.
 */
export function BusinessTypeCard({ initial }: { initial: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initial ?? "");
  const [saving, start] = useTransition();
  const dirty = value !== (initial ?? "");

  function save() {
    start(async () => {
      const res = await updateBusinessType(value);
      if (res.ok) {
        toast.success("Business type updated");
        router.refresh(); // relabel nav + titles for the new vertical
      } else {
        toast.error("Couldn't update", { description: res.error });
      }
    });
  }

  return (
    <div className="bg-card space-y-3 rounded-lg border p-4">
      <div className="flex items-start gap-2">
        <Briefcase className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">Business type</Label>
          <p className="text-muted-foreground text-sm">
            Tailors the wording across your console — a restaurant manages a
            &ldquo;Menu&rdquo;, a bookshop manages &ldquo;Books&rdquo;. Changing
            this relabels your panel; it doesn&apos;t rewrite the assistant
            settings below.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger className="max-w-xs">
            <SelectValue placeholder="Select type…" />
          </SelectTrigger>
          <SelectContent>
            {BUSINESS_PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={save} disabled={saving || !dirty || !value}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </div>
  );
}
