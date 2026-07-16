// web-chat — public web chat transport (Bot Phase 4).
//
// The browser at askrani.ai/s/<slug> POSTs a message here. This is a thin
// transport around the SAME core as WhatsApp (generateTurnReply): it persists
// the turn, runs the full toolset (search, knowledge, cart, escalate, ...) and
// returns the reply synchronously — no WhatsApp send.
//
// Public but gated: verify_jwt stays on, so the browser must send the project
// anon key (a valid JWT). Plus a per-session rate limit as an abuse backstop.

import { serviceClient } from "../_shared/supabase.ts";
import { getStoreBySlug } from "../_shared/config.ts";
import { generateTurnReply } from "../_shared/conversation.ts";
import { classifyTurn } from "../_shared/analytics.ts";
import { splitBubbles } from "../_shared/prompt.ts";
import { storeChatFile, storeChatImage } from "../_shared/chat-media.ts";
import {
  bindMemberSession,
  findMemberByIdentity,
  provisionMember,
  verifyIdentityToken,
} from "../_shared/members.ts";
import {
  cancelFollowup,
  getFollowupSettings,
  isLikelyClosing,
  scheduleFollowup,
} from "../_shared/followup.ts";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_MSG_LEN = 1000;
const MAX_IMAGE_B64 = 3_500_000; // ~2.6 MB decoded — client downscales before sending
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20; // inbound messages per session per minute

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const slug = String(body.slug ?? "").trim();
  const token = String(body.token ?? "").trim();
  const sessionId = String(body.session_id ?? "").trim();
  const message = String(body.message ?? "").trim().slice(0, MAX_MSG_LEN);

  // Optional inbound photo (base64) — the model sees it (Gemini vision).
  let image: { base64: string; mime: string } | undefined;
  const rawImage = body.image as { base64?: string; mime?: string } | undefined;
  if (rawImage?.base64 && typeof rawImage.base64 === "string") {
    if (rawImage.base64.length > MAX_IMAGE_B64) {
      return json({ error: "That image is too large — please send a smaller photo." }, 413);
    }
    image = { base64: rawImage.base64, mime: String(rawImage.mime ?? "image/jpeg") };
  }

  // Optional inbound document (résumé, etc.) — stored, then a parse connector
  // reads it via its signed URL. Owner-gated by the request type's upload config.
  let file: { base64: string; mime: string; name: string } | undefined;
  const rawFile = body.file as { base64?: string; mime?: string; name?: string } | undefined;
  if (rawFile?.base64 && typeof rawFile.base64 === "string") {
    if (rawFile.base64.length > MAX_IMAGE_B64) {
      return json({ error: "That file is too large — please upload one under ~2.5 MB." }, 413);
    }
    file = {
      base64: rawFile.base64,
      mime: String(rawFile.mime ?? "application/octet-stream"),
      name: String(rawFile.name ?? "document").slice(0, 120),
    };
  }

  if (!slug || !sessionId || (!message && !image && !file)) {
    return json({ error: "slug, session_id and a message, image or file are required" }, 400);
  }
  if (!sessionId.startsWith("web_")) return json({ error: "invalid session" }, 400);

  const db = serviceClient();
  const store = await getStoreBySlug(db, slug);
  if (!store) return json({ error: "unknown store" }, 404);

  // Validate the visitor token server-side (the client check is not enough).
  const { data: tok } = await db
    .from("store_tokens")
    .select("id, active, listing_ref, listing_context")
    .eq("store_id", store.id)
    .eq("token", token)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .limit(1);
  const tokRow = tok?.[0] as
    | { active: boolean; listing_ref: string | null; listing_context: string | null }
    | undefined;
  const isListingTok = !!tokRow?.listing_ref;
  // Primary tokens must be active; retired listing tokens still launch (to show
  // similar homes). A missing row or an inactive primary token is a dead link.
  if (!tokRow || (!tokRow.active && !isListingTok)) {
    return json({ error: "This session link is invalid or expired — please scan the QR again." }, 403);
  }
  // A listing-scoped ("smart yard sign") token primes the conversation on one
  // listing. When retired (sold / off-market), it pivots to similar listings.
  const activeListing = isListingTok ? (tokRow.listing_context ?? undefined) : undefined;
  const listingRetired = isListingTok && !tokRow.active;

  // Break mode: the store paused its web chat — do nothing, just say so.
  const { data: pausedRow } = await db
    .from("stores")
    .select("web_chat_paused")
    .eq("id", store.id)
    .single();
  if (pausedRow?.web_chat_paused) {
    return json({
      reply:
        "🌙 Rani is taking a break right now and will be back soon. In the meantime, please ask a store associate for help. Thanks for your patience!",
      paused: true,
    });
  }

  const threadId = `thr_${sessionId}_${store.slug}`;

  // ── Rate limit: inbound messages in the last minute for this session. ──
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count } = await db
    .from("thread_messages")
    .select("message_id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .eq("direction", "inbound")
    .gte("created_at", since);
  if ((count ?? 0) >= RATE_MAX) {
    return json({ error: "You're sending messages very fast — please slow down a moment." }, 429);
  }

  // Embedded SSO: if the host site passed a signed identity token, verify it and
  // bind this session to the matching member — the store's own login drives it,
  // no separate login from us. (Best-effort; failure just leaves them anonymous.)
  const identityToken = typeof body.identity_token === "string" ? body.identity_token : "";
  if (identityToken && store.access_control && (store as { identity_secret?: string | null }).identity_secret) {
    const claim = await verifyIdentityToken((store as { identity_secret?: string | null }).identity_secret, identityToken);
    if (claim && (claim.email || claim.phone)) {
      // Find the member, or JIT-provision them from the verified token (so a
      // property manager's portal drives the directory with no upload).
      let m = await findMemberByIdentity(db, store.id, claim.email, claim.phone);
      if (!m) m = await provisionMember(db, store.id, claim);
      if (m) await bindMemberSession(db, sessionId, store.id, m.id);
    }
  }

  const now = new Date().toISOString();

  // If the customer attached a photo, store it so staff can see it in the panel
  // later (best-effort — the model already receives the image regardless).
  const inboundMediaUrl = image
    ? await storeChatImage(db, store, sessionId, image.base64, image.mime)
    : null;
  // Store an uploaded document and get a signed URL the parse connector can fetch.
  const fileUrl = file
    ? await storeChatFile(db, store, sessionId, file.base64, file.mime)
    : null;

  // ── Persist the thread + inbound message (customer_phone stands in as the web id). ──
  await db.from("threads").upsert(
    { thread_id: threadId, store_slug: store.slug, customer_phone: sessionId, last_message_at: now },
    { onConflict: "thread_id" },
  );
  await db.from("thread_messages").insert({
    message_id: `msg_web_${crypto.randomUUID()}`,
    thread_id: threadId,
    store_slug: store.slug,
    customer_phone: sessionId,
    direction: "inbound",
    sender: "customer",
    text: message || (file ? `[uploaded ${file.name}]` : "[photo]"),
    media_url: inboundMediaUrl ?? fileUrl,
    kind: "message",
    created_at: now,
  });

  // The customer just replied — clear any pending silence check-back (a fresh
  // one is scheduled after this reply if the chat is still open).
  await cancelFollowup(db, store.id, sessionId);

  // ── Generate the reply with the full toolset (identical to WhatsApp). ──
  const startedAt = Date.now();
  const { text: reply, toolsUsed, catalogView } = await generateTurnReply(db, store, {
    sessionId,
    inboundText: message || (file ? `[uploaded a file: ${file.name}]` : "[photo]"),
    image,
    document: file && fileUrl ? { url: fileUrl, name: file.name, mime: file.mime } : undefined,
    activeListing,
    listingRetired,
  });
  const responseTimeMs = Date.now() - startedAt;
  const finalReply = reply || "Sorry, I had a brief hiccup — could you send that again? 🙏";

  // ── Persist outbound + conversation. ──
  // The reply may be a few short messages (model marks breaks with ---). Persist
  // each as its own bubble; the client renders them one at a time, and Realtime
  // echoes dedupe by message_id.
  const bubbles = splitBubbles(finalReply);
  const replies: { text: string; message_id: string }[] = [];
  for (const part of bubbles) {
    const mid = `msg_web_out_${crypto.randomUUID()}`;
    replies.push({ text: part, message_id: mid });
    await db.from("thread_messages").insert({
      message_id: mid,
      thread_id: threadId,
      store_slug: store.slug,
      customer_phone: sessionId,
      direction: "outbound",
      sender: "agent",
      text: part,
      kind: "message",
      created_at: new Date().toISOString(),
    });
  }
  await db.from("threads").update({ last_message_at: new Date().toISOString() }).eq(
    "thread_id",
    threadId,
  );

  // Schedule a single silence check-back unless the customer is clearly wrapping up.
  try {
    const fu = await getFollowupSettings(db, store.id);
    if (fu.enabled && !isLikelyClosing(message) && !isLikelyClosing(finalReply)) {
      await scheduleFollowup(db, {
        storeId: store.id,
        storeSlug: store.slug,
        sessionId,
        channel: "web",
        threadId,
        customerRef: sessionId,
        minutes: fu.minutes,
      });
    }
  } catch (e) {
    console.error("[web-chat] followup schedule:", e);
  }

  const conversationId = `web-${crypto.randomUUID()}`;
  await db.from("conversations").insert({
    conversation_id: conversationId,
    store_slug: store.slug,
    session_id: sessionId,
    timestamp: now,
    user_message: message,
    assistant_response: finalReply,
    response_time_ms: responseTimeMs,
    device_type: "web",
    analytics_json: JSON.stringify({}),
    synced_to_master: false,
  });

  // Enrich analytics after replying — never blocks the response.
  const enrich = classifyTurn(message, finalReply)
    .then((a) =>
      db.from("conversations").update({ analytics_json: JSON.stringify(a) }).eq(
        "conversation_id",
        conversationId,
      )
    )
    .catch((e) => console.error("[web-chat] analytics:", e));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(enrich);

  return json({
    // Multi-bubble: the client renders these in order. `reply`/`message_id` kept
    // for backward compatibility (first bubble).
    replies,
    reply: replies[0]?.text ?? finalReply,
    message_id: replies[0]?.message_id,
    toolsUsed,
    // Set when the assistant opened a filtered catalogue view for this turn.
    ...(catalogView ? { catalog_view: catalogView } : {}),
  });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
