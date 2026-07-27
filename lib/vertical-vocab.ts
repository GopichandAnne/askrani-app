/**
 * Vertical vocabulary layer. The AI behavior is already business-type-aware
 * (see lib/business-presets.ts); this makes the OWNER CONSOLE speak each
 * vertical's language too — a restaurant manages a "Menu" of "dishes", not a
 * "Catalog" of "products".
 *
 * DEFAULT reproduces today's generic retail wording exactly, so any business
 * type without an override is unchanged. Restaurant is the pilot; add more
 * verticals by dropping another entry into BY_TYPE.
 */
export type Vocab = {
  /** noun for a single catalogue entry, lowercase ("product", "dish"). */
  itemSingular: string;
  /** plural of the above ("products", "dishes"). */
  itemPlural: string;
  /** sidebar label + page title for the catalogue section. */
  catalogNav: string;
  catalogTitle: string;
  /** primary CTAs on the catalogue page. */
  addCta: string;
  importCta: string;
  /** first-run checklist: the "add your catalogue" step. */
  checklistCatalogLabel: string;
  checklistCatalogDesc: string;
};

const DEFAULT: Vocab = {
  itemSingular: "product",
  itemPlural: "products",
  catalogNav: "Catalog",
  catalogTitle: "Catalog",
  addCta: "Add product",
  importCta: "Import catalogue",
  checklistCatalogLabel: "Add your catalogue or knowledge",
  checklistCatalogDesc: "Import a menu, add products, or add a few Q&As.",
};

/** Per-business-type overrides, merged onto DEFAULT. Keys are stores.business_type. */
const BY_TYPE: Record<string, Partial<Vocab>> = {
  restaurant: {
    itemSingular: "dish",
    itemPlural: "dishes",
    catalogNav: "Menu",
    catalogTitle: "Menu",
    addCta: "Add dish",
    importCta: "Import menu",
    checklistCatalogLabel: "Build your menu",
    checklistCatalogDesc: "Import your menu, then tag spice and dietary options.",
  },
};

/** Resolve the console vocabulary for a store's business type. */
export function vocabFor(businessType?: string | null): Vocab {
  const override = businessType ? BY_TYPE[businessType] : undefined;
  return override ? { ...DEFAULT, ...override } : DEFAULT;
}
