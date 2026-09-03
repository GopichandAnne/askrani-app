// teams-messages — Microsoft Teams front door (Bot Framework messaging endpoint).
// Rani as a teammate in Teams: DMs + @mentions reach the same core (generateTurnReply)
// and the user's Azure AD identity flows through resolveIdentity.
//
// SETUP (when an Azure bot is ready):
//   • Azure Bot resource + an app registration (client id + secret).
//   • Messaging endpoint → this function's URL. Add the Teams channel.
//   • Graph app permission User.Read.All (+ admin consent) if you want email identity.
//   • Env: MICROSOFT_APP_ID, MICROSOFT_APP_PASSWORD.
//   • Map the tenant to a store: a teams_installs row { tenant_id, store_id } (set from
//     the console's Teams card).
import { serviceClient } from "../_shared/supabase.ts";
import { getStoreById } from "../_shared/config.ts";
import { generateTurnReply } from "../_shared/conversation.ts";
import { resolveIdentity } from "../_shared/identity.ts";
import { splitBubbles } from "../_shared/prompt.ts";
import { buildTeamsRawIdentity, classifyActivity, teamsSessionId } from "../_shared/teams.ts";
import { graphEmail, postTeamsReply, verifyBotFrameworkToken } from "../_shared/teams-auth.ts";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const appId = Deno.env.get("MICROSOFT_APP_ID") ?? "";
  const appPassword = Deno.env.get("MICROSOFT_APP_PASSWORD") ?? "";

  // Verify the request really came from Bot Framework (Bearer JWT vs their JWKS).
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  const claims = await verifyBotFrameworkToken(token, appId);
  if (!claims) return new Response("unauthorized", { status: 401 });

  let activity: Record<string, unknown>;
  try {
    activity = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const work = handleActivity(activity, appId, appPassword).catch((e) => console.error("[teams] handleActivity:", e));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
  else await work;
  return new Response(null, { status: 200 });
});

async function handleActivity(activity: Record<string, unknown>, appId: string, appPassword: string): Promise<void> {
  const c = classifyActivity(activity);
  if (!c.act || !c.event) {
    console.log(`[teams] ignore: ${c.reason}`);
    return;
  }
  const ev = c.event;
  const db = serviceClient();

  // Dedup by activity id.
  if (ev.activityId) {
    const { error } = await db.from("teams_events").insert({ activity_id: ev.activityId });
    if (error) {
      console.log(`[teams] duplicate activity ${ev.activityId} — skipping`);
      return;
    }
  }

  // Tenant → store.
  const { data: install } = await db
    .from("teams_installs")
    .select("store_id")
    .eq("tenant_id", ev.tenantId)
    .eq("active", true)
    .maybeSingle();
  const storeId = (install as { store_id?: string } | null)?.store_id;
  if (!storeId) {
    console.warn(`[teams] no install for tenant ${ev.tenantId}`);
    return;
  }
  const store = await getStoreById(db, storeId);
  if (!store) return;

  const sessionId = teamsSessionId(ev.tenantId, ev.aadObjectId, ev.userId);
  let visitor;
  if (store.access_control) {
    const email = await graphEmail(appId, appPassword, ev.tenantId, ev.aadObjectId);
    const raw = buildTeamsRawIdentity(ev.aadObjectId, ev.userId, ev.name, email);
    const resolved = await resolveIdentity(db, store, sessionId, { channel: "teams", raw });
    if (resolved) visitor = resolved.visitor;
  }

  const threadId = `thr_${sessionId}_${store.slug}`;
  await db.from("thread_messages").insert({
    message_id: `msg_teams_${crypto.randomUUID()}`,
    thread_id: threadId,
    store_slug: store.slug,
    customer_phone: sessionId,
    direction: "inbound",
    sender: "customer",
    text: ev.text,
    kind: "message",
    created_at: new Date().toISOString(),
  });

  const { text: reply } = await generateTurnReply(db, store, { sessionId, inboundText: ev.text, visitor });
  const finalReply = reply || "Sorry, I had a brief hiccup — could you send that again?";

  for (const bubble of splitBubbles(finalReply)) {
    const ok = await postTeamsReply(appId, appPassword, ev.serviceUrl, ev.conversationId, bubble);
    if (!ok) break;
    await db.from("thread_messages").insert({
      message_id: `msg_teams_out_${crypto.randomUUID()}`,
      thread_id: threadId,
      store_slug: store.slug,
      customer_phone: sessionId,
      direction: "outbound",
      sender: "agent",
      text: bubble,
      kind: "message",
      created_at: new Date().toISOString(),
    });
  }
}
