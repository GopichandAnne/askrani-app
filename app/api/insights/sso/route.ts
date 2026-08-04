import { NextResponse } from "next/server";
import { getActiveStore } from "@/lib/store/active-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { mintInsightsToken, insightsBaseUrl, isInsightsSsoConfigured } from "@/lib/insights/sso";

export const dynamic = "force-dynamic";

const APP = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://app.askrani.ai";

/**
 * Handoff into the embedded Insights app. The /insights iframe points here; we
 * re-verify (server-side) that the active store is entitled, mint a short-lived
 * signed token, and redirect the iframe to Insights' /api/sso which starts the
 * session. The token never touches client HTML — it only lives in this 302.
 */
export async function GET() {
  const ctx = await getActiveStore();
  if (!ctx?.active) return NextResponse.redirect(`${APP}/login`);
  if (!ctx.user.email) return NextResponse.redirect(`${APP}/insights?error=no_email`);
  if (!isInsightsSsoConfigured()) return NextResponse.redirect(`${APP}/insights?error=not_configured`);

  // Source-of-truth entitlement check (don't trust the cached nav flag).
  const db = createAdminClient();
  const { data } = await db
    .from("stores")
    .select("insights_enabled, store_display_name")
    .eq("id", ctx.active.id)
    .maybeSingle();
  const row = data as { insights_enabled?: boolean; store_display_name?: string | null } | null;
  if (!row?.insights_enabled) return NextResponse.redirect(`${APP}/insights?error=not_enabled`);

  const token = mintInsightsToken({
    email: ctx.user.email,
    sub: ctx.user.id,
    storeName: row.store_display_name ?? ctx.active.name,
  });
  return NextResponse.redirect(`${insightsBaseUrl()}/api/sso?token=${encodeURIComponent(token)}`);
}
