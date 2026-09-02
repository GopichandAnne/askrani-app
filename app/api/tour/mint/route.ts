import { NextResponse } from "next/server";
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not signed in → log in on the app, then come straight back here.
  if (!user?.email) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/api/tour/mint")}`, req.url));
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
