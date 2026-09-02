"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

// The guided "signed-in users" half of Embed & install. Anonymous embed is the
// snippet above; this orients the customer to the right SSO method and links to
// Members, where the secret / JWKS config / signing snippets / token tester live.
type Method = "jwks" | "secret" | "endpoint";

const METHODS: { id: Method; title: string; when: string }[] = [
  { id: "jwks", title: "I already have login (Auth0, Clerk, Firebase, Cognito, our own JWT)", when: "Easiest — no shared secret, no signing code. Pass the JWT you already issue." },
  { id: "secret", title: "We have a custom login and can add a little server code", when: "Sign a short token per user with your Rani secret." },
  { id: "endpoint", title: "We'd rather not put a token in every page", when: "Expose one endpoint that returns the current user's token; the embed fetches it." },
];

function Snippet({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="bg-muted overflow-x-auto rounded p-3 text-[11px] leading-relaxed"><code>{code}</code></pre>
      <Button
        size="sm" variant="outline" className="absolute right-2 top-2"
        onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function SignedInEmbedGuide({ pubKey }: { pubKey: string | null }) {
  const [method, setMethod] = useState<Method | null>(null);
  const k = pubKey || "pk_live_…";

  return (
    <div className="bg-card space-y-4 rounded-lg border p-5">
      <div>
        <h2 className="text-base font-semibold">Signed-in users (optional)</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          The snippet above works for anonymous visitors. If your users log in and you want Rani to
          know who they are — greet them, unlock members-only answers, or act in your systems{" "}
          <em>as that user</em> — forward their identity. Pick what fits your setup:
        </p>
      </div>

      <div className="space-y-2">
        {METHODS.map((m) => (
          <button
            key={m.id}
            onClick={() => setMethod(method === m.id ? null : m.id)}
            className={`w-full rounded-lg border p-3 text-left transition ${method === m.id ? "border-teal-deep bg-teal-deep/5" : "hover:border-teal-deep/40"}`}
          >
            <div className="text-sm font-medium">{m.title}</div>
            <div className="text-muted-foreground text-xs">{m.when}</div>
          </button>
        ))}
      </div>

      {method === "jwks" && (
        <div className="space-y-2 text-sm">
          <p className="font-medium">Bring your own JWT (JWKS)</p>
          <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-xs">
            <li>In <Link href="/members" className="text-teal-deep hover:underline">Members &amp; access</Link>, open <span className="font-medium">“Already have an auth provider? (JWKS)”</span> and paste your JWKS URL + issuer.</li>
            <li>Pass the JWT your provider already mints for the logged-in user as <code className="bg-muted rounded px-1">data-user-token</code>. We verify it against your public keys — no shared secret, no signing code.</li>
          </ol>
          <Snippet code={`<script src="https://app.askrani.ai/embed.js"\n  data-key="${k}"\n  data-user-token="<the JWT you already issue>"\n  async></script>`} />
        </div>
      )}

      {method === "secret" && (
        <div className="space-y-2 text-sm">
          <p className="font-medium">Shared secret + a signing snippet</p>
          <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-xs">
            <li>In <Link href="/members" className="text-teal-deep hover:underline">Members &amp; access</Link>, click <span className="font-medium">“Set up embedded SSO”</span> to get your secret.</li>
            <li>Copy the signing code (Node/Python/PHP/Ruby/Go are all there) and mint a token per logged-in user on your server.</li>
            <li>Pass it as <code className="bg-muted rounded px-1">data-user-token</code>. Use the <span className="font-medium">token tester</span> on that page to confirm before going live.</li>
          </ol>
          <Snippet code={`<script src="https://app.askrani.ai/embed.js"\n  data-key="${k}"\n  data-user-token="<raniUserToken(user)>"\n  async></script>`} />
        </div>
      )}

      {method === "endpoint" && (
        <div className="space-y-2 text-sm">
          <p className="font-medium">Token endpoint</p>
          <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-xs">
            <li>Set up either method above (shared secret or JWKS) so you can produce a token.</li>
            <li>Expose one endpoint on your site (behind your login) that returns the current user&apos;s token — raw text or <code className="bg-muted rounded px-1">{'{ "token": "…" }'}</code>.</li>
            <li>Point the embed at it with <code className="bg-muted rounded px-1">data-token-url</code>. We fetch it with your cookies the first time the chat opens.</li>
          </ol>
          <Snippet code={`<script src="https://app.askrani.ai/embed.js"\n  data-key="${k}"\n  data-token-url="/api/rani-token"\n  async></script>`} />
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        Changing which AI model answers (Agent → Model) never affects your embed — the snippet stays the same.
      </p>
    </div>
  );
}
