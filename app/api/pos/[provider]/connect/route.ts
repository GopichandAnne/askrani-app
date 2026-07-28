import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { getAdapter } from "@/lib/pos/registry";

const APP = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://app.askrani.ai";

/** Start the OAuth flow for a POS provider on the active store (owner only). */
export async function GET(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const adapter = getAdapter(provider);
  if (!adapter || !adapter.configured()) {
    return NextResponse.redirect(`${APP}/diner?pos=${provider}&pos_status=unconfigured`);
  }

  const ctx = await getActiveStore();
  if (!ctx?.active) return NextResponse.redirect(`${APP}/login`);

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: ctx.active.id });
  if (!isOwner) return NextResponse.redirect(`${APP}/orders`);

  const nonce = crypto.randomUUID();
  const state = Buffer.from(JSON.stringify({ s: ctx.active.id, n: nonce, p: adapter.id })).toString("base64url");
  const jar = await cookies();
  jar.set("pos_oauth", nonce, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  return NextResponse.redirect(adapter.buildAuthorizeUrl(state));
}
