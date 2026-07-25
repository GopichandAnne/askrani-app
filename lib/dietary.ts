// Canonical allergen & dietary vocabularies for the panel UI.
// MUST stay in sync with supabase/functions/_shared/dietary.ts (edge functions).

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

export const ALLERGEN_IDS: readonly string[] = ALLERGENS.map((a) => a.id);
export const DIETARY_IDS: readonly string[] = DIETARY.map((d) => d.id);

export function labelFor(id: string): string {
  return (
    ALLERGENS.find((x) => x.id === id)?.label ??
    DIETARY.find((x) => x.id === id)?.label ??
    id
  );
}

function canon(v: unknown, allow: readonly string[]): string[] {
  if (!Array.isArray(v)) return [];
  const set = new Set(allow);
  return [...new Set(v.map((x) => String(x).trim().toLowerCase()).filter((x) => set.has(x)))];
}
export const cleanAllergens = (v: unknown): string[] => canon(v, ALLERGEN_IDS);
export const cleanDietary = (v: unknown): string[] => canon(v, DIETARY_IDS);
