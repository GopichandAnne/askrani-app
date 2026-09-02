import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getTourStore } from "@/lib/tour/store";
import { mintTourToken } from "@/lib/tour/token";

// SSO bridge for the product tour. A visitor on agent.askrani.ai clicks "sign in";
// we send them here (on app.askrani.ai, where the session lives), mint a short-lived
// identity token for the tour store, and bounce them back to the tour page signed-in.
// The embed then acts AS them (identity forwarding) and unlocks members-only content.
export const dynamic = "force-dynamic";

const AGENT_URL = (process.env.NEXT_PUBLIC_AGENT_URL || "https://agent.askrani.ai").replace(/\/$/, "");

export async function GET(req: Request) {
  const supabase = await createClient();

  // Resolve the signed-in visitor. getUser() does a network validation that can
  // miss a perfectly valid session in a route handler reached by a cross-subdomain
  // click — so fall back to the locally-read session, otherwise a logged-in visitor
  // gets wrongly bounced to /login (and ends up on the console).
  let user = (await supabase.auth.getUser()).data.user;
  if (!user?.email) {
    user = (await supabase.auth.getSession()).data.session?.user ?? null;
  }

  // Genuinely not signed in → send the visitor back to the tour with a diagnostic
  // so we can see WHY (was the auth cookie even present on this route?), instead of
  // bouncing to /login → the console.
  if (!user?.email) {
    let authCookies = "none";
    try {
      const all = (await cookies()).getAll().map((c) => c.name).filter((n) => n.includes("auth"));
      authCookies = all.length ? all.join("|") : "no-auth-cookie";
    } catch {
      authCookies = "cookies-error";
    }
    return NextResponse.redirect(`${AGENT_URL}/agent?tour=nosession&dbg=${encodeURIComponent(authCookies)}`);
  }

  const store = await getTourStore();
  if (!store?.identitySecret || !store.accessControl) {
    // Authenticated embed isn't turned on for the tour store yet.
    return NextResponse.redirect(`${AGENT_URL}/agent?tour=not_configured`);
  }

  const token = mintTourToken(store.identitySecret, {
    email: user.email,
    name: (user.user_metadata?.full_name as string | undefined) || undefined,
    sub: user.id,
    ttlSec: 600,
  });

  const url = new URL(`${AGENT_URL}/agent`);
  url.searchParams.set("uid", token);
  url.searchParams.set("as", user.email);
  return NextResponse.redirect(url.toString());
}
