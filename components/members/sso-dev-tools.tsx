"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { smokeTestSso, type LiveVerdict, type TokenTestResult } from "@/app/(app)/members/actions";
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
  const [res, setRes] = useState<{ verdict: LiveVerdict; detail: TokenTestResult | null; curl: string } | null>(null);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [testing, start] = useTransition();

  function copy() {
    navigator.clipboard.writeText(SNIPPETS[lang]);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  function test() {
    start(async () => {
      const r = await smokeTestSso(storeId, token);
      if (r.ok) setRes({ verdict: r.verdict, detail: r.detail, curl: r.curl });
      else toast.error("Couldn't run the check", { description: r.error });
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

      {/* Live smoke test */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Validate a token (live check)</h3>
        <p className="text-muted-foreground text-xs">
          Paste a token your server generated (HMAC or JWT). We send it to the{" "}
          <span className="font-medium">live assistant</span> — the exact check every chat runs —
          and tell you whether it&apos;s accepted and who it resolves to. No message is sent.
        </p>
        <Textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste an identity token…"
          className="h-20 font-mono text-[11px]"
        />
        <Button size="sm" onClick={test} disabled={testing || !token.trim()}>
          {testing ? <Loader2 className="size-4 animate-spin" /> : null} Run live check
        </Button>

        {res && (
          <div className="space-y-2">
            <div className={`rounded-md border p-3 text-xs ${res.verdict.recognized ? "border-teal-deep/40 bg-teal-deep/5" : "border-amber-400/50 bg-amber-50 dark:bg-amber-950/20"}`}>
              {res.verdict.recognized ? (
                <p className="font-medium">
                  ✓ Accepted — the assistant will recognize this visitor as{" "}
                  <span className="text-teal-deep">{res.verdict.recognizedAs}</span>
                  {res.verdict.name ? ` (${res.verdict.name})` : ""}
                  {res.verdict.method ? ` · via ${res.verdict.method.toUpperCase()}` : ""}
                </p>
              ) : (
                <p className="font-medium">✗ Not accepted{res.verdict.method ? ` (${res.verdict.method.toUpperCase()})` : ""} — {res.verdict.reason || "token rejected."}</p>
              )}
            </div>
            {res.detail && !res.verdict.recognized && (
              <ul className="text-muted-foreground space-y-0.5 text-xs">
                {res.detail.messages.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            )}
          </div>
        )}

        <details className="group">
          <summary className="text-teal-deep hover:text-teal-deep/80 cursor-pointer select-none text-xs font-medium">
            Run the same check from your CI (curl)
          </summary>
          {res?.curl && (
            <div className="relative mt-2">
              <pre className="bg-muted overflow-x-auto rounded p-3 text-[11px] leading-relaxed"><code>{res.curl}</code></pre>
              <Button
                size="sm" variant="outline" className="absolute right-2 top-2"
                onClick={() => { navigator.clipboard.writeText(res.curl); setCopiedCurl(true); setTimeout(() => setCopiedCurl(false), 1500); }}
              >
                {copiedCurl ? <Check className="size-4" /> : <Copy className="size-4" />}{copiedCurl ? "Copied" : "Copy"}
              </Button>
            </div>
          )}
          {!res?.curl && <p className="text-muted-foreground mt-2 text-xs">Run a live check once and the exact curl command (with your endpoint + key) appears here.</p>}
        </details>
      </div>
    </div>
  );
}
