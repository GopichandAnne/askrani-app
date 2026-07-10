// mock-apartment — a stand-in for an apartment community's property-management
// system (PMS) — Yardi / AppFolio / Buildium / RealPage / Entrata — to demo the
// Phase 6 connector pattern for multifamily housing. In production this lives
// OUTSIDE the platform (the property's own service, wrapping their PMS API).
// Here it proves the two-audience flow with NO core change:
//   - PROSPECTS (public, anonymous): unit_availability, book_tour, capture_lead
//   - RESIDENTS (light-touch): create_work_order — creating a ticket is low risk
//   - RESIDENT ACCOUNT (gated): get_balance requires identity verification, so it
//     is fronted by send_resident_code — a STUBBED one-time-code flow that shows
//     the gate behaving without standing up a real resident portal / OTP.
//
// One endpoint serves multiple tools (routed by `tool`); each is a separate
// store_integrations row. verify_jwt=false — auth is the X-Rani-Signature HMAC.

type Unit = {
  unit: string; floorplan: string; beds: number; baths: number;
  sqft: number; rent: number; available: string; special?: string;
};

// A small "live" availability feed — richer and fresher than the static KB.
const UNITS: Unit[] = [
  { unit: "112", floorplan: "The Aspen (studio)", beds: 0, baths: 1, sqft: 500, rent: 1395, available: "now" },
  { unit: "214", floorplan: "The Birch", beds: 1, baths: 1, sqft: 720, rent: 1650, available: "2026-07-05", special: "app fee waived this month" },
  { unit: "301", floorplan: "The Birch Deluxe", beds: 1, baths: 1, sqft: 780, rent: 1750, available: "now" },
  { unit: "128", floorplan: "The Cedar", beds: 2, baths: 2, sqft: 1050, rent: 2150, available: "2026-08-01" },
  { unit: "402", floorplan: "The Cedar Corner", beds: 2, baths: 2, sqft: 1120, rent: 2300, available: "now", special: "1 month free on a 13-month lease" },
  { unit: "510", floorplan: "The Maple", beds: 3, baths: 2, sqft: 1400, rent: 2850, available: "2026-09-01" },
];

function id(prefix: string) {
  return prefix + "-" + crypto.randomUUID().slice(0, 8).toUpperCase();
}

// ── PROSPECT tools ──────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
function availability(a: any) {
  const beds = a.beds == null ? null : Number(a.beds);
  const maxRent = a.max_rent == null ? null : Number(a.max_rent);
  const results = UNITS.filter((u) =>
    (beds == null || u.beds === beds) &&
    (maxRent == null || u.rent <= maxRent)
  ).map((u) => ({
    unit: u.unit, floorplan: u.floorplan, beds: u.beds, baths: u.baths,
    sqft: u.sqft, rent: u.rent, available: u.available, special: u.special ?? null,
  }));
  return {
    found: results.length,
    units: results,
    note: "Live availability. Rents are current asking rates; final pricing and any specials are confirmed on application.",
  };
}

// ── RESIDENT (light-touch) ──────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
function workOrder(a: any) {
  const urgency = String(a.urgency ?? "routine").toLowerCase();
  const emergency = /emerg|flood|gas|fire|no heat|smoke|burst/.test(
    urgency + " " + String(a.description ?? "").toLowerCase(),
  );
  return {
    ok: true,
    work_order_id: id("WO"),
    urgency: emergency ? "emergency" : urgency,
    note: emergency
      ? "URGENT work order created and the on-call maintenance team has been paged. For any life-safety issue (gas, fire, flood), call 911 first."
      : "Work order created and routed to the maintenance team. You can ask me for its status anytime.",
  };
}

// ── RESIDENT ACCOUNT (gated) ────────────────────────────────────────────────
// Step 1: send a one-time code to the contact ON FILE (stubbed — no real SMS).
// deno-lint-ignore no-explicit-any
function sendResidentCode(a: any) {
  const contact = String(a.contact ?? "").trim();
  if (!contact) return { ok: false, note: "Need the phone or email on the lease to send a code." };
  return {
    ok: true,
    sent_to: contact,
    note: "A 6-digit verification code was sent to the contact on file. Ask the resident to enter it. (Demo environment: the code is 123456.)",
  };
}

// Step 2: only return account data if the code checks out. Self-claim never
// authorizes — the PMS (this service), not the bot, is the authority.
// deno-lint-ignore no-explicit-any
function getBalance(a: any) {
  const code = String(a.code ?? "").trim();
  if (!code) {
    return { verified: false, action: "verify", note: "Account details are protected. Verify identity with a one-time code first (call send_resident_code)." };
  }
  if (code !== "123456") {
    return { verified: false, note: "That code didn't match. I can resend a new one to the contact on file." };
  }
  return {
    verified: true,
    unit: a.unit ?? "your unit",
    balance_due: 0.0,
    next_rent: 1650.0,
    next_due_date: "2026-08-01",
    late_fee_after: "2026-08-05",
    autopay: false,
    note: "Balance is current. Rent is paid through the secure resident portal — never share card or bank details in chat.",
  };
}

async function verify(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = "sha256=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return header === expected;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const raw = await req.text();
  const secret = Deno.env.get("MOCK_APARTMENT_SECRET");
  if (secret && !(await verify(secret, raw, req.headers.get("X-Rani-Signature")))) {
    return json({ error: "bad signature" }, 401);
  }
  let parsed: { tool?: string; args?: Record<string, unknown> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const tool = parsed.tool ?? "";
  const a = parsed.args ?? {};

  switch (tool) {
    case "unit_availability":
      return json(availability(a));
    case "book_tour":
      return json({ ok: true, tour_id: id("TOUR"), note: `Tour request sent to the leasing team for ${a.preferred_time ?? "the requested time"} — they'll confirm.` });
    case "capture_lead":
      return json({ ok: true, lead_id: id("LEAD"), note: "Lead saved to the leasing CRM; the team will follow up." });
    case "create_work_order":
      return json(workOrder(a));
    case "send_resident_code":
      return json(sendResidentCode(a));
    case "get_balance":
      return json(getBalance(a));
    default:
      return json({ error: `unknown tool: ${tool}` }, 400);
  }
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
