import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * SERVICE-ROLE Supabase client. SERVER ONLY — bypasses RLS.
 *
 * The `server-only` import makes the build FAIL if this module is ever pulled
 * into a client bundle. Use exclusively in trusted server code:
 *   - order action routes (approve/propose/confirm/reject/cancel/edit)
 *   - agent-config render-to-Drive + history writes
 *   - thread_messages / conversations / cart / ticket mirror writes
 *   - store_secrets access (the ONLY way to read WhatsApp tokens)
 *   - migration script
 *
 * Never expose its results unfiltered to a client without an explicit
 * store-scope check — it sees every row in every table.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for the admin client.",
    );
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
