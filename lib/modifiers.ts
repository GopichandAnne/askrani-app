// Modifier definitions for the owner editor (panel side). MUST match the shape the
// diner/cart price against — supabase/functions/_shared/modifiers.ts. cleanModifiers
// is the gate: whatever the owner builds in the UI is sanitized to this canonical,
// storable shape before it hits the products.modifiers jsonb column.

export type ModifierOption = { id: string; name: string; price_delta: number };
export type ModifierGroup = {
  id: string;
  name: string;
  type: "single" | "multi";
  required: boolean;
  max?: number | null;
  options: ModifierOption[];
};

/** Stable-ish local id for a new group/option (client-generated as the owner builds). */
export function newId(prefix: "g" | "o"): string {
  const rnd = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rnd}`;
}

function numDelta(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Coerce arbitrary input into the canonical modifier shape:
 *  - drops groups with no name or no valid options, and nameless options,
 *  - assigns ids where missing, coerces type/required/deltas,
 *  - keeps `max` only for multi groups.
 */
export function cleanModifiers(raw: unknown): ModifierGroup[] {
  if (!Array.isArray(raw)) return [];
  const groups: ModifierGroup[] = [];
  for (const g of raw) {
    if (!g || typeof g !== "object") continue;
    const gr = g as Record<string, unknown>;
    const name = String(gr.name ?? "").trim();
    const rawOpts = Array.isArray(gr.options) ? gr.options : [];
    const options: ModifierOption[] = [];
    for (const o of rawOpts) {
      if (!o || typeof o !== "object") continue;
      const or = o as Record<string, unknown>;
      const on = String(or.name ?? "").trim();
      if (!on) continue;
      options.push({ id: String(or.id || newId("o")), name: on.slice(0, 60), price_delta: numDelta(or.price_delta) });
    }
    if (!name || options.length === 0) continue;
    const type = gr.type === "multi" ? "multi" : "single";
    const required = !!gr.required;
    const maxRaw = gr.max;
    const max = type === "multi" && maxRaw != null && Number.isFinite(Number(maxRaw))
      ? Math.max(1, Math.min(options.length, Math.floor(Number(maxRaw))))
      : null;
    groups.push({
      id: String(gr.id || newId("g")),
      name: name.slice(0, 60),
      type,
      required,
      ...(max != null ? { max } : {}),
      options,
    });
  }
  return groups;
}
