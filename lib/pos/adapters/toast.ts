import "server-only";
import type { PosAdapter, PosCreds, PosLocation, OrderForPush, PushResult } from "../types";
import { toPricedLines } from "../lines";

/**
 * Toast POS adapter.
 *
 * IMPORTANT — Toast is PARTNER-GATED. Unlike Square/Clover there is no self-serve
 * sandbox: you must join the Toast Partner Program, get Standard API Access, and
 * sign an agreement. Until you have partner credentials this adapter is INERT
 * (configured()=false, hidden in the UI) and it is UNVERIFIED — the request
 * shapes below follow Toast's documented API but have not been run.
 *
 * Two things also differ from Square/Clover:
 *  1. Auth is OAuth2 CLIENT-CREDENTIALS (an app-level machine token via
 *     clientId/clientSecret), not a per-restaurant redirect. The token is shared
 *     across restaurants and cached ~24h.
 *  2. A restaurant "connects" by the owner entering their Toast Restaurant GUID
 *     (manual connect) — this becomes the `Toast-Restaurant-External-ID` header.
 *
 * Toast also does not natively take ad-hoc line items: an order references menu
 * item GUIDs. So a real push needs an "open item" menu GUID (price-overridable)
 * and usually a dining-option GUID — both entered at connect time. Proper menu
 * mapping (dish SKU → Toast item GUID) is the follow-up for reliable ordering.
 */

let cachedToken: { token: string; exp: number } | null = null;

function cfg() {
  const clientId = process.env.TOAST_CLIENT_ID ?? "";
  const clientSecret = process.env.TOAST_CLIENT_SECRET ?? "";
  const environment = process.env.TOAST_ENVIRONMENT === "production" ? "production" : "sandbox";
  const host =
    process.env.TOAST_HOSTNAME?.replace(/\/$/, "") ||
    (environment === "production" ? "https://ws-api.toasttab.com" : "https://ws-sandbox-api.toasttab.com");
  return { clientId, clientSecret, environment: environment as "sandbox" | "production", host };
}

export const toastAdapter: PosAdapter = {
  id: "toast",
  label: "Toast",
  connectStyle: "manual",
  configured() {
    const c = cfg();
    return !!c.clientId && !!c.clientSecret;
  },
  environment() {
    return cfg().environment;
  },

  manualFields: [
    { key: "restaurant_guid", label: "Toast Restaurant GUID", required: true, help: "From Toast Web, or provided when you enable the Ask Rani integration." },
    { key: "dining_option_guid", label: "Dining option GUID (optional)", help: "Required by most Toast configs for the order to be accepted." },
    { key: "open_item_guid", label: "Open item GUID (optional)", help: "A price-overridable menu item; needed to send ad-hoc orders until menu mapping is set up." },
  ],

  connectManual(input) {
    const guid = (input.restaurant_guid ?? "").trim();
    if (!guid) return { error: "Toast Restaurant GUID is required." };
    const extra: Record<string, string> = {};
    if (input.dining_option_guid?.trim()) extra.dining_option_guid = input.dining_option_guid.trim();
    if (input.open_item_guid?.trim()) extra.open_item_guid = input.open_item_guid.trim();
    const creds: PosCreds = {
      access_token: "", // Toast token is app-level, fetched on demand
      refresh_token: null,
      expires_at: null,
      merchant_id: guid,
      location_id: guid,
      location_name: "Toast restaurant",
      extra: Object.keys(extra).length ? extra : null,
    };
    return { creds };
  },

  async resolveAccessToken() {
    const c = cfg();
    if (!c.clientId || !c.clientSecret) throw new Error("Toast is not configured on this server.");
    if (cachedToken && cachedToken.exp > Date.now() + 60_000) return { accessToken: cachedToken.token };
    const res = await fetch(`${c.host}/authentication/v1/authentication/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: c.clientId,
        clientSecret: c.clientSecret,
        userAccessType: "TOAST_MACHINE_CLIENT",
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { token?: { accessToken?: string; expiresIn?: number } };
    const token = json.token?.accessToken;
    if (!res.ok || !token) throw new Error("Toast authentication failed.");
    cachedToken = { token, exp: Date.now() + Number(json.token?.expiresIn ?? 3600) * 1000 };
    return { accessToken: token };
  },

  async listLocations(_accessToken, creds: PosCreds): Promise<PosLocation[]> {
    // A partner token maps to one restaurant (by the GUID the owner entered).
    return creds.merchant_id
      ? [{ id: creds.merchant_id, name: creds.location_name || "Toast restaurant", status: "ACTIVE" }]
      : [];
  },

  async pushOrder(accessToken, creds: PosCreds, order: OrderForPush): Promise<PushResult> {
    const c = cfg();
    const restaurantGuid = creds.merchant_id;
    if (!restaurantGuid) return { ok: false, error: "No Toast restaurant connected." };
    const openItemGuid = creds.extra?.open_item_guid;
    if (!openItemGuid) {
      return { ok: false, error: "Toast needs an 'open item' menu GUID to accept ad-hoc orders — add it in the Toast connection." };
    }
    const lines = toPricedLines(order);
    if (!lines.length) return { ok: false, error: "No priced items to send to Toast." };

    const selections = lines.map((l) => ({
      item: { guid: openItemGuid },
      quantity: l.quantity,
      price: l.unitCents / 100, // Toast order money is decimal dollars
      displayName: l.name,
    }));
    const body: Record<string, unknown> = { checks: [{ selections }] };
    if (creds.extra?.dining_option_guid) body.diningOption = { guid: creds.extra.dining_option_guid };

    const res = await fetch(`${c.host}/orders/v2/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Toast-Restaurant-External-ID": restaurantGuid,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      guid?: string;
      message?: string;
      0?: { message?: string };
    };
    const id = json.guid;
    if (!res.ok || !id) {
      const detail = json.message ?? json[0]?.message ?? `HTTP ${res.status}`;
      return { ok: false, error: `Toast rejected the order: ${detail}` };
    }
    return { ok: true, externalOrderId: id };
  },
};
