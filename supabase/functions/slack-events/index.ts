// slack-events — Slack front door (Events API). Rani as a teammate in Slack: DMs and
// @mentions reach the SAME core as web/WhatsApp (generateTurnReply), and the Slack
// user's verified identity flows through resolveIdentity so the bot can act as them.
//
// A thin transport: verify the request → classify → map identity → run the core →
// post the reply. All the vettable logic lives in _shared/slack.ts.
//
// SETUP (when a workspace is ready):
//   • Create a Slack app. Scopes (bot): chat:write, users:read, users:read.email,
//     app_mentions:read, im:history, im:read, im:write.
//   • Event subscriptions Request URL → this function's URL. Subscribe to bot events:
//     message.im, app_mention.
//   • Env on this function: SLACK_SIGNING_SECRET (the app's Signing Secret).
//   • After install, insert a row in slack_installs: { team_id, store_id, bot_token }.
//     (An OAuth callback can populate this automatically later.)
import { serviceClient } from "../_shared/supabase.ts";
import { getStoreById } from "../_shared/config.ts";
import { generateTurnReply } from "../_shared/conversation.ts";
import { resolveIdentity } from "../_shared/identity.ts";
import { splitBubbles } from "../_shared/prompt.ts";
import { buildRawIdentity, chunkForSlack, classifyInbound, slackSessionId, verifySlackSignature } from "../_shared/slack.ts";
import { slackPostMessage, slackUserInfo } from "../_shared/slack-api.ts";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const rawBody = await req.text();
  const ts = req.headers.get("x-slack-request-timestamp") ?? "";
  const sig = req.headers.get("x-slack-signature") ?? "";
  const signingSecret = Deno.env.get("SLACK_SIGNING_SECRET") ?? "";
  if (!await verifySlackSignature(signingSecret, ts, rawBody, sig)) {
    return new Response("invalid signature", { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  // Setup handshake — echo the challenge (already signature-verified above).
  if (body.type === "url_verification") return json({ challenge: body.challenge });

  // Ack within Slack's 3s window; do the slow work (LLM + post) in the background.
  const work = handleEvent(body).catch((e) => console.error("[slack] handleEvent:", e));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
  else await work;
  return new Response("ok", { status: 200 });
});

async function handleEvent(body: Record<string, unknown>): Promise<void> {
  const c = classifyInbound(body);
  if (!c.act || !c.event) {
    console.log(`[slack] ignore: ${c.reason}`);
    return;
  }
  const ev = c.event;
  const db = serviceClient();

  // Dedup: Slack retries any non-2xx / slow delivery. Insert-or-skip on event_id.
  if (ev.eventId) {
    const { error } = await db.from("slack_events").insert({ event_id: ev.eventId });
    if (error) {
      console.log(`[slack] duplicate event ${ev.eventId} — skipping`);
      return;
    }
  }

  // Which store owns this workspace?
  const { data: install } = await db
    .from("slack_installs")
    .select("store_id, bot_token")
    .eq("team_id", ev.teamId)
    .eq("active", true)
    .maybeSingle();
  const inst = install as { store_id?: string; bot_token?: string } | null;
  if (!inst?.store_id || !inst.bot_token) {
    console.warn(`[slack] no active install for team ${ev.teamId}`);
    return;
  }
  const store = await getStoreById(db, inst.store_id);
  if (!store) return;
  const botToken = inst.bot_token;

  // The channel already authenticated the user — look up their email (needs the
  // users:read.email scope), then resolve/JIT them through the shared identity path.
  const profile = await slackUserInfo(botToken, ev.user);
  const sessionId = slackSessionId(ev.teamId, ev.user);
  let visitor;
  if (store.access_control) {
    const raw = buildRawIdentity(ev.user, ev.teamId, profile?.email, profile?.name);
    const resolved = await resolveIdentity(db, store, sessionId, { channel: "slack", raw });
    if (resolved) visitor = resolved.visitor;
  }

  const nowIso = new Date().toISOString();
  const threadId = `thr_${sessionId}_${store.slug}`;
  // Persist the inbound so history works across turns (like web/WhatsApp).
  await db.from("thread_messages").insert({
    message_id: `msg_slack_${crypto.randomUUID()}`,
    thread_id: threadId,
    store_slug: store.slug,
    customer_phone: sessionId,
    direction: "inbound",
    sender: "customer",
    text: ev.text,
    kind: "message",
    created_at: nowIso,
  });

  const { text: reply } = await generateTurnReply(db, store, {
    sessionId,
    inboundText: ev.text,
    visitor,
  });
  const finalReply = reply || "Sorry, I had a brief hiccup — could you send that again?";

  // Send each bubble (further chunked to Slack's message limit) and persist it.
  for (const bubble of splitBubbles(finalReply)) {
    for (const chunk of chunkForSlack(bubble)) {
      const ok = await slackPostMessage(botToken, ev.channel, chunk);
      if (!ok) break;
      await db.from("thread_messages").insert({
        message_id: `msg_slack_out_${crypto.randomUUID()}`,
        thread_id: threadId,
        store_slug: store.slug,
        customer_phone: sessionId,
        direction: "outbound",
        sender: "agent",
        text: chunk,
        kind: "message",
        created_at: new Date().toISOString(),
      });
    }
  }
}
