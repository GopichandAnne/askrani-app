import "server-only";
import type { PosAdapter, PosCreds, PosLocation, PosTokens, OrderForPush, PushResult } from "../types";
import { posRedirectUrl } from "../types";
import { toPricedLines, ticketName } from "../lines";

// Pinned Square API version — bump deliberately after testing a newer one.
const VERSION = "2025-01-23";
const SCOPES = ["ORDERS_WRITE", "ORDERS_READ", "MERCHANT_PROFILE_READ"];

function cfg() {
  const appId = process.env.SQUARE_APPLICATION_ID ?? "";
  const appSecret = process.env.SQUARE_APPLICATION_SECRET ?? "";
  const environment = process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox";
  const host =
    environment === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
  return { appId, appSecret, environment: environment as "sandbox" | "production", host };
}

async function tokenRequest(body: Record<string, string>): Promise<PosTokens> {
  const c = cfg();
  const res = await fetch(`${c.host}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Square-Version": VERSION },
    body: JSON.stringify({ client_id: c.appId, client_secret: c.appSecret, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail = (json?.errors as { detail?: string }[] | undefined)?.[0]?.detail;
    throw new Error(`Square token error (${res.status}): ${detail ?? "unknown"}`);
  }
  return {
    access_token: String(json.access_token ?? ""),
    refresh_token: json.refresh_token ? String(json.refresh_token) : null,
    expires_at: json.expires_at ? String(json.expires_at) : null,
    merchant_id: json.merchant_id ? String(json.merchant_id) : null,
  };
}

export const squareAdapter: PosAdapter = {
  id: "square",
  label: "Square",
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
      scope: SCOPES.join(" "),
      session: "false",
      state,
    });
    return `${c.host}/oauth2/authorize?${p.toString()}`;
  },
  exchangeCode(code) {
    return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: posRedirectUrl("square") });
  },
  async resolveAccessToken(creds: PosCreds) {
    const soon = Date.now() + 3 * 24 * 60 * 60 * 1000;
    const expMs = creds.expires_at ? Date.parse(creds.expires_at) : 0;
    if (!creds.refresh_token || (expMs && expMs > soon)) return { accessToken: creds.access_token };
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: creds.refresh_token });
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
  async listLocations(accessToken): Promise<PosLocation[]> {
    const c = cfg();
    const res = await fetch(`${c.host}/v2/locations`, {
      headers: { Authorization: `Bearer ${accessToken}`, "Square-Version": VERSION },
    });
    const json = (await res.json().catch(() => ({}))) as {
      locations?: { id: string; name: string; status: string }[];
    };
    if (!res.ok) return [];
    return (json.locations ?? []).map((l) => ({ id: l.id, name: l.name, status: l.status }));
  },
  async pushOrder(accessToken, creds: PosCreds, order: OrderForPush): Promise<PushResult> {
    const c = cfg();
    if (!creds.location_id) return { ok: false, error: "No Square location selected." };
    const currency = (order.currency ?? "USD").toUpperCase();
    const lines = toPricedLines(order);
    if (!lines.length) return { ok: false, error: "No priced items to send to Square." };

    const body = {
      idempotency_key: order.order_id.slice(0, 192),
      order: {
        location_id: creds.location_id,
        reference_id: order.order_id.slice(0, 40),
        ticket_name: ticketName(order),
        source: { name: "Ask Rani" },
        line_items: lines.map((l) => ({
          name: l.name,
          quantity: String(l.quantity),
          base_price_money: { amount: l.unitCents, currency },
          ...(l.note ? { note: l.note } : {}),
        })),
      },
    };
    const res = await fetch(`${c.host}/v2/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Square-Version": VERSION,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      order?: { id?: string };
      errors?: { detail?: string }[];
    };
    if (!res.ok || !json.order?.id) {
      return { ok: false, error: `Square rejected the order: ${json.errors?.[0]?.detail ?? `HTTP ${res.status}`}` };
    }
    return { ok: true, externalOrderId: json.order.id };
  },
};
