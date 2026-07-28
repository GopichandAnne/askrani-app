import "server-only";

/** Registered POS providers. Add a new one by writing an adapter + registering it. */
export type PosProviderId = "square" | "clover" | "toast";

/** Per-store OAuth state, stored as plaintext jsonb in store_provider_credentials
 *  (keyed by provider), behind service-role RLS — same posture as Stripe keys. */
export type PosCreds = {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null; // ISO
  merchant_id: string | null;
  location_id: string | null; // where orders route
  location_name: string | null;
  /** Provider-specific bits that don't fit the common shape (e.g. Toast's
   *  dining-option / open-item GUIDs). */
  extra?: Record<string, string> | null;
};

/** A field the owner types to connect a "manual" provider (e.g. Toast GUID). */
export type PosManualField = { key: string; label: string; help?: string; required?: boolean };

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
  /** How the owner connects: "oauth" = redirect flow (Square, Clover);
   *  "manual" = the owner enters credentials (Toast: a Restaurant GUID). */
  connectStyle: "oauth" | "manual";
  /** true when the server env for this provider is present. */
  configured(): boolean;
  environment(): "sandbox" | "production";

  // ── OAuth-style providers ──
  /** OAuth authorize URL the owner is redirected to. */
  buildAuthorizeUrl?(state: string): string;
  /** Exchange the auth code for tokens. `params` = the full callback query
   *  (some providers, e.g. Clover, return merchant_id there). */
  exchangeCode?(code: string, params: URLSearchParams): Promise<PosTokens>;

  // ── Manual-style providers ──
  /** Fields the owner fills in to connect. */
  manualFields?: PosManualField[];
  /** Validate the owner's input into stored creds (no I/O; caller persists). */
  connectManual?(input: Record<string, string>): { creds: PosCreds } | { error: string };

  /** Return a usable access token, refreshing/logging-in as the provider needs.
   *  `nextCreds` (if returned) is persisted by the caller. */
  resolveAccessToken(creds: PosCreds): Promise<{ accessToken: string; nextCreds?: PosCreds | null }>;

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
