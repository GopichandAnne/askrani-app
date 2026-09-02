import { NextResponse } from "next/server";
import { getTourStore } from "@/lib/tour/store";
import { verifyTourToken } from "@/lib/tour/token";
import { createAdminClient } from "@/lib/supabase/admin";

// Per-user tour tool: returns the SIGNED-IN visitor's own real account on the
// platform. Called by an identity-mode tool (claim="token") — the chat engine
// forwards the visitor's verified token here, we verify it with the tour store's
// identity secret, read their user id, and return their store's live stats.
// Read-only. Anonymous / invalid token → a clear "sign in" note (never data).
export const dynamic = "force-dynamic";

function bearer(req: Request): string {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

export async function GET(req: Request) {
  const store = await getTourStore();
  if (!store?.identitySecret) {
    return NextResponse.json({ error: "tour not configured" }, { status: 500 });
  }
  const claim = verifyTourToken(store.identitySecret, bearer(req));
  if (!claim?.sub) {
    return NextResponse.json({ signed_in: false, note: "Ask the visitor to sign in to see their own account." }, { status: 200 });
  }

  const db = createAdminClient();
  const { data: staff } = await db.from("staff").select("store_id").eq("user_id", claim.sub);
  const storeIds = (staff ?? []).map((r) => (r as { store_id: string }).store_id);
  if (storeIds.length === 0) {
    return NextResponse.json({ signed_in: true, email: claim.email, stores: 0, note: "No store on this account yet." });
  }
  const myStoreId = storeIds[0];

  const { data: s } = await db
    .from("stores")
    .select("store_display_name, business_type, created_at, slug")
    .eq("id", myStoreId)
    .maybeSingle();
  const slug = (s as { slug?: string } | null)?.slug ?? "";

  const [know, http, mcp, convs] = await Promise.all([
    db.from("knowledge_index").select("id", { count: "exact", head: true }).eq("store_id", myStoreId),
    db.from("http_tool").select("id", { count: "exact", head: true }).eq("store_id", myStoreId),
    db.from("mcp_tool").select("id", { count: "exact", head: true }).eq("store_id", myStoreId),
    db.from("conversations").select("id", { count: "exact", head: true }).eq("store_slug", slug),
  ]);

  const row = s as { store_display_name: string | null; business_type: string | null; created_at: string } | null;
  return NextResponse.json({
    signed_in: true,
    email: claim.email,
    account: {
      store: row?.store_display_name ?? slug,
      type: row?.business_type ?? "unknown",
      member_since: row?.created_at ?? null,
      knowledge_docs: know.count ?? 0,
      connected_tools: (http.count ?? 0) + (mcp.count ?? 0),
      total_conversations: convs.count ?? 0,
      stores_owned: storeIds.length,
    },
  });
}
