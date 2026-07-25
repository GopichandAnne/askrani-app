"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  connectDemoPos,
  connectStripe,
  disconnectProvider,
  providerStatus,
} from "@/app/(app)/integrations/actions";
import { useStore } from "@/components/store/store-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Check, Copy, CreditCard, Loader2, ReceiptText } from "lucide-react";

/** One-click prebuilt connectors for non-technical owners — no endpoint, no code. */
export function PrebuiltConnectors({ onChange }: { onChange: () => void }) {
  const { active } = useStore();
  const [stripe, setStripe] = useState(false);
  const [stripeWebhook, setStripeWebhook] = useState(false);
  const [demoPos, setDemoPos] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const [hook, setHook] = useState("");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const webhookUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/functions/v1/stripe-webhook?store=${active.slug}`;

  useEffect(() => {
    providerStatus().then((s) => {
      setStripe(s.stripe);
      setStripeWebhook(s.stripeWebhook);
      setDemoPos(s.demoPos);
      setLoading(false);
    });
  }, []);

  function copyUrl() {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function connectStripeKey() {
    setBusy(true);
    const res = await connectStripe(key, hook);
    setBusy(false);
    if (res.ok) {
      setStripe(true);
      setStripeWebhook(!!hook.trim());
      setKey("");
      setHook("");
      setOpen(false);
      toast.success(hook.trim() ? "Stripe connected — card payments are live" : "Stripe connected");
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
      if (provider === "stripe") {
        setStripe(false);
        setStripeWebhook(false);
      }
      toast.success("Disconnected");
      onChange();
    } else toast.error("Couldn't disconnect", { description: res.error });
  }

  const webhookBox = (
    <div className="bg-muted/40 space-y-1.5 rounded-md border p-2.5">
      <p className="text-muted-foreground text-xs">
        In Stripe → <b>Developers → Webhooks → Add endpoint</b>, paste this URL and select the{" "}
        <code className="text-[11px]">checkout.session.completed</code> event. Stripe then shows a{" "}
        <b>signing secret</b> (<code className="text-[11px]">whsec_…</code>) — paste it below.
      </p>
      <div className="flex items-center gap-2">
        <code className="bg-background flex-1 truncate rounded border px-2 py-1 text-[11px]" title={webhookUrl}>
          {webhookUrl}
        </code>
        <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={copyUrl}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Payments */}
      <div>
        <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">Payments</p>
        <div className="bg-card space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CreditCard className="text-teal-deep size-5 shrink-0" />
              <div>
                <p className="text-sm font-medium">Stripe — card payments</p>
                <p className="text-muted-foreground text-xs">
                  Guests pay by card (in chat, or &ldquo;Pay now&rdquo; at the table). Money goes to your
                  Stripe; the card is entered on Stripe, never here.
                </p>
              </div>
            </div>
            {loading ? <Loader2 className="size-4 animate-spin" /> : stripe ? <Badge className="bg-teal text-white">Connected</Badge> : null}
          </div>

          {!loading && stripe && !open && (
            <div className="space-y-2">
              {stripeWebhook ? (
                <p className="text-teal-deep flex items-center gap-1.5 text-xs">
                  <Check className="size-3.5" /> Card payments live — orders are auto-marked paid.
                </p>
              ) : (
                <p className="text-amber-700 dark:text-amber-300 flex items-start gap-1.5 text-xs">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  Add your webhook signing secret so paid orders are confirmed automatically. Until then,
                  payment links work but orders won&apos;t auto-mark as paid.
                </p>
              )}
              <div className="flex gap-2">
                {!stripeWebhook && (
                  <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Finish setup</Button>
                )}
                <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => disconnect("stripe")}>
                  Disconnect
                </Button>
              </div>
            </div>
          )}

          {!loading && !stripe && !open && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Connect Stripe</Button>
          )}

          {!loading && open && (
            <div className="space-y-2.5">
              {webhookBox}
              <Input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Stripe secret key (sk_live_… or a restricted rk_… key)"
                className="h-9"
                autoComplete="off"
              />
              <Input
                type="password"
                value={hook}
                onChange={(e) => setHook(e.target.value)}
                placeholder="Webhook signing secret (whsec_…)"
                className="h-9"
                autoComplete="off"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={connectStripeKey} disabled={busy || !key.trim()}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null} Connect
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Tip: use a <b>restricted key</b> (Stripe → Developers → API keys → Restricted) limited to
                Checkout &amp; PaymentIntents — safer than your full secret key.
              </p>
            </div>
          )}
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
