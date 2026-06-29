import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Service-role Supabase client for the bot. Runs server-side in the Edge
 * Function and bypasses RLS — the bot writes across stores and isn't a
 * logged-in user. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by the
 * Edge runtime (and by `supabase functions serve` locally).
 */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
