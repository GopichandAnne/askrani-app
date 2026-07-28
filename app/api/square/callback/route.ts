import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { squareConfig } from "@/lib/square/config";
import { exchangeCode, listLocations } from "@/lib/square/oauth";
import { saveSquareCreds } from "@/lib/square/credentials";

const APP = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://app.askrani.ai";
const back = (q: string) => NextResponse.redirect(`${APP}/diner?square=${q}`);

/** Square OAuth callback: verify state/nonce + ownership, exchange the code,
 *  auto-select an active location, and persist the tokens for the store. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error") || !code || !state) return back("denied");

  let storeId = "";
  let nonce = "";
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    storeId = String(parsed.s ?? "");
    nonce = String(parsed.n ?? "");
  } catch {
    return back("badstate");
  }

  const jar = await cookies();
  const cookieNonce = jar.get("sq_oauth")?.value;
  if (!storeId || !nonce || cookieNonce !== nonce) return back("badstate");

  // Re-verify the signed-in user actually owns the store the state claims.
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: storeId });
  if (!isOwner) return back("forbidden");

  const cfg = squareConfig();
  try {
    const tok = await exchangeCode(cfg, code);
    const locations = await listLocations(tok.access_token);
    const active = locations.find((l) => l.status === "ACTIVE") ?? locations[0] ?? null;
    await saveSquareCreds(storeId, {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: tok.expires_at,
      merchant_id: tok.merchant_id,
      location_id: active?.id ?? null,
      location_name: active?.name ?? null,
    });
  } catch {
    return back("error");
  }
  jar.delete("sq_oauth");
  return back("connected");
}
