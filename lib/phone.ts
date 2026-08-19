// Shared phone-input helpers. A curated dial-code list defaulted to US (+1) so
// owners don't have to type a country code, plus split/combine helpers so a
// stored E.164 number round-trips cleanly through a "code picker + local number"
// UI. Used by the login form, the store WhatsApp number, and responder numbers.

export const DIAL_CODES = [
  { dial: "+1", flag: "🇺🇸", name: "US / Canada" },
  { dial: "+44", flag: "🇬🇧", name: "UK" },
  { dial: "+91", flag: "🇮🇳", name: "India" },
  { dial: "+61", flag: "🇦🇺", name: "Australia" },
  { dial: "+971", flag: "🇦🇪", name: "UAE" },
  { dial: "+52", flag: "🇲🇽", name: "Mexico" },
  { dial: "+63", flag: "🇵🇭", name: "Philippines" },
  { dial: "+65", flag: "🇸🇬", name: "Singapore" },
  { dial: "+49", flag: "🇩🇪", name: "Germany" },
  { dial: "+33", flag: "🇫🇷", name: "France" },
  { dial: "+81", flag: "🇯🇵", name: "Japan" },
  { dial: "+55", flag: "🇧🇷", name: "Brazil" },
] as const;

/**
 * Combine a selected dial code with a locally-typed number into an E.164-ish
 * string. A value the user typed with a leading "+" is honored verbatim (they
 * pasted a full international number), so the picker never double-prefixes.
 */
export function combineDial(dial: string, local: string): string {
  const raw = (local ?? "").trim();
  if (raw.startsWith("+")) return "+" + raw.replace(/\D/g, "");
  const nat = raw.replace(/\D/g, "");
  return nat ? `${dial}${nat}` : "";
}

/**
 * Split a stored E.164 number into { dial, local } for editing. The longest
 * matching dial prefix wins; anything unrecognized falls back to +1 with the
 * remaining digits as the local part.
 */
export function splitDial(full: string | null | undefined): { dial: string; local: string } {
  const e = (full ?? "").trim();
  if (!e) return { dial: "+1", local: "" };
  const digits = "+" + e.replace(/\D/g, "");
  const match = [...DIAL_CODES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((c) => digits.startsWith(c.dial));
  if (match) return { dial: match.dial, local: digits.slice(match.dial.length) };
  return { dial: "+1", local: digits.replace(/^\+/, "") };
}
