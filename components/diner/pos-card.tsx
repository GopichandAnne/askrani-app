"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Store, Loader2, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listPosLocations,
  setPosLocation,
  disconnectPosAction,
  connectPosManual,
} from "@/app/(app)/diner/actions";
import type { PosLocation, PosManualField } from "@/lib/pos/types";

export type PosProviderState = {
  id: string;
  label: string;
  connected: boolean;
  locationName: string | null;
  environment: string;
  connectStyle: "oauth" | "manual";
  manualFields?: PosManualField[];
};

const RETURN_MSG: Record<string, { ok: boolean; msg: string }> = {
  connected: { ok: true, msg: "connected" },
  unconfigured: { ok: false, msg: "isn't set up on this server yet" },
  denied: { ok: false, msg: "connection was cancelled" },
  badstate: { ok: false, msg: "connection expired — please try again" },
  forbidden: { ok: false, msg: "connection needs an owner" },
  error: { ok: false, msg: "couldn't connect — please try again" },
};

export function PosCard({ providers }: { providers: PosProviderState[] }) {
  const router = useRouter();
  const [locations, setLocations] = useState<Record<string, PosLocation[] | null>>({});
  const [manual, setManual] = useState<Record<string, Record<string, string>>>({});
  const [busy, start] = useTransition();

  function submitManual(id: string, label: string) {
    start(async () => {
      const res = await connectPosManual(id, manual[id] ?? {});
      if (res.ok) {
        toast.success(`${label} connected`);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  // One-time feedback when a provider redirects back to /diner?pos=..&pos_status=..
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const provider = q.get("pos");
    const status = q.get("pos_status");
    if (!provider || !status) return;
    const label = providers.find((p) => p.id === provider)?.label ?? "POS";
    const m = RETURN_MSG[status];
    if (m) (m.ok ? toast.success : toast.error)(`${label} ${m.msg}`);
    router.replace("/diner");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadLocations(id: string) {
    start(async () => {
      const locs = await listPosLocations(id);
      setLocations((s) => ({ ...s, [id]: locs }));
    });
  }
  function pick(id: string, loc: PosLocation) {
    start(async () => {
      const res = await setPosLocation(id, loc.id, loc.name);
      if (res.ok) {
        toast.success(`Orders now route to ${loc.name}`);
        setLocations((s) => ({ ...s, [id]: null }));
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }
  function disconnect(id: string, label: string) {
    start(async () => {
      await disconnectPosAction(id);
      toast.success(`${label} disconnected`);
      router.refresh();
    });
  }

  return (
    <div className="bg-card space-y-3 rounded-lg border p-4">
      <div className="flex items-start gap-2">
        <Store className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="space-y-0.5">
          <h2 className="text-sm font-medium">Point of sale</h2>
          <p className="text-muted-foreground text-sm">
            When you approve an order, Rani sends it straight to your POS as an open ticket.
            Rani adds the order — it never touches payment.
          </p>
        </div>
      </div>

      {providers.length === 0 ? (
        <p className="text-muted-foreground text-xs">No POS is enabled on this server yet.</p>
      ) : (
        <div className="space-y-3">
          {providers.map((p) => (
            <div key={p.id} className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{p.label}</span>
                {p.connected && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-teal-mist px-2 py-0.5 text-[10px] text-teal-deep">
                    <Check className="size-3" /> Connected
                  </span>
                )}
                {p.environment === "sandbox" && (
                  <span className="text-muted-foreground text-[10px]">sandbox</span>
                )}
              </div>

              {!p.connected ? (
                p.connectStyle === "manual" ? (
                  <div className="space-y-2">
                    {(p.manualFields ?? []).map((f) => (
                      <div key={f.key} className="space-y-1">
                        <Label className="text-xs">{f.label}</Label>
                        <Input
                          value={manual[p.id]?.[f.key] ?? ""}
                          onChange={(e) =>
                            setManual((s) => ({ ...s, [p.id]: { ...s[p.id], [f.key]: e.target.value } }))
                          }
                          className="h-9"
                        />
                        {f.help && <p className="text-muted-foreground text-[11px]">{f.help}</p>}
                      </div>
                    ))}
                    <Button size="sm" onClick={() => submitManual(p.id, p.label)} disabled={busy}>
                      {busy ? <Loader2 className="size-4 animate-spin" /> : <Store className="size-4" />}
                      Connect {p.label}
                    </Button>
                  </div>
                ) : (
                  <div>
                    <Button size="sm" onClick={() => (window.location.href = `/api/pos/${p.id}/connect`)}>
                      <Store className="size-4" /> Connect {p.label}
                    </Button>
                  </div>
                )
              ) : (
                <div className="space-y-2">
                  <p className="text-sm">
                    Routing to <span className="font-medium">{p.locationName ?? "your default location"}</span>.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {locations[p.id] == null ? (
                      <Button size="sm" variant="outline" onClick={() => loadLocations(p.id)} disabled={busy}>
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                        Change location
                      </Button>
                    ) : locations[p.id]!.length === 0 ? (
                      <span className="text-muted-foreground text-xs">No locations found.</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {locations[p.id]!.map((l) => (
                          <button
                            key={l.id}
                            type="button"
                            disabled={busy}
                            onClick={() => pick(p.id, l)}
                            className="border-border hover:bg-muted rounded-full border px-2.5 py-1 text-xs disabled:opacity-50"
                          >
                            {l.name}
                          </button>
                        ))}
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => disconnect(p.id, p.label)}
                      disabled={busy}
                      className="text-muted-foreground"
                    >
                      Disconnect
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
