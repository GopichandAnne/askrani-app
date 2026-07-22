// ref — the referral short-link resolver behind askrani.ai/r/<code>.
//
// Logs the click (24h-deduped by device hash) and sends the visitor on to the
// destination the initiator's card points at (the store's WhatsApp, carrying the
// [ref:CODE] marker, or web chat). Public: verify_jwt=false — there is no secret
// here, only a public short code, and it must open from any forwarded chat.
//
//   GET  /ref?c=CODE            -> 302 to the destination (direct-link fallback)
//   POST /ref {code, dedupe_hash, geo_city}  -> { destination }  (the Next route,
//                                which supplies the real client IP/UA/city)

import { serviceClient } from "../_shared/supabase.ts";
import { resolveReferralClick } from "../_shared/referral.ts";

const WEB_BASE = "https://askrani.ai";

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  try {
    const db = serviceClient();

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const code = String(body.code ?? "").trim();
      if (!code) return Response.json({ destination: WEB_BASE });
      const { destination } = await resolveReferralClick(db, code, {
        dedupeHash: body.dedupe_hash ? String(body.dedupe_hash) : null,
        geoCity: body.geo_city ? String(body.geo_city) : null,
      });
      return Response.json({ destination });
    }

    // GET — direct link. Derive a device hash from IP + UA ourselves.
    const url = new URL(req.url);
    const code = (url.searchParams.get("c") ?? "").trim();
    if (!code) return Response.redirect(WEB_BASE, 302);
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    const ua = req.headers.get("user-agent") ?? "";
    const dedupeHash = ip || ua ? await sha256Hex(`${code}|${ip}|${ua}`) : null;
    const { destination } = await resolveReferralClick(db, code, { dedupeHash, geoCity: null });
    return Response.redirect(destination, 302);
  } catch (e) {
    console.error(`[ref] ${e instanceof Error ? e.message : e}`);
    return Response.redirect(WEB_BASE, 302);
  }
});
