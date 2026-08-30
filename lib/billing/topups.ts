/**
 * Credit top-up catalog (pay-as-you-go). Same Stripe account + products +
 * prices as Ask Rani Insights — set the same STRIPE_PRICE_TOPUP_* env values.
 * Dormant until STRIPE_SECRET_KEY is set; a pack is buyable only once its price
 * id is configured. The client never passes a Stripe price id — only a `key`.
 */
export interface TopupPack {
  key: string;
  priceEnv: string;
  credits: number;
  label: string;
  priceUsd: number;
}

export const TOPUP_PACKS: TopupPack[] = [
  { key: "topup_500", priceEnv: "STRIPE_PRICE_TOPUP_500", credits: 500, label: "500 credits", priceUsd: 29 },
  { key: "topup_1500", priceEnv: "STRIPE_PRICE_TOPUP_1500", credits: 1500, label: "1,500 credits", priceUsd: 75 },
  { key: "topup_5000", priceEnv: "STRIPE_PRICE_TOPUP_5000", credits: 5000, label: "5,000 credits", priceUsd: 199 },
];

export function isBillingConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function packByKey(key: string): TopupPack | undefined {
  return TOPUP_PACKS.find((p) => p.key === key);
}

export function priceIdFor(pack: TopupPack): string | undefined {
  return process.env[pack.priceEnv];
}

/** Resolve a pack from a Stripe price id (for dashboard Payment Links that arrive
 *  without our metadata). The price id is the stable join. */
export function packByPriceId(priceId: string): TopupPack | undefined {
  return TOPUP_PACKS.find((p) => process.env[p.priceEnv] === priceId);
}

/** Only the packs whose price id is actually configured are buyable. */
export function availablePacks(): TopupPack[] {
  return TOPUP_PACKS.filter((p) => !!process.env[p.priceEnv]);
}
