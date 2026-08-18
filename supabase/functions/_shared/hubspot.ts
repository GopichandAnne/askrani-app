// HubSpot helpers for the bot's CRM tools. Takes a live access token (from the
// OAuth broker vault). Look up a contact by email, and save a captured lead
// (create-or-return the contact).

const HS = "https://api.hubapi.com";

function headers(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

export interface HsContact { id: string; name: string | null; company: string | null; stage: string | null }

export async function findContact(token: string, email: string): Promise<HsContact | null> {
  const res = await fetch(`${HS}/crm/v3/objects/contacts/search`, {
    method: "POST", headers: headers(token),
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
      properties: ["firstname", "lastname", "company", "lifecyclestage", "phone"],
      limit: 1,
    }),
  });
  if (!res.ok) return null;
  // deno-lint-ignore no-explicit-any
  const j: any = await res.json();
  const c = (j.results ?? [])[0];
  if (!c) return null;
  const p = c.properties ?? {};
  const name = [p.firstname, p.lastname].filter(Boolean).join(" ") || null;
  return { id: String(c.id), name, company: p.company ?? null, stage: p.lifecyclestage ?? null };
}

/** Create a contact (or return the existing one if the email is already there). */
export async function createLead(
  token: string, o: { email: string; firstname?: string; lastname?: string; phone?: string },
): Promise<{ ok: boolean; existing: boolean; id: string | null }> {
  const properties: Record<string, string> = { email: o.email };
  if (o.firstname) properties.firstname = o.firstname;
  if (o.lastname) properties.lastname = o.lastname;
  if (o.phone) properties.phone = o.phone;

  const res = await fetch(`${HS}/crm/v3/objects/contacts`, {
    method: "POST", headers: headers(token), body: JSON.stringify({ properties }),
  });
  if (res.status === 409) { // already a contact — return it
    const ex = await findContact(token, o.email);
    return { ok: true, existing: true, id: ex?.id ?? null };
  }
  if (!res.ok) return { ok: false, existing: false, id: null };
  // deno-lint-ignore no-explicit-any
  const j: any = await res.json();
  return { ok: true, existing: false, id: String(j.id ?? "") || null };
}
