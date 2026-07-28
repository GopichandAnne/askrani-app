import "server-only";
import type { PosAdapter, PosCreds, PosLocation, PosCatalogItem, OrderForPush, PushResult } from "../types";
import { toPricedLines } from "../lines";

/**
 * Mock POS — TEST ONLY. Enabled solely when `POS_MOCK` is set, so it never
 * surfaces in a real deployment. It needs no credentials, so it lets you drive
 * the entire connect → approve → dispatch → "Sent to POS" loop (and the
 * failure/retry path) end-to-end in a running app:
 *
 *   POS_MOCK=1 npm run dev
 *   → /diner → connect "Mock POS" → place a diner order → approve it in the panel
 *   → order shows "Sent to Mock POS"  (set mode=fail to exercise the retry block)
 */
function enabled() {
  return process.env.POS_MOCK === "1" || process.env.POS_MOCK === "true";
}

export const mockAdapter: PosAdapter = {
  id: "mock",
  label: "Mock POS",
  connectStyle: "manual",
  configured() {
    return enabled();
  },
  environment() {
    return "sandbox";
  },
  manualFields: [
    { key: "location", label: "Mock location name", help: "Any label — test only." },
    { key: "mode", label: "Mode (ok | fail)", help: "Set to 'fail' to simulate a rejected push (exercises the retry UI)." },
  ],
  connectManual(input) {
    const extra: Record<string, string> = {};
    if (input.mode?.trim()) extra.mode = input.mode.trim();
    const creds: PosCreds = {
      access_token: "mock-token",
      refresh_token: null,
      expires_at: null,
      merchant_id: "mock-merchant",
      location_id: "mock-loc",
      location_name: input.location?.trim() || "Mock location",
      extra: Object.keys(extra).length ? extra : null,
    };
    return { creds };
  },
  async resolveAccessToken(creds: PosCreds) {
    return { accessToken: creds.access_token || "mock-token" };
  },
  async listLocations(_accessToken, creds: PosCreds): Promise<PosLocation[]> {
    return [{ id: creds.location_id || "mock-loc", name: creds.location_name || "Mock location", status: "ACTIVE" }];
  },
  async listCatalog(): Promise<PosCatalogItem[]> {
    // Fake catalog so the menu-mapping picker is exercisable too.
    return [
      { id: "mock-item-1", name: "Mock Item One", price: 9.99 },
      { id: "mock-item-2", name: "Mock Item Two", price: 4.5 },
    ];
  },
  async pushOrder(_accessToken, creds: PosCreds, order: OrderForPush, itemMap): Promise<PushResult> {
    if (creds.extra?.mode === "fail") return { ok: false, error: "Mock POS: simulated failure." };
    const lines = toPricedLines(order);
    if (!lines.length) return { ok: false, error: "No priced items to send." };
    void itemMap; // mapped lines would resolve itemMap[sku]; the mock just echoes an id
    return { ok: true, externalOrderId: `mock_${order.order_id}`.slice(0, 64) };
  },
};
