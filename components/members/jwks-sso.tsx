"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveJwksSso, type JwksConfig } from "@/app/(app)/members/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ShieldCheck } from "lucide-react";

// Bring-your-own-JWT (JWKS): for customers who already have an auth provider
// (Auth0, Clerk, Firebase, Cognito, their own login). They register the JWKS URL +
// issuer here and pass the JWT they ALREADY mint as data-user-token — no shared
// secret, no signing code. The bot verifies it against their public keys.
export function JwksSso({ storeId, initial }: { storeId: string; initial: JwksConfig }) {
  const [cfg, setCfg] = useState<JwksConfig>(initial);
  const [saving, start] = useTransition();
  const enabled = !!initial.jwksUrl;

  function set<K extends keyof JwksConfig>(k: K, v: string) {
    setCfg((c) => ({ ...c, [k]: v }));
  }
  function save() {
    start(async () => {
      const res = await saveJwksSso(storeId, cfg);
      if (res.ok) toast.success(cfg.jwksUrl ? "JWKS SSO saved" : "JWKS SSO cleared");
      else toast.error("Couldn't save", { description: res.error });
    });
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="text-teal-deep size-4" /> Already have an auth provider? (JWKS)
          {enabled && <span className="text-teal-deep text-xs font-normal">· on</span>}
        </h3>
        <p className="text-muted-foreground mt-1 text-xs">
          If your app already signs users in with Auth0, Clerk, Firebase, Cognito, or your own
          JWTs, you don&apos;t need our secret or any signing code. Point us at your{" "}
          <span className="font-medium">JWKS URL</span>, then pass the token you already mint as{" "}
          <code className="bg-muted rounded px-1">data-user-token</code>. We verify it against your public keys.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">JWKS URL (required)</Label>
          <Input
            value={cfg.jwksUrl}
            onChange={(e) => set("jwksUrl", e.target.value)}
            placeholder="https://your-tenant.auth0.com/.well-known/jwks.json"
            className="font-mono text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Issuer (iss) — recommended</Label>
          <Input value={cfg.issuer} onChange={(e) => set("issuer", e.target.value)} placeholder="https://your-tenant.auth0.com/" className="font-mono text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Audience (aud) — optional</Label>
          <Input value={cfg.audience} onChange={(e) => set("audience", e.target.value)} placeholder="your-api-identifier" className="font-mono text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Email claim</Label>
          <Input value={cfg.emailClaim} onChange={(e) => set("emailClaim", e.target.value)} placeholder="email" className="font-mono text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Name claim</Label>
          <Input value={cfg.nameClaim} onChange={(e) => set("nameClaim", e.target.value)} placeholder="name" className="font-mono text-sm" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          {cfg.jwksUrl ? "Save JWKS SSO" : "Clear"}
        </Button>
        <p className="text-muted-foreground text-xs">
          Supports RS256 / ES256. Leave the URL blank to turn this off and use the shared‑secret method above.
        </p>
      </div>
    </div>
  );
}
