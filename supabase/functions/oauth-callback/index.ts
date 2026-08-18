// oauth-callback — where every provider redirects the owner's browser back after
// they authorize. This is the registered redirect URI for Google/Square/HubSpot.
//
// verify_jwt=false — there's no user JWT on a provider redirect; security is the
// HMAC-signed `state` we minted in oauth-start (carries store + provider + a
// 10-min expiry). We verify it, exchange the code for tokens (using the provider
// client secret), encrypt + store them in the vault, then bounce the browser back
// to the panel. Tokens are never logged or returned to the browser.

import { serviceClient } from "../_shared/supabase.ts";
import {
  PROVIDERS, providerClient, verifyState, exchangeCode, testCall, saveConnection, panelUrl, type ProviderId,
} from "../_shared/connections.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

function bounce(params: string): Response {
  return new Response(null, { status: 302, headers: { Location: `${panelUrl()}/connections?${params}` } });
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return new Response("GET only", { status: 405 });
  const url = new URL(req.url);

  // The provider can report a denial/error directly.
  const provErr = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";

  const parsed = await verifyState(state);
  if (!parsed) return bounce("error=expired"); // forged/expired state — never trust it
  const provider = parsed.prov as ProviderId;

  if (provErr || !code) return bounce(`error=denied&provider=${provider}`);

  const client = providerClient(provider);
  if (!client) return bounce(`error=unconfigured&provider=${provider}`);

  try {
    const tokens = await exchangeCode(provider, code, client.clientId, client.clientSecret);
    if (!tokens.accessToken) return bounce(`error=notoken&provider=${provider}`);

    // Prove the token works + get a human label (email / merchant / portal).
    const t = await testCall(provider, tokens.accessToken);

    const db: Db = serviceClient();
    await saveConnection(db, parsed.sid, provider, tokens, t.label, parsed.uid);
    return bounce(`connected=${provider}${t.label ? `&label=${encodeURIComponent(t.label)}` : ""}`);
  } catch (e) {
    console.error(`[oauth-callback] ${PROVIDERS[provider].label}: ${e instanceof Error ? e.message : e}`);
    return bounce(`error=exchange&provider=${provider}`);
  }
});
