"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Store, Loader2, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  listSquareLocations,
  setSquareLocation,
  disconnectSquareAction,
} from "@/app/(app)/diner/actions";
import type { SquareLocation } from "@/lib/square/oauth";

const RETURN_MSG: Record<string, { ok: boolean; msg: string }> = {
  connected: { ok: true, msg: "Square connected" },
  unconfigured: { ok: false, msg: "Square isn't set up on this server yet" },
  denied: { ok: false, msg: "Square connection was cancelled" },
  badstate: { ok: false, msg: "Square connection expired — please try again" },
  forbidden: { ok: false, msg: "Only owners can connect Square" },
  error: { ok: false, msg: "Couldn't connect Square — please try again" },
};

export function SquareCard({
  configured,
  connected,
  locationName,
  environment,
}: {
  configured: boolean;
  connected: boolean;
  locationName: string | null;
  environment: string;
}) {
  const router = useRouter();
  const [locations, setLocations] = useState<SquareLocation[] | null>(null);
  const [busy, start] = useTransition();

  // One-time feedback when Square redirects back to /diner?square=...
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("square");
    if (!code) return;
    const m = RETURN_MSG[code];
    if (m) (m.ok ? toast.success : toast.error)(m.msg);
    router.replace("/diner");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadLocations() {
    start(async () => setLocations(await listSquareLocations()));
  }
  function pick(loc: SquareLocation) {
    start(async () => {
      const res = await setSquareLocation(loc.id, loc.name);
      if (res.ok) {
        toast.success(`Orders now route to ${loc.name}`);
        setLocations(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }
  function disconnect() {
    start(async () => {
      await disconnectSquareAction();
      toast.success("Square disconnected");
      router.refresh();
    });
  }

  return (
    <div className="bg-card space-y-3 rounded-lg border p-4">
      <div className="flex items-start gap-2">
        <Store className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="space-y-0.5">
          <h2 className="text-sm font-medium">
            Square POS
            {connected && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-teal-mist px-2 py-0.5 text-[10px] font-normal text-teal-deep">
                <Check className="size-3" /> Connected
              </span>
            )}
            {environment === "sandbox" && configured && (
              <span className="text-muted-foreground ml-2 text-[10px] font-normal">sandbox</span>
            )}
          </h2>
          <p className="text-muted-foreground text-sm">
            When you approve an order, Rani sends it straight to your Square as an open ticket.
            Rani adds the order — it never touches payment.
          </p>
        </div>
      </div>

      {!configured ? (
        <p className="text-muted-foreground text-xs">Square isn&apos;t enabled on this server yet.</p>
      ) : !connected ? (
        <Button size="sm" onClick={() => (window.location.href = "/api/square/connect")}>
          <Store className="size-4" /> Connect Square
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm">
            Routing orders to <span className="font-medium">{locationName ?? "your default location"}</span>.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {locations === null ? (
              <Button size="sm" variant="outline" onClick={loadLocations} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Change location
              </Button>
            ) : locations.length === 0 ? (
              <span className="text-muted-foreground text-xs">No locations found.</span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {locations.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    disabled={busy}
                    onClick={() => pick(l)}
                    className="border-border hover:bg-muted rounded-full border px-2.5 py-1 text-xs disabled:opacity-50"
                  >
                    {l.name}
                    {l.status !== "ACTIVE" && <span className="text-muted-foreground"> ({l.status.toLowerCase()})</span>}
                  </button>
                ))}
              </div>
            )}
            <Button size="sm" variant="ghost" onClick={disconnect} disabled={busy} className="text-muted-foreground">
              Disconnect
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
