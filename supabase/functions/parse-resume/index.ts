// parse-resume — reference document-parsing connector.
//
// Turns a candidate's resume into structured fields the bot can drop straight
// into file_request. This is an INTEGRATION, not a core feature: a production
// deploy swaps the internals for a real résumé parser (Affinda / Sovren /
// HireAbility) or a vendor OCR. HMAC-signed like every connector; register per
// store via bot-admin set_integration. PARSE_RESUME_SECRET must match the
// store_integrations auth_secret.

import { generateStructured } from "../_shared/gemini.ts";

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

const SYS =
  "You extract a candidate's details from resume text into JSON. Respond with ONLY a JSON " +
  "object of exactly this shape (use an empty string for anything not present; never invent): " +
  '{"name": string, "email": string, "phone": string, "positions": string (roles they target ' +
  'or have held, comma-separated), "skills": string (key skills/tech, comma-separated), ' +
  '"experience": string (e.g. "8 years"), "location": string, "summary": string (one short line)}.';

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const raw = await req.text();
  const secret = Deno.env.get("PARSE_RESUME_SECRET");
  if (secret && !(await verify(secret, raw, req.headers.get("X-Rani-Signature")))) {
    return json({ error: "bad signature" }, 401);
  }
  let parsed: { tool?: string; args?: Record<string, unknown> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, 400);
  }
  if ((parsed.tool ?? "") !== "parse_resume") {
    return json({ error: `unknown tool: ${parsed.tool}` }, 400);
  }
  const a = parsed.args ?? {};

  // Prefer text the caller already has (e.g. the model read an uploaded image);
  // otherwise fetch a text file_url. Binary formats are the real-parser's job.
  let text = String(a.resume_text ?? "").trim();
  if (!text && a.file_url) {
    try {
      const r = await fetch(String(a.file_url));
      const ct = r.headers.get("content-type") ?? "";
      if (ct.includes("text") || ct.includes("json")) {
        text = (await r.text()).trim();
      } else {
        return json({
          ok: false,
          note: `This reference parser handles text; a production parser would extract ${ct || "this file"}.`,
        });
      }
    } catch {
      return json({ ok: false, note: "Couldn't fetch that file." });
    }
  }
  if (!text) return json({ ok: false, note: "Provide resume_text, or a text file_url." });

  const fields = await generateStructured(SYS, text.slice(0, 12000));
  if (!fields) return json({ ok: false, note: "Couldn't parse the resume right now." });

  return json({ ok: true, fields });
});
