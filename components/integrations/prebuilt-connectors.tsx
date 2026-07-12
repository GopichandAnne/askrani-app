"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  connectDemoPos,
  connectStripe,
  disconnectProvider,
  providerStatus,
} from "@/app/(app)/integrations/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Loader2, ReceiptText } from "lucide-react";

/** One-click prebuilt connectors for non-technical owners — no endpoint, no code. */
export function PrebuiltConnectors({ onChange }: { onChange: () => void }) {
  const [stripe, setStripe] = useState(false);
  const [demoPos, setDemoPos] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    providerStatus().then((s) => {
      setStripe(s.stripe);
      setDemoPos(s.demoPos);
      setLoading(false);
    });
  }, []);

  async function connectStripeKey() {
    setBusy(true);
    const res = await connectStripe(key);
    setBusy(false);
    if (res.ok) {
      setStripe(true);
      setKey("");
      setOpen(false);
      toast.success("Stripe connected — payment links are on");
      onChange();
    } else toast.error("Couldn't connect Stripe", { description: res.error });
  }

  async function toggleDemoPos() {
    setBusy(true);
    const res = demoPos ? await disconnectProvider("demo_pos") : await connectDemoPos();
    setBusy(false);
    if (res.ok) {
      setDemoPos(!demoPos);
      toast.success(demoPos ? "Demo POS disconnected" : "Demo POS connected — orders now fire to a kitchen ticket");
      onChange();
    } else toast.error("Couldn't update", { description: res.error });
  }

  async function disconnect(provider: string) {
    setBusy(true);
    const res = await disconnectProvider(provider);
    setBusy(false);
    if (res.ok) {
      if (provider === "stripe") setStripe(false);
      toast.success("Disconnected");
      onChange();
    } else toast.error("Couldn't disconnect", { description: res.error });
  }

  return (
    <div className="space-y-4">
      {/* Payments */}
      <div>
        <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">Payments</p>
        <div className="bg-card rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CreditCard className="text-teal-deep size-5 shrink-0" />
              <div>
                <p className="text-sm font-medium">Stripe — payment links</p>
                <p className="text-muted-foreground text-xs">
                  Send secure links to get orders paid. The card is entered on Stripe, never in chat.
                </p>
              </div>
            </div>
            {loading ? <Loader2 className="size-4 animate-spin" /> : stripe ? <Badge className="bg-teal text-white">Connected</Badge> : null}
          </div>
          {!loading &&
            (stripe ? (
              <Button size="sm" variant="ghost" className="text-muted-foreground mt-2" disabled={busy} onClick={() => disconnect("stripe")}>
                Disconnect
              </Button>
            ) : open ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Stripe secret key (sk_live_… or sk_test_…)" className="h-9 min-w-[220px] flex-1" />
                <Button size="sm" onClick={connectStripeKey} disabled={busy || !key.trim()}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null} Connect
                </Button>
                <p className="text-muted-foreground w-full text-xs">Stripe → Developers → API keys. We store it securely and use it only for your payment links.</p>
              </div>
            ) : (
              <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpen(true)}>
                Connect Stripe
              </Button>
            ))}
        </div>
      </div>

      {/* Point of sale */}
      <div>
        <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">Point of sale</p>
        <div className="space-y-2">
          {/* Demo POS — connectable now */}
          <div className="bg-card rounded-lg border p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ReceiptText className="text-teal-deep size-5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Demo POS — kitchen tickets</p>
                  <p className="text-muted-foreground text-xs">
                    Try the flow now: confirmed orders fire to a demo kitchen ticket with an ETA. Swap
                    for your real POS below.
                  </p>
                </div>
              </div>
              {loading ? <Loader2 className="size-4 animate-spin" /> : demoPos ? <Badge className="bg-teal text-white">Connected</Badge> : null}
            </div>
            {!loading && (
              <Button size="sm" variant={demoPos ? "ghost" : "outline"} className={demoPos ? "text-muted-foreground mt-2" : "mt-2"} disabled={busy} onClick={toggleDemoPos}>
                {demoPos ? "Disconnect" : "Connect Demo POS"}
              </Button>
            )}
          </div>

          {/* Real POS providers — setup required (needs the platform's provider app) */}
          {["Square", "Toast", "Clover"].map((p) => (
            <div key={p} className="bg-card/60 flex items-center justify-between gap-3 rounded-lg border border-dashed p-4">
              <div className="flex items-center gap-2">
                <ReceiptText className="text-muted-foreground size-5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">{p} POS</p>
                  <p className="text-muted-foreground text-xs">
                    One-click &ldquo;Log in with {p}&rdquo; — we set this up with you once (a quick app
                    registration on your {p} account).
                  </p>
                </div>
              </div>
              <Badge variant="outline" className="text-muted-foreground shrink-0">
                Setup with us
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
