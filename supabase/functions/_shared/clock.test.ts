// Deno tests for buildNowContext. Run:
//   deno test supabase/functions/_shared/clock.test.ts

import { assert, assertStringIncludes } from "jsr:@std/assert@1";
import { buildNowContext } from "./clock.ts";

// Man Pasand hours: Mon-Fri 10:00-20:30, Sat 09:00-21:00, Sun 10:00-19:00.
const HOURS = JSON.stringify({
  "0": ["10:00", "19:00"], "1": ["10:00", "20:30"], "2": ["10:00", "20:30"],
  "3": ["10:00", "20:30"], "4": ["10:00", "20:30"], "5": ["10:00", "20:30"],
  "6": ["09:00", "21:00"],
});

// 2026-07-04 is a Saturday. 20:00 UTC = 3:00 PM Central (CDT, UTC-5) -> OPEN.
Deno.test("OPEN during Saturday afternoon (Central)", () => {
  const s = buildNowContext("America/Chicago", HOURS, new Date("2026-07-04T20:00:00Z"));
  assertStringIncludes(s, "Saturday");
  assertStringIncludes(s, "STORE: OPEN");
});

// 2026-07-04 Saturday, 03:00 UTC = 10:00 PM Central (prev evening) -> CLOSED (Sat closes 9 PM).
Deno.test("CLOSED late Friday night / after hours (Central)", () => {
  const s = buildNowContext("America/Chicago", HOURS, new Date("2026-07-04T03:00:00Z"));
  assertStringIncludes(s, "STORE: CLOSED");
});

Deno.test("no store_hours -> date/time only, no STORE flag", () => {
  const s = buildNowContext("America/Chicago", null, new Date("2026-07-04T20:00:00Z"));
  assert(!s.includes("STORE:"));
  assertStringIncludes(s, "[NOW:");
});
