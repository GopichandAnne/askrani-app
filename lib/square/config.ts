import "server-only";

/**
 * Square integration config, read from env. The owner-facing feature is disabled
 * (shows "not configured") until these are set — we NEVER hardcode the app secret.
 *
 * Required env (set by the operator, never committed):
 *   SQUARE_APPLICATION_ID      — the Square app's Application ID (OAuth client_id)
 *   SQUARE_APPLICATION_SECRET  — the Square app's secret (OAuth client_secret)
 *   SQUARE_ENVIRONMENT         — 'sandbox' (default) | 'production'
 *   SQUARE_REDIRECT_URL        — optional override for the OAuth callback URL
 *
 * We request only ORDERS_WRITE/READ + MERCHANT_PROFILE_READ (for locations) —
 * deliberately NO payment scopes: Rani pushes the ticket, it never processes pay.
 */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://app.askrani.ai";

// Pinned Square API version — bump deliberately after testing a newer one.
export const SQUARE_VERSION = "2025-01-23";

export const SQUARE_SCOPES = ["ORDERS_WRITE", "ORDERS_READ", "MERCHANT_PROFILE_READ"];

export type SquareConfig = {
  configured: boolean;
  appId: string;
  appSecret: string;
  environment: "sandbox" | "production";
  connectBase: string; // OAuth authorize/token host
  apiBase: string; // REST API host (same host as connect for Square)
  redirectUrl: string;
};

export function squareConfig(): SquareConfig {
  const appId = process.env.SQUARE_APPLICATION_ID ?? "";
  const appSecret = process.env.SQUARE_APPLICATION_SECRET ?? "";
  const environment = process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox";
  const host =
    environment === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
  const redirectUrl = process.env.SQUARE_REDIRECT_URL?.replace(/\/$/, "") || `${APP_URL}/api/square/callback`;
  return {
    configured: !!appId && !!appSecret,
    appId,
    appSecret,
    environment,
    connectBase: host,
    apiBase: host,
    redirectUrl,
  };
}
