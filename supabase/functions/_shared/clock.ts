// Store-local date/time context — Bot Phase 3d. Builds the [NOW: …] line that
// gets prefixed onto the current customer message (volatile part, NOT the cached
// prefix). Gives the model an authoritative "today", current time, and STORE:
// OPEN/CLOSED flag so it can answer today/tomorrow/pickup-timing/open-now
// correctly instead of guessing (the earlier date-blindness bug).
//
// store_hours JSON: { "0":["10:00","19:00"], … "6":["09:00","21:00"] } keyed by
// JS day index (0=Sun). A missing/null day = closed.

const DEFAULT_TZ = "America/Chicago";

function hmToMinutes(hm: string): number | null {
  const [h, m] = hm.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function fmt12(hm: string): string {
  const min = hmToMinutes(hm);
  if (min == null) return hm;
  let h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Build the [NOW: …] context line in the store's timezone. `now` is injectable
 *  for tests; defaults to the current instant. */
export function buildNowContext(
  timezone: string | null,
  storeHoursJson: string | null,
  now: Date = new Date(),
): string {
  const tz = timezone || DEFAULT_TZ;

  // Friendly date + time (e.g. "Saturday, July 4, 2026, 9:15 PM")
  const pretty = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);

  // Day index + minutes-of-day in the store tz, for the open/closed math.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = WD[get("weekday")] ?? 0;
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  const minutes = hour * 60 + parseInt(get("minute"), 10);

  let flag = "";
  if (storeHoursJson) {
    try {
      const hours = JSON.parse(storeHoursJson) as Record<string, [string, string] | null>;
      const today = hours[String(day)];
      if (Array.isArray(today) && today.length === 2) {
        const o = hmToMinutes(today[0]);
        const c = hmToMinutes(today[1]);
        if (o != null && c != null) {
          const open = minutes >= o && minutes < c;
          flag = ` | STORE: ${open ? "OPEN" : "CLOSED"} (today ${fmt12(today[0])} to ${fmt12(today[1])})`;
        }
      } else {
        flag = " | STORE: CLOSED (closed today)";
      }
    } catch {
      // bad JSON — omit the flag rather than lie
    }
  }

  return `[NOW: ${pretty}${flag}]`;
}
