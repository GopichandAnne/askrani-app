import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { authCookieName } from "./cookie-name";

/**
 * Browser Supabase client (anon key). Safe for client components.
 * RLS enforces access — the anon key alone grants nothing without a session.
 */
export function createClient() {
  const name = authCookieName();
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    name ? { cookieOptions: { name } } : undefined,
  );
}
