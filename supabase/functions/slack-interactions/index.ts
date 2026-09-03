// slack-interactions — Approve/Decline button clicks from the governance messages
// posted by holds.ts. A click resolves the SAME action_request row the Activity page
// uses (status + who decided), then replaces the Slack message. Records sign-off; it
// does not re-run the tool (v1, consistent with the console approval).
//
// SETUP: set this function's URL as the Slack app's Interactivity Request URL.
// Env: SLACK_SIGNING_SECRET (same app secret as slack-events).
import { serviceClient } from "../_shared/supabase.ts";
import { parseInteraction, verifySlackSignature } from "../_shared/slack.ts";
import { slackRespond } from "../_shared/slack-api.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const rawBody = await req.text();
  const ts = req.headers.get("x-slack-request-timestamp") ?? "";
  const sig = req.headers.get("x-slack-signature") ?? "";
  if (!await verifySlackSignature(Deno.env.get("SLACK_SIGNING_SECRET") ?? "", ts, rawBody, sig)) {
    return new Response("invalid signature", { status: 401 });
  }

  // Interactivity payloads arrive form-encoded as payload=<json>.
  const payloadStr = new URLSearchParams(rawBody).get("payload");
  if (!payloadStr) return new Response("ok", { status: 200 });
  let payload: unknown;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return new Response("bad payload", { status: 400 });
  }

  const parsed = parseInteraction(payload);
  if (!parsed) return new Response("ok", { status: 200 }); // not an approval button — ignore

  const db = serviceClient();
  // Resolve only while still pending (guards against a double click / race).
  const { data } = await db
    .from("action_request")
    .update({ status: parsed.decision, decided_by: `${parsed.userName} (Slack)`, decided_at: new Date().toISOString() })
    .eq("id", parsed.actionRequestId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (parsed.responseUrl) {
    const verb = parsed.decision === "approved" ? "Approved" : "Declined";
    const msg = data
      ? `${parsed.decision === "approved" ? "✅" : "🚫"} ${verb} by ${parsed.userName}. Nothing was re-run automatically — action it in your systems as usual.`
      : "That request was already resolved.";
    await slackRespond(parsed.responseUrl, { replace_original: true, text: msg });
  }

  return new Response("ok", { status: 200 });
});
