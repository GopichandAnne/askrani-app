"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { connectStripe, disconnectProvider, providerStatus } from "@/app/(app)/integrations/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Loader2, Store } from "lucide-react";

/** One-click prebuilt connectors for non-technical owners — no endpoint, no code. */
export function PrebuiltConnectors({ onChange }: { onChange: () => void }) {
  const [stripe, setStripe] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    providerStatus().then((s) => {
      setStripe(s.stripe);
      setLoading(false);
    });
  }, []);

  async function connect() {
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

  async function disconnect() {
    setBusy(true);
    const res = await disconnectProvider("stripe");
    setBusy(false);
    if (res.ok) {
      setStripe(false);
      toast.success("Stripe disconnected");
      onChange();
    } else toast.error("Couldn't disconnect", { description: res.error });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Quick connect</p>

      {/* Stripe — payment links */}
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
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : stripe ? (
            <Badge className="bg-teal text-white">Connected</Badge>
          ) : null}
        </div>
        {!loading &&
          (stripe ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground mt-2"
              disabled={busy}
              onClick={disconnect}
            >
              Disconnect
            </Button>
          ) : open ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Stripe secret key (sk_live_… or sk_test_…)"
                className="h-9 min-w-[220px] flex-1"
              />
              <Button size="sm" onClick={connect} disabled={busy || !key.trim()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null} Connect
              </Button>
              <p className="text-muted-foreground w-full text-xs">
                Find it in Stripe → Developers → API keys. We store it securely and use it only to
                create your payment links.
              </p>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpen(true)}>
              Connect Stripe
            </Button>
          ))}
      </div>

      {/* Square — POS (one-click login coming soon) */}
      <div className="bg-card rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Store className="text-muted-foreground size-5 shrink-0" />
            <div>
              <p className="text-sm font-medium">Square — POS orders</p>
              <p className="text-muted-foreground text-xs">
                Send confirmed orders straight to your Square POS. One-click &ldquo;Log in with
                Square&rdquo; is coming soon.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-muted-foreground">
            Soon
          </Badge>
        </div>
      </div>
    </div>
  );
}
