import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { mintInsightsToken, insightsBaseUrl, isInsightsSsoConfigured } from "@/lib/insights/sso";

export const dynamic = "force-dynamic";

const APP = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://app.askrani.ai";

/**
 * Direct "Sign in with Ask Rani" entry for the STANDALONE Insights app (its own
 * tab, not the embedded panel). Insights links here with ?return=<insights path>.
 *
 *   • Not signed into Rani  → bounce through Rani /login, then come back here.
 *   • Signed in (with email)→ mint the SSO token and hand off to Insights /api/sso,
 *                             which provisions the matching Insights user by email
 *                             and starts a first-party session.
 *
 * Unlike the embedded /api/insights/sso handoff, this is NOT gated on a store's
 * insights_enabled — standalone Insights is an open product; this route only
 * authenticates the person. The token never reaches client HTML (lives in the 302).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("return") || "/";
  // Only allow a same-origin path back into Insights (defense against open-redirect).
  const ret = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  const self = `/api/insights/sso/start?return=${encodeURIComponent(ret)}`;

  if (!isInsightsSsoConfigured()) return NextResponse.redirect(`${insightsBaseUrl()}/login?sso=not_configured`);

  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.redirect(`${APP}/login?next=${encodeURIComponent(self)}`);
  if (!ctx.user.email) return NextResponse.redirect(`${insightsBaseUrl()}/login?sso=no_email`);

  const token = mintInsightsToken({
    email: ctx.user.email,
    sub: ctx.user.id,
    storeName: ctx.stores[0]?.name,
  });
  return NextResponse.redirect(
    `${insightsBaseUrl()}/api/sso?token=${encodeURIComponent(token)}&return=${encodeURIComponent(ret)}`,
  );
}
