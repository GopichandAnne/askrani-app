import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/** Signup-door intents (e.g. the marketing /product door → ?type=saas) that pick
 *  the SaaS/product console profile at onboarding. Captured here as a short-lived
 *  cookie so it survives the auth round-trip and reaches store creation. */
const INTENT_TYPES = new Set(["saas", "product", "software"]);

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  const type = request.nextUrl.searchParams.get("type")?.toLowerCase();
  if (type && INTENT_TYPES.has(type)) {
    response.cookies.set("ar_intent_type", type, { path: "/", maxAge: 3600, sameSite: "lax" });
  }
  // Grader hand-off: the site the visitor just had graded, so onboarding can
  // auto-set-up from it instead of asking for the website again.
  const site = request.nextUrl.searchParams.get("site");
  if (site && site.includes(".") && site.length <= 300) {
    response.cookies.set("ar_intent_site", site, { path: "/", maxAge: 3600, sameSite: "lax" });
  }
  return response;
}

export const config = {
  matcher: [
    /*
     * Run on all paths except static assets and image optimization files.
     * Auth cookie refresh must happen on navigations and API/route handlers.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
