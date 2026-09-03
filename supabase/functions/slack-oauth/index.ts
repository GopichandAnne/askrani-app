// slack-oauth — the "Add to Slack" install callback. The owner starts the install
// from the console (which signs a `state` naming their store); Slack redirects here
// with a code; we exchange it for the workspace's bot token and upsert slack_installs
// so slack-events can serve that workspace.
//
// SETUP: create the Slack app with the bot scopes (see slack-events header), set the
// OAuth Redirect URL to THIS function's URL, and set env on this function:
//   SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_STATE_SECRET (any strong random),
//   SLACK_REDIRECT_URL (this function's URL), APP_URL (e.g. https://app.askrani.ai).
import { serviceClient } from "../_shared/supabase.ts";
import { verifyState } from "../_shared/slack.ts";

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { location: to } });
}

Deno.serve(async (req) => {
  const appUrl = (Deno.env.get("APP_URL") ?? "https://app.askrani.ai").replace(/\/$/, "");
  const done = (status: string) => redirect(`${appUrl}/link?slack=${status}`);

  const url = new URL(req.url);
  if (url.searchParams.get("error")) return done("denied"); // user cancelled

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const storeId = await verifyState(Deno.env.get("SLACK_STATE_SECRET") ?? "", state);
  if (!code || !storeId) return done("badstate");

  const clientId = Deno.env.get("SLACK_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("SLACK_CLIENT_SECRET") ?? "";
  const redirectUri = Deno.env.get("SLACK_REDIRECT_URL") ?? "";
  if (!clientId || !clientSecret) {
    console.error("[slack-oauth] SLACK_CLIENT_ID / SLACK_CLIENT_SECRET not set");
    return done("unconfigured");
  }

  // Exchange the code for the workspace's bot token.
  // deno-lint-ignore no-explicit-any
  let data: any;
  try {
    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code });
    if (redirectUri) body.set("redirect_uri", redirectUri);
    const res = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    data = await res.json();
  } catch (e) {
    console.error("[slack-oauth] exchange error:", (e as Error)?.message);
    return done("error");
  }
  if (!data?.ok || !data.access_token || !data.team?.id) {
    console.error("[slack-oauth] oauth.v2.access failed:", data?.error);
    return done("error");
  }

  const db = serviceClient();
  const { error } = await db.from("slack_installs").upsert({
    team_id: String(data.team.id),
    store_id: storeId,
    bot_token: String(data.access_token),
    bot_user_id: data.bot_user_id ? String(data.bot_user_id) : null,
    team_name: data.team?.name ? String(data.team.name) : null,
    installed_by: data.authed_user?.id ? String(data.authed_user.id) : null,
    active: true,
  }, { onConflict: "team_id" });
  if (error) {
    console.error("[slack-oauth] upsert failed:", error.message);
    return done("error");
  }

  return done("connected");
});
