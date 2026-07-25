// Canonical allergen & dietary vocabularies — the ONE source of truth shared by
// the browse filter, the diner UI and the owner catalogue. Ids are stable and
// lowercase; labels are display-only. Kept in sync with lib/dietary.ts (panel).
//
// Allergens: the EU-14 declarable set, which is a superset of the US "big 9"
// (milk, eggs, fish, crustacean shellfish, tree nuts, peanuts, wheat→gluten,
// soybeans, sesame). "Contains" semantics.
// Dietary: positive claims a diner filters on.

export const ALLERGENS = [
  { id: "gluten", label: "Gluten" },
  { id: "milk", label: "Milk" },
  { id: "eggs", label: "Eggs" },
  { id: "fish", label: "Fish" },
  { id: "crustaceans", label: "Crustaceans" },
  { id: "molluscs", label: "Molluscs" },
  { id: "tree_nuts", label: "Tree nuts" },
  { id: "peanuts", label: "Peanuts" },
  { id: "soy", label: "Soy" },
  { id: "sesame", label: "Sesame" },
  { id: "celery", label: "Celery" },
  { id: "mustard", label: "Mustard" },
  { id: "sulphites", label: "Sulphites" },
  { id: "lupin", label: "Lupin" },
] as const;

export const DIETARY = [
  { id: "vegetarian", label: "Vegetarian" },
  { id: "vegan", label: "Vegan" },
  { id: "gluten_free", label: "Gluten-free" },
  { id: "dairy_free", label: "Dairy-free" },
  { id: "nut_free", label: "Nut-free" },
  { id: "halal", label: "Halal" },
  { id: "kosher", label: "Kosher" },
] as const;

export const ALLERGEN_IDS = ALLERGENS.map((a) => a.id) as readonly string[];
export const DIETARY_IDS = DIETARY.map((d) => d.id) as readonly string[];

export function labelFor(id: string): string {
  const a = ALLERGENS.find((x) => x.id === id);
  if (a) return a.label;
  const d = DIETARY.find((x) => x.id === id);
  return d ? d.label : id;
}

/** Keep only recognised ids (lowercased, de-duped) from arbitrary input. */
function canon(v: unknown, allow: readonly string[]): string[] {
  if (!Array.isArray(v)) return [];
  const set = new Set(allow);
  return [...new Set(v.map((x) => String(x).trim().toLowerCase()).filter((x) => set.has(x)))];
}
export const cleanAllergens = (v: unknown): string[] => canon(v, ALLERGEN_IDS);
export const cleanDietary = (v: unknown): string[] => canon(v, DIETARY_IDS);
