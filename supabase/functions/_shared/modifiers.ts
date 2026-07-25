// Item modifiers — the shared, authoritative logic. A product carries modifier
// GROUPS (Size, Add-ons, "Remove"…); the client sends the OPTION ids it picked;
// this module validates the selection against the definition and prices it from
// the definition's own deltas (never a client-sent price). Pure + unit-testable.

export type ModifierOption = { id: string; name: string; price_delta?: number | null };
export type ModifierGroup = {
  id: string;
  name: string;
  type?: "single" | "multi";
  required?: boolean;
  min?: number | null;
  max?: number | null;
  options: ModifierOption[];
};
/** What the client sends: which option, in which group. */
export type SelectedRef = { group_id: string; option_id: string };
/** What we store on the cart line / order (denormalized for display + kitchen). */
export type ResolvedModifier = { group: string; option: string; delta: number };

export function parseGroups(raw: unknown): ModifierGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((g) => g && typeof g === "object" && Array.isArray((g as ModifierGroup).options)) as ModifierGroup[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Validate a selection against the groups and price it. Enforces required, min,
 * max and single-choice. Returns resolved modifiers (labels + deltas), the total
 * delta, and a signature that is stable for the same set of options (so the cart
 * merges identical customizations and splits different ones).
 */
export function validateAndPrice(
  groups: ModifierGroup[],
  selected: SelectedRef[],
): { ok: true; resolved: ResolvedModifier[]; delta: number; signature: string } | { ok: false; error: string } {
  const sel = Array.isArray(selected) ? selected : [];
  const resolved: ResolvedModifier[] = [];
  let delta = 0;

  for (const g of groups) {
    const picks = sel.filter((s) => s.group_id === g.id);
    const single = (g.type ?? "single") === "single";
    const required = !!g.required;
    const min = g.min != null ? g.min : required ? 1 : 0;
    const max = g.max != null ? g.max : single ? 1 : g.options.length;

    if (picks.length < min) {
      return { ok: false, error: `Choose ${single ? "an option" : `at least ${min}`} for “${g.name}”.` };
    }
    if (picks.length > max) {
      return { ok: false, error: `Choose at most ${max} for “${g.name}”.` };
    }
    for (const p of picks) {
      const opt = g.options.find((o) => o.id === p.option_id);
      if (!opt) return { ok: false, error: `That option isn't available for “${g.name}”.` };
      const d = num(opt.price_delta);
      delta += d;
      resolved.push({ group: g.name, option: opt.name, delta: d });
    }
  }

  // Reject any selection that referenced a group/option not in the definition.
  for (const s of sel) {
    const g = groups.find((x) => x.id === s.group_id);
    if (!g || !g.options.some((o) => o.id === s.option_id)) {
      return { ok: false, error: "That customization isn't on the menu." };
    }
  }

  const signature = sel.length === 0
    ? ""
    : [...sel]
      .map((s) => `${s.group_id}:${s.option_id}`)
      .sort()
      .join("|");

  return { ok: true, resolved, delta: Math.round((delta + Number.EPSILON) * 100) / 100, signature };
}

/** Human one-liner for a resolved selection — for chat/kitchen display. */
export function describeModifiers(mods: ResolvedModifier[] | null | undefined): string {
  if (!mods || mods.length === 0) return "";
  return mods.map((m) => m.option).join(", ");
}
