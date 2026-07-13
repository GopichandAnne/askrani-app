// parse-resume — reference document-parsing connector.
//
// Turns a candidate's resume into structured fields the bot can drop straight
// into file_request. This is an INTEGRATION, not a core feature: a production
// deploy swaps the internals for a real résumé parser (Affinda / Sovren /
// HireAbility) or a vendor OCR. HMAC-signed like every connector; register per
// store via bot-admin set_integration. PARSE_RESUME_SECRET must match the
// store_integrations auth_secret.

import { generateStructured, generateStructuredFromMedia } from "../_shared/gemini.ts";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

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

  // Three inputs: (1) resume_text the caller already has; (2) a file_url to a
  // text file; (3) a file_url to a PDF/image, which Gemini reads natively. A real
  // parser (Affinda/Sovren) would replace this binary path with its own OCR.
  let text = String(a.resume_text ?? "").trim();
  let media: { mime: string; data: string } | null = null;
  if (!text && a.file_url) {
    try {
      const r = await fetch(String(a.file_url));
      const ct = (r.headers.get("content-type") ?? "").toLowerCase();
      if (ct.includes("text") || ct.includes("json")) {
        text = (await r.text()).trim();
      } else if (ct.includes("pdf") || ct.includes("image")) {
        media = { mime: ct.split(";")[0], data: encodeBase64(new Uint8Array(await r.arrayBuffer())) };
      } else {
        return json({
          ok: false,
          note: `This reference parser reads text, PDF and images; a production parser would handle ${ct || "this file"}.`,
        });
      }
    } catch {
      return json({ ok: false, note: "Couldn't fetch that file." });
    }
  }

  let fields: Record<string, unknown> | null = null;
  if (text) fields = await generateStructured(SYS, text.slice(0, 12000));
  else if (media) fields = await generateStructuredFromMedia(SYS, media.mime, media.data);
  else return json({ ok: false, note: "Provide resume_text or a file_url." });

  if (!fields) return json({ ok: false, note: "Couldn't parse the resume right now." });
  return json({ ok: true, fields });
});
