"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { BUSINESS_PRESETS } from "@/lib/business-presets";
import { profileFor } from "@/lib/console-profile";
import { setConsoleType } from "@/app/(app)/settings/actions";

export function StoreSettings({
  storeId,
  storeName,
  businessType,
  canChangeType = false,
}: {
  storeId: string;
  storeName: string;
  businessType: string | null;
  canChangeType?: boolean;
}) {
  const router = useRouter();
  const current = (businessType ?? "").toLowerCase();
  const [value, setValue] = useState(current || "other");
  const [busy, setBusy] = useState(false);

  // Options = presets, plus the current value if it's a custom type not listed.
  const options = BUSINESS_PRESETS.map((p) => ({ id: p.id, label: p.label }));
  if (current && !options.some((o) => o.id === current)) {
    options.unshift({ id: current, label: `${current} (current)` });
  }

  const profile = profileFor(value);

  async function save() {
    if (value === current) return;
    setBusy(true);
    const res = await setConsoleType(storeId, value);
    setBusy(false);
    if (res.ok) {
      toast.success("Console type updated");
      router.refresh();
    } else {
      toast.error("Couldn't update", { description: res.error });
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="font-display text-2xl italic">Settings</h1>
        <p className="text-muted-foreground text-sm">{storeName}</p>
      </header>

      <div className="bg-card space-y-4 rounded-xl border p-5">
        <div>
          <h2 className="font-display font-bold">Console type</h2>
          <p className="text-muted-foreground text-sm">
            Sets which console this store uses and how the assistant is framed. Changing it reshapes the
            menu — it does not touch your assistant&apos;s tuning.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Business type</label>
          <Select value={value} onValueChange={setValue} disabled={!canChangeType}>
            <SelectTrigger className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            {profile === "saas" ? (
              <>
                → <span className="font-medium">SaaS / product console</span> — Embed &amp; install,
                integrations &amp; tools, no storefront menu.
              </>
            ) : (
              <>
                → <span className="font-medium">Local business console</span> — orders, redemptions, campaigns.
              </>
            )}
          </p>
          {!canChangeType && (
            <p className="text-muted-foreground text-xs">
              Only Ask Rani can change your console type. Contact us if you need to switch.
            </p>
          )}
        </div>

        {canChangeType && (
          <Button size="sm" onClick={save} disabled={busy || value === current}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </Button>
        )}
      </div>
    </div>
  );
}
