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

/**
 * Shared "sells products" vocabulary — for the retail verticals where the plain
 * word "Products" beats the corporate-sounding "Catalog", but no more specific
 * noun (like "dishes" or "books") applies.
 */
const PRODUCTS: Partial<Vocab> = {
  itemSingular: "product",
  itemPlural: "products",
  catalogNav: "Products",
  catalogTitle: "Products",
  addCta: "Add product",
  importCta: "Import products",
  checklistCatalogLabel: "Add your products",
  checklistCatalogDesc: "Import your product list, or add a few Q&As.",
};

/** Per-business-type overrides, merged onto DEFAULT. Keys are stores.business_type. */
const BY_TYPE: Record<string, Partial<Vocab>> = {
  // ── Bespoke: verticals where "products/Catalog" is the wrong word ──
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
  bookstore: {
    itemSingular: "book",
    itemPlural: "books",
    catalogNav: "Books",
    catalogTitle: "Books",
    addCta: "Add book",
    importCta: "Import books",
    checklistCatalogLabel: "Add your books",
    checklistCatalogDesc: "Import your titles, or add a few Q&As.",
  },
  realtor: {
    itemSingular: "listing",
    itemPlural: "listings",
    catalogNav: "Listings",
    catalogTitle: "Listings",
    addCta: "Add listing",
    importCta: "Import listings",
    checklistCatalogLabel: "Add your listings",
    checklistCatalogDesc: "Import your active listings, or add a few Q&As.",
  },
  hospitality: {
    itemSingular: "service",
    itemPlural: "services",
    catalogNav: "Services",
    catalogTitle: "Services & amenities",
    addCta: "Add service",
    importCta: "Import services",
    checklistCatalogLabel: "Add your services & amenities",
    checklistCatalogDesc: "Room service, spa, amenities — or add a few Q&As.",
  },
  rental: {
    itemSingular: "add-on",
    itemPlural: "add-ons",
    catalogNav: "Add-ons",
    catalogTitle: "Add-ons",
    addCta: "Add extra",
    importCta: "Import add-ons",
    checklistCatalogLabel: "Add any paid extras",
    checklistCatalogDesc: "Late checkout, mid-stay clean — or add house-info Q&As.",
  },
  // ── Product retail: "Products" beats "Catalog", with light per-type flavor ──
  grocery: { ...PRODUCTS },
  convenience: { ...PRODUCTS },
  liquor: { ...PRODUCTS },
  hardware: { ...PRODUCTS },
  pet: { ...PRODUCTS },
  nursery: {
    ...PRODUCTS,
    checklistCatalogLabel: "Add your plants & products",
    checklistCatalogDesc: "Import your plants and supplies, or add a few Q&As.",
  },
  wholesale: {
    ...PRODUCTS,
    checklistCatalogLabel: "Add your products",
    checklistCatalogDesc: "Import your product list with case sizes and pricing.",
  },
  // church + "other" keep the neutral DEFAULT ("Catalog") — they rarely use it.
};

/** Resolve the console vocabulary for a store's business type. */
export function vocabFor(businessType?: string | null): Vocab {
  const override = businessType ? BY_TYPE[businessType] : undefined;
  return override ? { ...DEFAULT, ...override } : DEFAULT;
}
