import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getAdapter } from "@/lib/pos/registry";
import { savePosCreds } from "@/lib/pos/credentials";
import type { PosCreds } from "@/lib/pos/types";

const APP = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://app.askrani.ai";

/** OAuth callback for any POS provider: verify state/nonce + ownership, exchange
 *  the code via the adapter, auto-select a location, and persist the tokens. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const back = (s: string) => NextResponse.redirect(`${APP}/diner?pos=${provider}&pos_status=${s}`);

  const adapter = getAdapter(provider);
  if (!adapter || !adapter.exchangeCode) return back("denied");

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error") || !code || !state) return back("denied");

  let storeId = "";
  let nonce = "";
  let statedProvider = "";
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    storeId = String(parsed.s ?? "");
    nonce = String(parsed.n ?? "");
    statedProvider = String(parsed.p ?? "");
  } catch {
    return back("badstate");
  }

  const jar = await cookies();
  if (!storeId || !nonce || statedProvider !== provider || jar.get("pos_oauth")?.value !== nonce) {
    return back("badstate");
  }

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: storeId });
  if (!isOwner) return back("forbidden");

  try {
    const tok = await adapter.exchangeCode(code, url.searchParams);
    const shim: PosCreds = {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: tok.expires_at,
      merchant_id: tok.merchant_id,
      location_id: null,
      location_name: null,
    };
    const locations = await adapter.listLocations(tok.access_token, shim);
    const active = locations.find((l) => l.status === "ACTIVE") ?? locations[0] ?? null;
    await savePosCreds(adapter.id, storeId, {
      ...shim,
      location_id: active?.id ?? null,
      location_name: active?.name ?? null,
    });
  } catch {
    return back("error");
  }
  jar.delete("pos_oauth");
  return back("connected");
}
