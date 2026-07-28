import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { squareConfig } from "@/lib/square/config";
import { buildAuthorizeUrl } from "@/lib/square/oauth";

const APP = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://app.askrani.ai";

/** Kick off the Square OAuth flow for the active store (owner only). Sets a
 *  short-lived nonce cookie and redirects to Square's authorize page. */
export async function GET() {
  const cfg = squareConfig();
  if (!cfg.configured) return NextResponse.redirect(`${APP}/diner?square=unconfigured`);

  const ctx = await getActiveStore();
  if (!ctx?.active) return NextResponse.redirect(`${APP}/login`);

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner) return NextResponse.redirect(`${APP}/orders`);

  const nonce = crypto.randomUUID();
  const state = Buffer.from(JSON.stringify({ s: ctx.active.id, n: nonce })).toString("base64url");
  const jar = await cookies();
  jar.set("sq_oauth", nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return NextResponse.redirect(buildAuthorizeUrl(cfg, state));
}
