import "server-only";

/** Registered POS providers. Add a new one by writing an adapter + registering it. */
export type PosProviderId = "square" | "clover";

/** Per-store OAuth state, stored as plaintext jsonb in store_provider_credentials
 *  (keyed by provider), behind service-role RLS — same posture as Stripe keys. */
export type PosCreds = {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null; // ISO
  merchant_id: string | null;
  location_id: string | null; // where orders route
  location_name: string | null;
};

/** Tokens returned by an OAuth code-exchange or refresh. */
export type PosTokens = {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  merchant_id: string | null;
};

export type PosLocation = { id: string; name: string; status?: string };

export type OrderForPush = {
  order_id: string;
  currency: string | null;
  items_json: unknown;
  table_label: string | null;
  customer_name: string | null;
};

export type PushResult = { ok: true; externalOrderId: string } | { ok: false; error: string };

/**
 * A POS integration. Everything provider-specific lives behind this interface;
 * credential storage, dispatch, OAuth routes and UI are all generic over it.
 */
export interface PosAdapter {
  id: PosProviderId;
  label: string;
  /** true when the server env for this provider is present. */
  configured(): boolean;
  environment(): "sandbox" | "production";
  /** OAuth authorize URL the owner is redirected to. */
  buildAuthorizeUrl(state: string): string;
  /** Exchange the auth code for tokens. `params` = the full callback query
   *  (some providers, e.g. Clover, return merchant_id there). */
  exchangeCode(code: string, params: URLSearchParams): Promise<PosTokens>;
  refresh(refreshToken: string): Promise<PosTokens>;
  /** Locations orders can route to (a single merchant for providers without a
   *  location concept). */
  listLocations(accessToken: string, creds: PosCreds): Promise<PosLocation[]>;
  /** Push one approved order; return the external order/ticket id. */
  pushOrder(accessToken: string, creds: PosCreds, order: OrderForPush): Promise<PushResult>;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://app.askrani.ai";

/** Generic OAuth callback URL per provider — register this in the provider's app. */
export function posRedirectUrl(provider: PosProviderId): string {
  return `${APP_URL}/api/pos/${provider}/callback`;
}
