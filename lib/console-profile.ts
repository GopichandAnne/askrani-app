/**
 * Console profile — reshapes the operator panel to fit the account's use.
 *
 * A "local" business (shop, restaurant, clinic) and a "saas"/product team that
 * embeds Rani on their own site want very different control panels. This is the
 * one place that decides which profile a store is, derived from its free-text
 * `stores.business_type`. Nav items opt into profiles via `NavItem.profiles`.
 */

export type ConsoleProfile = "local" | "saas";

/** Business types that get the SaaS/product console. */
const SAAS_TYPES = new Set(["saas", "product", "software"]);

export function profileFor(businessType?: string | null): ConsoleProfile {
  return businessType && SAAS_TYPES.has(businessType.toLowerCase()) ? "saas" : "local";
}

/** The home surface for a profile (Orders is hidden for SaaS). */
export function homeHrefFor(profile: ConsoleProfile): string {
  return profile === "saas" ? "/conversations" : "/orders";
}
