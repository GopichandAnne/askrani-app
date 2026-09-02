import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authCookieName } from "./cookie-name";

/** Public path prefixes that do not require an authenticated session. The Stripe
 *  top-up webhook is called by Stripe (no user cookie) and is secured by its own
 *  signature check — it must not be redirected to /login. */
const PUBLIC_PREFIXES = [
  "/login",
  "/auth",
  "/api/stripe/topup-webhook",
  // Product-tour endpoints handle their OWN auth: /api/tour/mint checks the session
  // itself (and redirects to /login when absent), while /api/tour/account and
  // /api/tour/upgrade are called server-to-server by the chat engine with a signed
  // bearer token — they must not be bounced to /login.
  "/api/tour",
];

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Refreshes the Supabase session cookie on every request (required by
 * @supabase/ssr) and performs coarse route protection:
 *   - no user + protected path  -> redirect to /login
 *   - user present + /login     -> redirect to /
 * Fine-grained access (which stores, owner vs staff) is enforced in the (app)
 * layout and by RLS.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Pin the cookie name (PUBLIC-url-derived) so this middleware client — which
  // dials the internal host — reads the same cookie the browser wrote.
  const name = authCookieName();

  const supabase = createServerClient(
    // Direct host for this per-request server-side auth call — the custom domain
    // adds ~1.5s from Vercel. Browser keeps the custom domain. (SUPABASE_INTERNAL_URL)
    (process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(name ? { cookieOptions: { name } } : {}),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Must return supabaseResponse so refreshed auth cookies propagate.
  return supabaseResponse;
}
