// WhatsApp inbound webhook — Bot Phases 1–2.
//   GET  : Meta verification handshake (hub.challenge / verify token)
//   POST : signed inbound intake -> fast 200 ACK -> background:
//          route to store, dedup on wamid, persist to threads/thread_messages,
//          then hand off to the conversation core (history + Gemini + reply).
// Every write is service-role.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { serviceClient } from "../_shared/supabase.ts";
import { verifySignature } from "../_shared/signature.ts";
import { getStoreByPhoneNumberId } from "../_shared/config.ts";
import { handleConversation } from "../_shared/conversation.ts";
import type { Store, WaContact, WaMessage, WaWebhook } from "../_shared/types.ts";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

// Exported so tests can call it directly. Only bound to a server when this
// file is the entry point (import.meta.main) — importing it (e.g. in the test)
// does NOT start a server.
export async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // ── GET: Meta verification handshake ───────────────────────────────────────
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === Deno.env.get("WA_VERIFY_TOKEN")) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  // ── POST: verify signature over the RAW body ──────────────────────────────
  const raw = new Uint8Array(await req.arrayBuffer());
  const valid = await verifySignature(
    raw,
    req.headers.get("x-hub-signature-256"),
    Deno.env.get("WA_APP_SECRET") ?? "",
  );
  if (!valid) return new Response("invalid signature", { status: 401 });

  let payload: WaWebhook;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return new Response("bad json", { status: 400 });
  }

  // ACK fast (Meta retries on timeout/non-200); process in the background.
  const work = handlePayload(payload).catch((e) =>
    console.error("[webhook] process error:", e),
  );
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(work);
  } else {
    await work; // local/dev fallback
  }

  return new Response("ok", { status: 200 });
}

if (import.meta.main) Deno.serve(handler);

async function handlePayload(payload: WaWebhook): Promise<void> {
  const db = serviceClient();
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const phoneNumberId = value.metadata?.phone_number_id;
      const messages = value.messages ?? [];
      if (!phoneNumberId || messages.length === 0) continue; // statuses etc.

      const store = await getStoreByPhoneNumberId(db, phoneNumberId);
      if (!store) {
        console.warn(`[webhook] no active store for phone_number_id ${phoneNumberId}`);
        continue;
      }
      for (const msg of messages) {
        await handleMessage(db, store, phoneNumberId, msg, value.contacts ?? []);
      }
    }
  }
}

async function handleMessage(
  db: SupabaseClient,
  store: Store,
  phoneNumberId: string,
  msg: WaMessage,
  contacts: WaContact[],
): Promise<void> {
  const wamid = msg.id;
  const from = msg.from;
  if (!wamid || !from) return;

  const messageId = `msg_${wamid}`; // deterministic -> idempotent on retries
  const threadId = `thr_${from}_${store.slug}`;
  const text = extractText(msg);
  const customerName =
    contacts.find((c) => c.wa_id === from)?.profile?.name ?? null;
  const createdAt = msg.timestamp
    ? new Date(Number(msg.timestamp) * 1000).toISOString()
    : new Date().toISOString();

  // Ensure the thread exists / bump last activity. Partial upsert leaves
  // routing_state untouched (so an owner-handled thread stays owner-handled).
  await db.from("threads").upsert(
    {
      thread_id: threadId,
      store_slug: store.slug,
      customer_phone: from,
      customer_name: customerName,
      last_message_at: createdAt,
    },
    { onConflict: "thread_id" },
  );

  // Persist inbound (append-only). Idempotent: ignore-duplicates on message_id.
  const { data: inserted, error } = await db
    .from("thread_messages")
    .upsert(
      {
        message_id: messageId,
        thread_id: threadId,
        store_slug: store.slug,
        customer_phone: from,
        direction: "inbound",
        sender: "customer",
        text,
        wamid,
        kind: "message",
        created_at: createdAt,
      },
      { onConflict: "message_id", ignoreDuplicates: true },
    )
    .select("message_id");

  if (error) {
    console.error(`[webhook] persist ${wamid}: ${error.message}`);
    return;
  }
  if (!inserted || inserted.length === 0) {
    console.log(`[webhook] duplicate ${wamid} — already handled, skipping reply`);
    return; // Meta retry
  }

  console.log(`[webhook] ${store.slug} <- ${from}: ${text?.slice(0, 80)}`);

  // Phase 2: hand off to the conversation core (routing gate + Gemini + reply).
  await handleConversation(db, store, {
    threadId,
    sessionId: `wa_${from}`,
    customerPhone: from,
    phoneNumberId,
    inboundText: text ?? "",
    deviceType: "whatsapp",
  });
}

function extractText(msg: WaMessage): string {
  switch (msg.type) {
    case "text":
      return msg.text?.body ?? "";
    case "button":
      return msg.button?.text ?? "[button]";
    case "interactive":
      return (
        msg.interactive?.button_reply?.title ??
        msg.interactive?.list_reply?.title ??
        "[interactive]"
      );
    default:
      return `[${msg.type ?? "unsupported"}]`;
  }
}
