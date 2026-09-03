"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  deleteIdentityProvider,
  listIdentityProviders,
  saveIdentityProvider,
  type IdentityProviderInput,
} from "@/app/(app)/link/identity-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { KeyRound, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";

const BLANK: IdentityProviderInput = {
  type: "jwks", label: "", jwks_url: "", issuer: "", audience: "",
  email_claim: "", name_claim: "", secret: "", allowed_domains: "", auto_admit: true, default_role: "",
};

function genSecret(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return "sso_" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function IdentityProviders({ storeId }: { storeId: string }) {
  const [providers, setProviders] = useState<IdentityProviderInput[] | null>(null);
  const [draft, setDraft] = useState<IdentityProviderInput | null>(null);
  const [saving, startSave] = useTransition();

  async function load() {
    const res = await listIdentityProviders(storeId);
    if (res.ok) setProviders(res.providers);
    else toast.error("Couldn't load identity", { description: res.error });
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [storeId]);

  function set<K extends keyof IdentityProviderInput>(k: K, v: IdentityProviderInput[K]) {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  }
  function save() {
    if (!draft) return;
    startSave(async () => {
      const res = await saveIdentityProvider(storeId, draft);
      if (res.ok) { toast.success("Identity provider saved"); setDraft(null); load(); }
      else toast.error("Couldn't save", { description: res.error });
    });
  }
  async function remove(id?: string) {
    if (!id) return;
    const res = await deleteIdentityProvider(storeId, id);
    if (res.ok) { toast.success("Removed"); load(); }
    else toast.error("Couldn't remove", { description: res.error });
  }

  return (
    <div className="bg-card space-y-4 rounded-lg border p-5">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold"><ShieldCheck className="text-teal-deep size-4" /> Identity providers</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          How people sign in — used by every front door. Register your auth provider once and
          anyone it authenticates is recognized and admitted automatically; no roster to import.
        </p>
      </div>

      {/* Existing providers */}
      <div className="space-y-2">
        {providers === null && <p className="text-muted-foreground text-sm">Loading…</p>}
        {providers?.length === 0 && !draft && (
          <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
            No identity providers yet — visitors are anonymous. Add one to recognize signed-in users.
          </p>
        )}
        {providers?.map((p) => (
          <div key={p.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                {p.type === "jwks" ? <ShieldCheck className="size-4" /> : <KeyRound className="size-4" />}
                {p.label || (p.type === "jwks" ? "JWKS provider" : "Shared secret")}
                {p.auto_admit && <span className="text-teal-deep text-xs font-normal">· auto-admit</span>}
              </div>
              <div className="text-muted-foreground mt-0.5 truncate font-mono text-xs">
                {p.type === "jwks" ? p.jwks_url : "HMAC shared secret"}
                {p.allowed_domains ? ` · @${p.allowed_domains}` : ""}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="ghost" onClick={() => setDraft(p)}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => remove(p.id)} aria-label="Remove"><Trash2 className="size-4" /></Button>
            </div>
          </div>
        ))}
      </div>

      {!draft && (
        <Button size="sm" variant="outline" onClick={() => setDraft({ ...BLANK })}><Plus className="size-4" /> Add a provider</Button>
      )}

      {/* Add / edit form */}
      {draft && (
        <div className="space-y-4 rounded-lg border p-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Method</Label>
            <div className="flex gap-1">
              {[["jwks", "Existing auth (JWKS)"], ["secret", "Shared secret"]].map(([v, l]) => (
                <button key={v} onClick={() => set("type", v)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium ${draft.type === v ? "bg-teal-deep text-white" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {draft.type === "jwks" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">JWKS URL</Label>
                <Input value={draft.jwks_url} onChange={(e) => set("jwks_url", e.target.value)} placeholder="https://your-tenant.auth0.com/.well-known/jwks.json" className="font-mono text-sm" />
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Issuer (iss)</Label><Input value={draft.issuer} onChange={(e) => set("issuer", e.target.value)} placeholder="https://your-tenant.auth0.com/" className="font-mono text-sm" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Audience (aud) — optional</Label><Input value={draft.audience} onChange={(e) => set("audience", e.target.value)} className="font-mono text-sm" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Email claim</Label><Input value={draft.email_claim} onChange={(e) => set("email_claim", e.target.value)} placeholder="email" className="font-mono text-sm" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Name claim</Label><Input value={draft.name_claim} onChange={(e) => set("name_claim", e.target.value)} placeholder="name" className="font-mono text-sm" /></div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs">Shared secret</Label>
              <div className="flex gap-2">
                <Input value={draft.secret} onChange={(e) => set("secret", e.target.value)} placeholder="Generate a secret…" className="font-mono text-sm" />
                <Button size="sm" variant="outline" type="button" onClick={() => set("secret", genSecret())}>Generate</Button>
              </div>
              <p className="text-muted-foreground text-xs">Put this in your server env as <code className="bg-muted rounded px-1">RANI_SSO_SECRET</code> and sign each user&apos;s token with it. Keep it server-side.</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label className="text-xs">Label (optional)</Label><Input value={draft.label} onChange={(e) => set("label", e.target.value)} placeholder="Acme SSO" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Allowed email domains — optional</Label><Input value={draft.allowed_domains} onChange={(e) => set("allowed_domains", e.target.value)} placeholder="acme.com, acme.co.uk" className="font-mono text-sm" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Default role</Label><Input value={draft.default_role} onChange={(e) => set("default_role", e.target.value)} placeholder="member" /></div>
            <div className="flex items-end justify-between gap-3 rounded-md border p-3">
              <div><Label className="text-sm font-medium">Auto-admit</Label><p className="text-muted-foreground text-xs">Anyone this provider verifies becomes a member. Off = must already be on the roster.</p></div>
              <Switch checked={draft.auto_admit} onCheckedChange={(v) => set("auto_admit", v)} />
            </div>
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : null} Save provider</Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
