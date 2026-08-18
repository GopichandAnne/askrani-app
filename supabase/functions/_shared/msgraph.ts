// Microsoft Graph calendar helpers — the Outlook/Microsoft 365 twin of gcal.ts.
// Same shapes (listBusy + createEvent), so the bot's scheduling tools can treat
// Google and Microsoft interchangeably. Tokens come from the OAuth broker vault
// (connections.getAccessToken); this module only takes a live access token.
//
// Graph quirks handled here: read times back in UTC via the `Prefer` header, and
// write event times as UTC wall-clock with timeZone "UTC" (Graph's dateTime must
// NOT carry an offset). Wall-clock ↔ UTC math is shared with gcal (zonedToUtc).

import { zonedToUtc } from "./gcal.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const pad = (n: number) => String(n).padStart(2, "0");

/** Format a Date as UTC wall-clock "YYYY-MM-DDTHH:MM:SS" (no offset), for Graph. */
function utcWall(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export interface Busy { start: Date; end: Date }

interface MEvent { start?: { dateTime?: string }; end?: { dateTime?: string }; showAs?: string; isCancelled?: boolean }

/** Busy intervals on the user's default calendar within [timeMin, timeMax] (ISO). */
export async function listBusy(token: string, timeMinISO: string, timeMaxISO: string): Promise<Busy[]> {
  const url = `${GRAPH}/me/calendarView`
    + `?startDateTime=${encodeURIComponent(timeMinISO)}&endDateTime=${encodeURIComponent(timeMaxISO)}`
    + `&$select=start,end,showAs,isCancelled&$top=100`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, prefer: 'outlook.timezone="UTC"' } });
  if (!res.ok) throw new Error(`calendarView ${res.status}`);
  const j = await res.json();
  const out: Busy[] = [];
  for (const e of (j.value ?? []) as MEvent[]) {
    if (e.isCancelled || e.showAs === "free") continue; // not a real conflict
    const s = e.start?.dateTime, en = e.end?.dateTime;
    // Graph returns UTC (Prefer header) with up to 7 fractional digits — trim + mark Z.
    if (s && en) out.push({ start: new Date(`${s.split(".")[0]}Z`), end: new Date(`${en.split(".")[0]}Z`) });
  }
  return out;
}

export async function createEvent(
  token: string,
  o: { date: string; time: string; durationMin: number; tz: string; summary: string; description?: string; email?: string },
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const [y, mo, d] = o.date.split("-").map(Number);
  const [h, mi] = o.time.split(":").map(Number);
  const startU = zonedToUtc(y, mo, d, h, mi, o.tz);
  const endU = new Date(startU.getTime() + o.durationMin * 60000);
  const body: Record<string, unknown> = {
    subject: o.summary,
    start: { dateTime: utcWall(startU), timeZone: "UTC" },
    end: { dateTime: utcWall(endU), timeZone: "UTC" },
  };
  if (o.description) body.body = { contentType: "text", content: o.description };
  if (o.email) body.attendees = [{ emailAddress: { address: o.email }, type: "required" }];
  const res = await fetch(`${GRAPH}/me/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: `create ${res.status}` };
  const j = await res.json();
  return { ok: true, id: j.id };
}
