import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";

/**
 * Server Supabase client (anon key + user session from cookies).
 * Use in Server Components, Route Handlers, and Server Actions.
 * RLS applies as the logged-in user.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    // Server-side calls use the DIRECT *.supabase.co host (SUPABASE_INTERNAL_URL);
    // from Vercel the custom-domain Cloudflare hop adds ~1.5s to every auth call.
    // The browser (client.ts) still uses the custom domain. No-op until env is set.
    (process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll called from a Server Component — safe to ignore when
            // middleware is responsible for refreshing the session cookie.
          }
        },
      },
    },
  );
}
