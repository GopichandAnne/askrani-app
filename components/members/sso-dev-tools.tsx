"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { testIdentityToken, type TokenTestResult } from "@/app/(app)/members/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Check, Copy, Loader2 } from "lucide-react";

// HMAC signing recipe in several languages — base64url(JSON {email,exp}) + "." +
// HMAC-SHA256-hex with your SSO secret (RANI_SSO_SECRET). Same output every stack.
const SNIPPETS: Record<string, string> = {
  Node: `import crypto from "node:crypto";
// On YOUR server — mint a token for the logged-in user, pass as data-user-token.
function raniUserToken(user) {
  const body = Buffer.from(JSON.stringify({
    email: user.email, name: user.name,
    exp: Math.floor(Date.now() / 1000) + 3600,   // 1 hour
  })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.RANI_SSO_SECRET)
    .update(body).digest("hex");
  return body + "." + sig;
}`,
  Python: `import base64, hmac, hashlib, json, time, os
def rani_user_token(user):
    body = base64.urlsafe_b64encode(json.dumps({
        "email": user["email"], "name": user.get("name"),
        "exp": int(time.time()) + 3600,
    }).encode()).rstrip(b"=").decode()
    sig = hmac.new(os.environ["RANI_SSO_SECRET"].encode(),
                   body.encode(), hashlib.sha256).hexdigest()
    return body + "." + sig`,
  PHP: `<?php
function rani_user_token($user) {
  $body = rtrim(strtr(base64_encode(json_encode([
    "email" => $user["email"], "name" => $user["name"] ?? null,
    "exp" => time() + 3600,
  ])), "+/", "-_"), "=");
  $sig = hash_hmac("sha256", $body, getenv("RANI_SSO_SECRET"));
  return $body . "." . $sig;
}`,
  Ruby: `require "base64"; require "openssl"; require "json"
def rani_user_token(user)
  body = Base64.urlsafe_encode64(JSON.generate(
    email: user[:email], name: user[:name], exp: Time.now.to_i + 3600
  )).delete("=")
  sig = OpenSSL::HMAC.hexdigest("SHA256", ENV["RANI_SSO_SECRET"], body)
  "#{body}.#{sig}"
end`,
  Go: `func raniUserToken(email, name string) string {
    payload, _ := json.Marshal(map[string]any{
        "email": email, "name": name, "exp": time.Now().Unix() + 3600,
    })
    body := base64.RawURLEncoding.EncodeToString(payload)
    m := hmac.New(sha256.New, []byte(os.Getenv("RANI_SSO_SECRET")))
    m.Write([]byte(body))
    return body + "." + hex.EncodeToString(m.Sum(nil))
}`,
};
const LANGS = Object.keys(SNIPPETS);

export function SsoDevTools({ storeId }: { storeId: string }) {
  const [lang, setLang] = useState("Node");
  const [copied, setCopied] = useState(false);
  const [token, setToken] = useState("");
  const [result, setResult] = useState<TokenTestResult | null>(null);
  const [testing, start] = useTransition();

  function copy() {
    navigator.clipboard.writeText(SNIPPETS[lang]);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  function test() {
    start(async () => {
      const res = await testIdentityToken(storeId, token);
      if (res.ok) setResult(res.result);
      else toast.error("Couldn't test", { description: res.error });
    });
  }

  return (
    <div className="space-y-5 rounded-lg border p-4">
      {/* Multi-language signing snippets */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Signing code (shared-secret method)</h3>
        <div className="flex flex-wrap gap-1">
          {LANGS.map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${lang === l ? "bg-teal-deep text-white" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="relative">
          <pre className="bg-muted overflow-x-auto rounded p-3 text-[11px] leading-relaxed">
            <code>{SNIPPETS[lang]}</code>
          </pre>
          <Button size="sm" variant="outline" className="absolute right-2 top-2" onClick={copy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>

      {/* Token tester */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Test a token</h3>
        <p className="text-muted-foreground text-xs">
          Paste a token your server generated (HMAC or JWT) — we&apos;ll check it the way the bot
          will, so you can confirm it&apos;s right before going live.
        </p>
        <Textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste an identity token…"
          className="h-20 font-mono text-[11px]"
        />
        <Button size="sm" onClick={test} disabled={testing || !token.trim()}>
          {testing ? <Loader2 className="size-4 animate-spin" /> : null} Test token
        </Button>
        {result && (
          <div className={`rounded-md border p-3 text-xs ${result.ok ? "border-teal-deep/40 bg-teal-deep/5" : "border-amber-400/50 bg-amber-50 dark:bg-amber-950/20"}`}>
            <p className="mb-1 font-medium">{result.ok ? "✓ Looks good" : "Needs attention"} · {result.kind.toUpperCase()}</p>
            <ul className="space-y-0.5">
              {result.messages.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
