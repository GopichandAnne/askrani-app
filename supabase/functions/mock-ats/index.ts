// mock-ats — reference ATS / scheduling connector for the recruiting demo.
//
// Demonstrates the connector path for a staffing firm WITHOUT any core change:
// the bot calls these tools, this function returns mock results (a real deploy
// would swap the internals for Bullhorn / Ceipal / JobDiva + a calendar API).
// HMAC-signed like every other connector; register per-store via bot-admin
// set_integration. MOCK_ATS_SECRET must match the store_integrations auth_secret.

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

async function verify(secret: string, body: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = "sha256=" +
    [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return header === expected;
}

// Deterministic pseudo-status from the contact string, so the same candidate
// always sees the same stage (feels real across turns).
function statusFor(seed: string): { stage: string; note: string } {
  const stages = [
    { stage: "Received", note: "Your profile is in our system and queued for a recruiter to review." },
    { stage: "Under review", note: "A recruiter is reviewing your profile against open roles." },
    { stage: "Shortlisted", note: "You've been shortlisted — a recruiter will reach out to schedule a screen." },
    { stage: "Interview stage", note: "You're in the interview process for a matching role." },
  ];
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return stages[h % stages.length];
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const raw = await req.text();
  const secret = Deno.env.get("MOCK_ATS_SECRET");
  if (secret && !(await verify(secret, raw, req.headers.get("X-Rani-Signature")))) {
    return json({ error: "bad signature" }, 401);
  }
  let parsed: { tool?: string; args?: Record<string, unknown> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const a = parsed.args ?? {};

  switch (parsed.tool ?? "") {
    case "check_application_status": {
      const who = String(a.email ?? a.name ?? "").trim();
      if (!who) return json({ found: false, note: "Ask the candidate for the email they applied with." });
      const s = statusFor(who.toLowerCase());
      return json({
        found: true,
        candidate: who,
        reference: "APX-" + (Math.abs([...who].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 100000),
        stage: s.stage,
        note: s.note,
      });
    }
    case "book_screening": {
      const email = String(a.email ?? "").trim();
      if (!email) return json({ booked: false, note: "Need the candidate's email to send the invite." });
      const when = String(a.preferred_time ?? "").trim();
      return json({
        booked: true,
        email,
        slot: when || "the next available slot",
        meeting_link: "https://meet.apexstaffing.demo/screen/" +
          (Math.abs([...email].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 3)) % 1000000),
        note: "A calendar invite has been emailed. A recruiter will run a 15-minute screen.",
      });
    }
    default:
      return json({ error: `unknown tool: ${parsed.tool}` }, 400);
  }
});
