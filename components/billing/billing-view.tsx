"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Coins, Loader2, TrendingUp } from "lucide-react";
import {
  createTopupCheckout,
  setCreditsEnforced,
  type BillingConfig,
  type LedgerRow,
  type WalletView,
} from "@/app/(app)/billing/actions";

function fmt(n: number): string {
  return n.toLocaleString();
}

export function BillingView({
  storeId,
  wallet,
  ledger,
  config,
  isPlatformAdmin = false,
  enforced = false,
}: {
  storeId: string;
  wallet: WalletView;
  ledger: LedgerRow[];
  config: BillingConfig;
  isPlatformAdmin?: boolean;
  enforced?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [enforce, setEnforce] = useState(enforced);

  async function toggleEnforce(next: boolean) {
    setEnforce(next); // optimistic
    const res = await setCreditsEnforced(storeId, next);
    if (!res.ok) {
      setEnforce(!next);
      toast.error("Couldn't update", { description: res.error });
    } else {
      toast.success(next ? "Enforcement enrolled for this store" : "Enforcement removed");
    }
  }

  // Toast the outcome after returning from Stripe.
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search).get("purchase");
      if (p === "success") toast.success("Payment received — credits are on the way.");
      else if (p === "cancelled") toast.message("Checkout cancelled — no charge.");
      if (p) window.history.replaceState({}, "", window.location.pathname);
    } catch {
      /* ignore */
    }
  }, []);

  async function buy(key: string) {
    setBusy(key);
    const res = await createTopupCheckout(storeId, key);
    if (res.ok) {
      window.location.href = res.url;
    } else {
      setBusy(null);
      toast.error("Couldn't start checkout", { description: res.error });
    }
  }

  const empty = wallet.balance <= 0;
  const low = !empty && wallet.balance <= 50;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="font-display text-2xl italic">Credits &amp; billing</h1>
        <p className="text-muted-foreground text-sm">Rani runs on credits — top up any time, pay as you go.</p>
      </header>

      {/* Balance */}
      <div className="bg-card rounded-xl border p-5">
        <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
          <Coins className="size-4" /> Balance
        </div>
        <div className="mt-1 flex items-end gap-2">
          <span className="font-display text-4xl font-extrabold" style={empty ? { color: "#e5484d" } : undefined}>
            {fmt(wallet.balance)}
          </span>
          <span className="text-muted-foreground mb-1 text-sm">credits</span>
        </div>
        <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
          <TrendingUp className="size-3.5" /> {fmt(wallet.totalSpent)} used all-time
        </div>
        {empty && (
          <p className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ color: "#b42318", background: "#fef3f2" }}>
            You&apos;re out of credits. Rani keeps answering for a short grace period — top up to avoid interruption.
          </p>
        )}
        {low && (
          <p className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ color: "#b54708", background: "#fffaeb" }}>
            Running low — {fmt(wallet.balance)} credits left.
          </p>
        )}
      </div>

      {/* Buy */}
      <div className="bg-card rounded-xl border p-5">
        <h2 className="font-display mb-1 font-bold">Buy credits</h2>
        {config.configured && config.packs.length > 0 ? (
          <>
            <p className="text-muted-foreground mb-4 text-sm">Credits never expire. Bigger packs cost less per credit.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {config.packs.map((p) => (
                <div key={p.key} className="flex flex-col rounded-lg border p-4 text-center">
                  <div className="font-display text-xl font-extrabold">{fmt(p.credits)}</div>
                  <div className="text-muted-foreground text-xs">credits</div>
                  <div className="mt-2 text-sm font-semibold">${p.priceUsd}</div>
                  <Button size="sm" className="mt-3" onClick={() => buy(p.key)} disabled={busy !== null}>
                    {busy === p.key ? <Loader2 className="size-4 animate-spin" /> : "Buy"}
                  </Button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            Buying credits isn&apos;t enabled yet. (Set the Stripe env vars to turn it on.)
          </p>
        )}
      </div>

      {/* History */}
      <div className="bg-card rounded-xl border p-5">
        <h2 className="font-display mb-3 font-bold">Recent activity</h2>
        {ledger.length === 0 ? (
          <p className="text-muted-foreground text-sm">No activity yet.</p>
        ) : (
          <ul className="divide-y">
            {ledger.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="capitalize">{r.reason.replace(/_/g, " ")}</span>
                  <span className="text-muted-foreground ml-2 text-xs">{new Date(r.ts).toLocaleDateString()}</span>
                </span>
                <span className="shrink-0 font-medium" style={{ color: r.delta >= 0 ? "#0d9488" : "#8a8f98" }}>
                  {r.delta >= 0 ? "+" : ""}
                  {fmt(r.delta)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isPlatformAdmin && (
        <div className="bg-card rounded-xl border p-5">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium">Enforce credits on this store</span>
              <span className="text-muted-foreground text-xs">
                Admin · grace-then-stop. Only bites when the platform master switch (<code className="bg-muted rounded px-1">CREDITS_ENFORCED</code>) is on and the balance runs past the grace buffer.
              </span>
            </span>
            <Switch checked={enforce} onCheckedChange={toggleEnforce} />
          </label>
        </div>
      )}
    </div>
  );
}
