// Google Calendar helpers for the bot's scheduling tools. Reads availability and
// books appointments on a store's connected Google account (tokens come from the
// OAuth broker vault via connections.getAccessToken — this module only takes a
// live access token). All wall-clock times are handled in the store's IANA
// timezone; the Google API is spoken in UTC instants.

const CAL_BASE = "https://www.googleapis.com/calendar/v3";
const pad = (n: number) => String(n).padStart(2, "0");

/** Offset (minutes) of an IANA timezone at a given instant. */
function tzOffset(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUTC - date.getTime()) / 60000;
}

/** The UTC instant of a local wall-clock time (y,mo,d,h,mi) in `tz`. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return new Date(guess.getTime() - tzOffset(guess, tz) * 60000);
}

interface GEvent { start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }
export interface Busy { start: Date; end: Date }

/** Busy intervals on the primary calendar within [timeMin, timeMax] (RFC3339). */
export async function listBusy(token: string, timeMinISO: string, timeMaxISO: string): Promise<Busy[]> {
  const url = `${CAL_BASE}/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=100`
    + `&timeMin=${encodeURIComponent(timeMinISO)}&timeMax=${encodeURIComponent(timeMaxISO)}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`events.list ${res.status}`);
  const j = await res.json();
  const out: Busy[] = [];
  for (const e of (j.items ?? []) as GEvent[]) {
    const s = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : null);
    const en = e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00Z` : null);
    if (s && en) out.push({ start: new Date(s), end: new Date(en) });
  }
  return out;
}

/** Open start-times (HH:MM, store tz) of `durationMin` within work hours on `date`. */
export function freeSlots(
  date: string, tz: string, busy: Busy[], durationMin: number,
  workStart = 9, workEnd = 18, stepMin = 30,
): string[] {
  const [y, mo, d] = date.split("-").map(Number);
  const slots: string[] = [];
  const now = Date.now();
  for (let mins = workStart * 60; mins + durationMin <= workEnd * 60; mins += stepMin) {
    const h = Math.floor(mins / 60), mi = mins % 60;
    const startU = zonedToUtc(y, mo, d, h, mi, tz);
    if (startU.getTime() < now) continue; // never offer a time in the past
    const endU = new Date(startU.getTime() + durationMin * 60000);
    const clash = busy.some((b) => startU < b.end && endU > b.start);
    if (!clash) slots.push(`${pad(h)}:${pad(mi)}`);
  }
  return slots;
}

/** True if [date time, +durationMin) in `tz` overlaps any busy interval. */
export function isBusy(date: string, time: string, durationMin: number, tz: string, busy: Busy[]): boolean {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const startU = zonedToUtc(y, mo, d, h, mi, tz);
  const endU = new Date(startU.getTime() + durationMin * 60000);
  return busy.some((b) => startU < b.end && endU > b.start);
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
    summary: o.summary,
    description: o.description,
    start: { dateTime: startU.toISOString(), timeZone: o.tz },
    end: { dateTime: endU.toISOString(), timeZone: o.tz },
  };
  if (o.email) body.attendees = [{ email: o.email }];
  const res = await fetch(`${CAL_BASE}/calendars/primary/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: `create ${res.status}` };
  const j = await res.json();
  return { ok: true, id: j.id };
}
