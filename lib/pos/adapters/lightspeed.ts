import "server-only";
import type { PosAdapter, PosCreds, PosLocation, PosTokens, OrderForPush, PushResult } from "../types";
import { posRedirectUrl } from "../types";
import { toPricedLines } from "../lines";

/**
 * Lightspeed Restaurant (K-Series) adapter.
 *
 * PARTNER-GATED + UNVERIFIED. Lightspeed's API requires a developer/partner
 * account; production access is approved, not self-serve. The OAuth2 auth-code
 * flow below matches the K-Series docs, but the exact OAuth host and the order
 * push have NOT been run.
 *
 * K-Series is more involved than Square/Clover: creating an order
 * (POST /o/op/1/order/local) also needs a numeric businessLocationId, a webhook
 * endpointId, and — for ad-hoc items — an "open item" menu SKU (K-Series line
 * items reference a menu sku, with customItemName/customItemPrice overrides).
 * Those are collected as post-connect config fields (creds.extra). The order
 * endpoint returns {"status":"ok"} with no id, so we track by our order_id
 * (sent as thirdPartyReference). Proper dish→sku menu mapping is the follow-up.
 *
 * Docs: https://api-docs.lsk.lightspeed.app/authentication ·
 * https://api-docs.lsk.lightspeed.app/operation/operation-apelocalorder
 */
const SCOPES = ["orders-api"];

function cfg() {
  const clientId = process.env.LIGHTSPEED_CLIENT_ID ?? "";
  const clientSecret = process.env.LIGHTSPEED_CLIENT_SECRET ?? "";
  const environment = process.env.LIGHTSPEED_ENVIRONMENT === "production" ? "production" : "sandbox";
  const apiHost = process.env.LIGHTSPEED_API_HOST?.replace(/\/$/, "") || "https://api.lsk.lightspeed.app";
  const authHost = process.env.LIGHTSPEED_AUTH_HOST?.replace(/\/$/, "") || apiHost;
  return { clientId, clientSecret, environment: environment as "sandbox" | "production", apiHost, authHost };
}

function parseTokens(json: Record<string, unknown>): PosTokens {
  const expiresAt = json.expires_at
    ? String(json.expires_at)
    : json.expires_in
      ? new Date(Date.now() + Number(json.expires_in) * 1000).toISOString()
      : null;
  return {
    access_token: String(json.access_token ?? ""),
    refresh_token: json.refresh_token ? String(json.refresh_token) : null,
    expires_at: expiresAt,
    merchant_id: null,
  };
}

async function tokenRequest(body: Record<string, string>): Promise<PosTokens> {
  const c = cfg();
  const res = await fetch(`${c.authHost}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...body }).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !json.access_token) {
    throw new Error(`Lightspeed token error: ${(json.error as string) ?? `HTTP ${res.status}`}`);
  }
  return parseTokens(json);
}

export const lightspeedAdapter: PosAdapter = {
  id: "lightspeed",
  label: "Lightspeed",
  connectStyle: "oauth",
  configured() {
    const c = cfg();
    return !!c.clientId && !!c.clientSecret;
  },
  environment() {
    return cfg().environment;
  },
  buildAuthorizeUrl(state) {
    const c = cfg();
    const p = new URLSearchParams({
      response_type: "code",
      client_id: c.clientId,
      redirect_uri: posRedirectUrl("lightspeed"),
      scope: SCOPES.join(" "),
      state,
    });
    return `${c.authHost}/oauth/authorize?${p.toString()}`;
  },
  exchangeCode(code) {
    return tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: posRedirectUrl("lightspeed"),
    });
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
      },
    };
  },

  // Config the owner fills in after connecting (K-Series order requirements).
  manualFields: [
    { key: "business_location_id", label: "Business location ID", required: true, help: "The numeric K-Series location id orders route to." },
    { key: "endpoint_id", label: "Webhook endpoint ID", required: true, help: "The id of the K-Series webhook endpoint (required to place orders)." },
    { key: "open_item_sku", label: "Open item SKU", help: "A menu SKU used for ad-hoc lines (name + price overridden), until dish→SKU mapping is set up." },
  ],

  async listLocations(_accessToken, creds: PosCreds): Promise<PosLocation[]> {
    const id = creds.extra?.business_location_id;
    return id ? [{ id, name: creds.location_name || `Location ${id}`, status: "ACTIVE" }] : [];
  },

  async pushOrder(accessToken, creds: PosCreds, order: OrderForPush, itemMap): Promise<PushResult> {
    const c = cfg();
    const locId = creds.extra?.business_location_id;
    const endpointId = creds.extra?.endpoint_id;
    const openSku = creds.extra?.open_item_sku;
    if (!locId || !endpointId) {
      return { ok: false, error: "Lightspeed needs a business location ID and a webhook endpoint ID (set in the connection)." };
    }
    const lines = toPricedLines(order);
    if (!lines.length) return { ok: false, error: "No priced items to send to Lightspeed." };

    // Mapped lines use the real Lightspeed menu SKU; only UNMAPPED lines need the
    // open-item SKU (with name/price overrides).
    const hasUnmapped = lines.some((l) => !(l.sku && itemMap[l.sku]));
    if (hasUnmapped && !openSku) {
      return { ok: false, error: "Some items aren't mapped to Lightspeed — map them, or set an open-item SKU in the connection." };
    }

    const total = lines.reduce((s, l) => s + (l.unitCents * l.quantity) / 100, 0);
    const body = {
      businessLocationId: Number(locId),
      thirdPartyReference: order.order_id.slice(0, 48),
      endpointId,
      customerInfo: { firstName: (order.customer_name || "Guest").slice(0, 40) },
      payment: { paymentAmount: Number(total.toFixed(2)) },
      items: lines.map((l) => {
        const ext = l.sku ? itemMap[l.sku] : undefined;
        return ext
          ? { sku: ext.slice(0, 25), quantity: l.quantity }
          : {
              sku: openSku!.slice(0, 25),
              quantity: l.quantity,
              customItemName: l.name.slice(0, 100),
              customItemPrice: l.unitCents / 100,
            };
      }),
    };
    const res = await fetch(`${c.apiHost}/o/op/1/order/local`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
    if (!res.ok || json.status !== "ok") {
      return { ok: false, error: `Lightspeed rejected the order: ${json.message ?? `HTTP ${res.status}`}` };
    }
    // K-Series returns no id — track by our reference.
    return { ok: true, externalOrderId: order.order_id };
  },
};
