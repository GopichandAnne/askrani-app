import "server-only";
import type { PosAdapter, PosCreds, PosLocation, PosTokens, OrderForPush, PushResult } from "../types";
import { posRedirectUrl } from "../types";
import { toPricedLines, ticketName } from "../lines";

// Clover has separate hosts for OAuth (auth) and REST (api), per environment.
function cfg() {
  const appId = process.env.CLOVER_APP_ID ?? "";
  const appSecret = process.env.CLOVER_APP_SECRET ?? "";
  const environment = process.env.CLOVER_ENVIRONMENT === "production" ? "production" : "sandbox";
  const auth = environment === "production" ? "https://www.clover.com" : "https://sandbox.dev.clover.com";
  const api = environment === "production" ? "https://api.clover.com" : "https://apisandbox.dev.clover.com";
  return { appId, appSecret, environment: environment as "sandbox" | "production", auth, api };
}

/** Clover returns token expirations as epoch SECONDS. */
function isoFromEpochSeconds(v: unknown): string | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

async function tokenCall(path: string, body: Record<string, string>): Promise<PosTokens> {
  const c = cfg();
  const res = await fetch(`${c.auth}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !json.access_token) {
    const detail = (json?.message as string) || (json?.error as string) || `HTTP ${res.status}`;
    throw new Error(`Clover token error: ${detail}`);
  }
  return {
    access_token: String(json.access_token),
    refresh_token: json.refresh_token ? String(json.refresh_token) : null,
    expires_at: isoFromEpochSeconds(json.access_token_expiration),
    merchant_id: json.merchant_id ? String(json.merchant_id) : null,
  };
}

export const cloverAdapter: PosAdapter = {
  id: "clover",
  label: "Clover",
  connectStyle: "oauth",
  configured() {
    const c = cfg();
    return !!c.appId && !!c.appSecret;
  },
  environment() {
    return cfg().environment;
  },
  buildAuthorizeUrl(state) {
    const c = cfg();
    const p = new URLSearchParams({
      client_id: c.appId,
      redirect_uri: posRedirectUrl("clover"),
      state,
    });
    return `${c.auth}/oauth/v2/authorize?${p.toString()}`;
  },
  async exchangeCode(code, params): Promise<PosTokens> {
    const c = cfg();
    const tok = await tokenCall("/oauth/v2/token", {
      client_id: c.appId,
      client_secret: c.appSecret,
      code,
    });
    // Clover returns the merchant id on the callback query, not in the token body.
    return { ...tok, merchant_id: tok.merchant_id ?? params.get("merchant_id") };
  },
  async resolveAccessToken(creds: PosCreds) {
    const soon = Date.now() + 3 * 24 * 60 * 60 * 1000;
    const expMs = creds.expires_at ? Date.parse(creds.expires_at) : 0;
    if (!creds.refresh_token || (expMs && expMs > soon)) return { accessToken: creds.access_token };
    const c = cfg();
    const t = await tokenCall("/oauth/v2/refresh", { client_id: c.appId, refresh_token: creds.refresh_token });
    return {
      accessToken: t.access_token,
      nextCreds: {
        ...creds,
        access_token: t.access_token,
        refresh_token: t.refresh_token || creds.refresh_token,
        expires_at: t.expires_at,
        merchant_id: t.merchant_id ?? creds.merchant_id,
      },
    };
  },
  async listLocations(accessToken, creds: PosCreds): Promise<PosLocation[]> {
    const c = cfg();
    const mId = creds.merchant_id;
    if (!mId) return [];
    // A Clover merchant IS the location; surface it as the single routing target.
    const res = await fetch(`${c.api}/v3/merchants/${mId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = (await res.json().catch(() => ({}))) as { name?: string };
    return [{ id: mId, name: json.name || "Clover merchant", status: "ACTIVE" }];
  },
  async pushOrder(accessToken, creds: PosCreds, order: OrderForPush): Promise<PushResult> {
    const c = cfg();
    const mId = creds.merchant_id;
    if (!mId) return { ok: false, error: "No Clover merchant connected." };
    const lines = toPricedLines(order);
    if (!lines.length) return { ok: false, error: "No priced items to send to Clover." };

    // Clover's Atomic Order API creates the order + line items in one call.
    // Quantity is expanded into repeated line items (Clover unitQty is for
    // weighed goods); fine for restaurant counts.
    const lineItems: Record<string, unknown>[] = [];
    for (const l of lines) {
      for (let i = 0; i < l.quantity; i++) {
        lineItems.push({ name: l.name, price: l.unitCents, ...(l.note ? { note: l.note } : {}) });
      }
    }
    const res = await fetch(`${c.api}/v3/merchants/${mId}/atomic_order/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ orderCart: { title: ticketName(order), note: order.order_id, lineItems } }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      id?: string;
      order?: { id?: string };
      message?: string;
    };
    const id = json.id ?? json.order?.id;
    if (!res.ok || !id) {
      return { ok: false, error: `Clover rejected the order: ${json.message ?? `HTTP ${res.status}`}` };
    }
    return { ok: true, externalOrderId: id };
  },
};
