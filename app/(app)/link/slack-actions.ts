"use server";

import crypto from "node:crypto";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Bot scopes the Slack app requests (must match the app's config).
const SLACK_SCOPES = "chat:write,users:read,users:read.email,app_mentions:read,im:history,im:read,im:write";

export type SlackStatus = {
  configured: boolean; // env present so an install can start
  connected: boolean;
  teamName?: string | null;
  installUrl?: string | null;
  approvalsChannel?: string | null;
};

async function requireOwner(storeId: string) {
  const ctx = await getActiveStore();
  if (!ctx?.active || ctx.active.id !== storeId) throw new Error("No access to this store.");
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: storeId });
  if (!isOwner) throw new Error("Owners only.");
}

function signState(secret: string, storeId: string, ttlSec = 600): string {
  const payload = Buffer.from(JSON.stringify({ s: storeId, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export async function getSlackStatus(storeId: string): Promise<SlackStatus> {
  await requireOwner(storeId);
  const db = createAdminClient();
  // slack_installs isn't in the generated types; a scoped cast keeps this query untyped.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = db.from as unknown as (t: string) => any;
  const { data: install } = await from("slack_installs").select("team_name, approvals_channel").eq("store_id", storeId).eq("active", true).maybeSingle();

  const clientId = process.env.SLACK_CLIENT_ID ?? "";
  const stateSecret = process.env.SLACK_STATE_SECRET ?? "";
  const redirectUri = process.env.SLACK_REDIRECT_URL ?? "";
  const configured = !!(clientId && stateSecret && redirectUri);

  let installUrl: string | null = null;
  if (configured) {
    const u = new URL("https://slack.com/oauth/v2/authorize");
    u.searchParams.set("client_id", clientId);
    u.searchParams.set("scope", SLACK_SCOPES);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", signState(stateSecret, storeId));
    installUrl = u.toString();
  }
  return { configured, connected: !!install, teamName: install?.team_name ?? null, installUrl, approvalsChannel: install?.approvals_channel ?? null };
}

/** Set the Slack channel that gets Approve/Decline prompts for held actions. */
export async function setSlackApprovalsChannel(storeId: string, channel: string): Promise<{ ok: boolean; error?: string }> {
  await requireOwner(storeId);
  const db = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = db.from as unknown as (t: string) => any;
  const { error } = await from("slack_installs").update({ approvals_channel: channel.trim() || null }).eq("store_id", storeId).eq("active", true);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
