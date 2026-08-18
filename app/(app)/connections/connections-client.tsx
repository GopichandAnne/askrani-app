"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Check } from "lucide-react";
import { disconnectProvider } from "./actions";

export type ConnStatus = { label: string | null };

type Provider = { id: string; name: string; blurb: string; accent: string };

const CATALOG: Provider[] = [
  { id: "google", name: "Google", blurb: "Calendar — Rani checks availability and books appointments.", accent: "#4285F4" },
  { id: "microsoft", name: "Microsoft", blurb: "Outlook calendar — check availability and book, on Microsoft 365.", accent: "#0067b8" },
  { id: "square", name: "Square", blurb: "Catalog & orders — stock lookups and order status in chat.", accent: "#111827" },
  { id: "hubspot", name: "HubSpot", blurb: "CRM — captured leads flow straight into your pipeline.", accent: "#ff7a59" },
  { id: "calendly", name: "Calendly", blurb: "Scheduling — Rani shares your booking link and event types.", accent: "#006bff" },
];

const ERR: Record<string, string> = {
  expired: "That connection link expired — please try again.",
  denied: "The connection was cancelled.",
  unconfigured: "That provider isn't set up on our side yet.",
  notoken: "The provider didn't return access — please try again.",
  exchange: "Something went wrong finishing the connection — please try again.",
};

export function ConnectionsClient({
  storeSlug, isOwner, connected,
}: { storeSlug: string; isOwner: boolean; connected: Record<string, ConnStatus> }) {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);

  // Toast the result of a just-finished OAuth round-trip, then clean the URL.
  useEffect(() => {
    const ok = params.get("connected");
    const err = params.get("error");
    if (ok) {
      const label = params.get("label");
      toast.success(`Connected to ${cap(ok)}`, { description: label ? `Signed in as ${label}.` : undefined });
    } else if (err) {
      toast.error("Couldn't connect", { description: ERR[err] ?? "Please try again." });
    }
    if (ok || err) router.replace("/connections");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect(provider: string) {
    if (!isOwner) { toast.error("Only the store owner can connect accounts."); return; }
    setBusy(provider);
    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("oauth-start", { body: { storeSlug, provider } });
    if (error || !data?.url) {
      setBusy(null);
      const msg = (data as { error?: string } | null)?.error;
      toast.error("Couldn't start the connection", { description: msg ?? "Please try again." });
      return;
    }
    // Hand the browser to the provider's own sign-in.
    window.location.href = data.url as string;
  }

  async function remove(provider: string) {
    setBusy(provider);
    const res = await disconnectProvider(provider);
    setBusy(null);
    if (!res.ok) { toast.error("Couldn't disconnect", { description: res.error }); return; }
    toast.success(`Disconnected ${cap(provider)}`);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {CATALOG.map((p) => {
        const conn = connected[p.id];
        const isBusy = busy === p.id;
        return (
          <div key={p.id} className="flex items-center gap-4 rounded-xl border p-4">
            <span
              className="flex size-10 flex-none items-center justify-center rounded-lg text-sm font-bold text-white"
              style={{ background: p.accent }}
              aria-hidden="true"
            >
              {p.name[0]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{p.name}</span>
                {conn && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    <Check className="size-3" /> Connected
                  </span>
                )}
              </div>
              <p className="text-muted-foreground truncate text-sm">
                {conn?.label ? `${conn.label}` : p.blurb}
              </p>
            </div>
            {conn ? (
              <Button variant="outline" size="sm" disabled={isBusy || !isOwner} onClick={() => remove(p.id)}>
                {isBusy ? <Loader2 className="size-4 animate-spin" /> : "Disconnect"}
              </Button>
            ) : (
              <Button size="sm" disabled={isBusy || !isOwner} onClick={() => connect(p.id)}>
                {isBusy ? <Loader2 className="size-4 animate-spin" /> : "Connect"}
              </Button>
            )}
          </div>
        );
      })}
      {!isOwner && (
        <p className="text-muted-foreground text-xs">Only the store owner can add or remove connections.</p>
      )}
    </div>
  );
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
