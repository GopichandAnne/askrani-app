// Calendly helpers for the bot's scheduling tools. Calendly is link-based: the
// customer books on Calendly's own page, so these surface the store's meeting
// types and open slots (each with a booking link) rather than writing an event.
// Tokens come from the OAuth broker vault (connections.getAccessToken).

const API = "https://api.calendly.com";

export interface CalUser { uri: string; scheduling_url: string; name: string; email: string }
export interface EventType { uri: string; name: string; duration: number; scheduling_url: string; active: boolean }
export interface Slot { start_time: string; scheduling_url: string }

// deno-lint-ignore no-explicit-any
type Any = any;

/** The connected Calendly user (their URI + main booking page). */
export async function me(token: string): Promise<CalUser | null> {
  const res = await fetch(`${API}/users/me`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`users/me ${res.status}`);
  const r = (await res.json()).resource;
  if (!r?.uri) return null;
  return { uri: r.uri, scheduling_url: r.scheduling_url ?? "", name: r.name ?? "", email: r.email ?? "" };
}

/** The store's active meeting types (name, length, per-type booking link). */
export async function listEventTypes(token: string, userUri: string): Promise<EventType[]> {
  const url = `${API}/event_types?user=${encodeURIComponent(userUri)}&active=true&count=100`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`event_types ${res.status}`);
  const j = await res.json();
  return ((j.collection ?? []) as Any[]).map((e) => ({
    uri: e.uri, name: e.name ?? "", duration: Number(e.duration ?? 0), scheduling_url: e.scheduling_url ?? "", active: e.active !== false,
  }));
}

/** Open slots for an event type within [startISO, endISO] (UTC, ≤7 days, future). */
export async function availableTimes(token: string, eventTypeUri: string, startISO: string, endISO: string): Promise<Slot[]> {
  const url = `${API}/event_type_available_times?event_type=${encodeURIComponent(eventTypeUri)}`
    + `&start_time=${encodeURIComponent(startISO)}&end_time=${encodeURIComponent(endISO)}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`available_times ${res.status}`);
  const j = await res.json();
  return ((j.collection ?? []) as Any[])
    .filter((s) => s.status === "available")
    .map((s) => ({ start_time: s.start_time, scheduling_url: s.scheduling_url ?? "" }));
}
