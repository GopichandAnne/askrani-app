// Give-and-get referral: links, click tracking, attribution.
//
// The initiator gets a per-campaign code that survives every WhatsApp forward.
// We never see the forward — only the CLICK on the code (logged, 24h-deduped)
// and the downstream chat/order, which we attribute back to the initiator.
// Reward accrues on the recipient's REAL net order value (see rewards.ts).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import { accrueReferralReward, computeAmountCents, type RewardRule } from "./rewards.ts";
import { resolveMember } from "./members.ts";

const WEB_BASE = "https://askrani.ai";
const RULE_COLS = "id, amount_model, amount_cents, percent_bps, tiers, min_order_cents";

// ── code + WhatsApp marker ───────────────────────────────────────────────────
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I ambiguity
function genCode(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return [...b].map((x) => CODE_ALPHABET[x % 32]).join("");
}
const REF_TAG = /\[ref:([0-9A-Z]{6,14})\]/i;
/** Marker embedded in a wa.me prefilled message so the webhook can attribute it. */
export function embedRefTag(code: string): string {
  return `[ref:${code}]`;
}
export function parseRefTag(text: string | null | undefined): string | null {
  const m = (text ?? "").match(REF_TAG);
  return m ? m[1].toUpperCase() : null;
}

export function trackedUrl(code: string): string {
  return `${WEB_BASE}/r/${code}`;
}

// ── link creation ────────────────────────────────────────────────────────────
/** One link per (campaign, initiator). Idempotent: returns the existing row, or
 *  mints a fresh code (retrying on the rare code collision). */
export type ReferralLink = { id: string; code: string; card_image_ref: string | null };

export async function getOrCreateReferralLink(
  db: SupabaseClient,
  args: { campaignId: string; initiatorMemberId: string; destinationType?: "wa_deeplink" | "web_chat" },
): Promise<ReferralLink> {
  const existing = await db
    .from("referral_links")
    .select("id, code, card_image_ref")
    .eq("campaign_id", args.campaignId)
    .eq("initiator_member_id", args.initiatorMemberId)
    .maybeSingle();
  if (existing.data) return existing.data as ReferralLink;

  for (let i = 0; i < 5; i++) {
    const { data, error } = await db
      .from("referral_links")
      .insert({
        campaign_id: args.campaignId,
        initiator_member_id: args.initiatorMemberId,
        code: genCode(),
        destination_type: args.destinationType ?? "wa_deeplink",
      })
      .select("id, code, card_image_ref")
      .single();
    if (!error) return data as ReferralLink;
    // Unique violation: either the code clashed (retry) or the (campaign,member)
    // pair already exists from a race — re-fetch and use it.
    const again = await db
      .from("referral_links")
      .select("id, code, card_image_ref")
      .eq("campaign_id", args.campaignId)
      .eq("initiator_member_id", args.initiatorMemberId)
      .maybeSingle();
    if (again.data) return again.data as ReferralLink;
  }
  throw new Error("could not create referral link");
}

// ── destination (where the click lands) ──────────────────────────────────────
/** Prefer WhatsApp (the card is forwarded there); fall back to web chat. The
 *  recipient lands in a conversation already carrying the referral code. */
async function buildDestination(
  db: SupabaseClient,
  store: { id: string; slug: string },
  code: string,
  shareText?: string | null,
): Promise<string> {
  const { data: s } = await db
    .from("stores")
    .select("whatsapp_display_number")
    .eq("id", store.id)
    .maybeSingle();
  const waNum = (s?.whatsapp_display_number ?? "").replace(/\D/g, "");
  if (waNum) {
    const msg = `${shareText ? shareText + " " : "Hi! I got a deal to share "}${embedRefTag(code)}`;
    return `https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`;
  }
  // Web fallback: needs a valid primary visitor token.
  const { data: tok } = await db
    .from("store_tokens")
    .select("token")
    .eq("store_id", store.id)
    .eq("active", true)
    .is("listing_ref", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const base = `${WEB_BASE}/s/${store.slug}?ref=${code}`;
  return tok?.token ? `${base}&t=${tok.token}` : base;
}

// ── click resolution (called by the /r/<code> resolver) ──────────────────────
/** Resolve a code to its landing URL and log the click (24h-deduped). Returns
 *  the store homepage for an unknown/dead code — never an error page. */
export async function resolveReferralClick(
  db: SupabaseClient,
  code: string,
  ctx: { dedupeHash?: string | null; geoCity?: string | null },
): Promise<{ destination: string }> {
  const { data: link } = await db
    .from("referral_links")
    .select("id, campaign_id, reward_campaigns!inner(store_id)")
    .eq("code", code)
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  const storeId = (link as any)?.reward_campaigns?.store_id as string | undefined;
  if (!link || !storeId) return { destination: WEB_BASE };

  const { data: store } = await db
    .from("stores")
    .select("id, slug, whatsapp_display_number")
    .eq("id", storeId)
    .maybeSingle();
  if (!store) return { destination: WEB_BASE };

  // 24h rolling dedup: one rewarded click per (link, device) per day.
  if (ctx.dedupeHash) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: recent } = await db
      .from("attribution_events")
      .select("id")
      .eq("referral_link_id", link.id)
      .eq("type", "link_click")
      .eq("dedupe_hash", ctx.dedupeHash)
      .gte("occurred_at", since)
      .limit(1)
      .maybeSingle();
    if (!recent) {
      await db.from("attribution_events").insert({
        campaign_id: link.campaign_id,
        referral_link_id: link.id,
        type: "link_click",
        dedupe_hash: ctx.dedupeHash,
        geo_city: ctx.geoCity ?? null,
      });
    }
  }

  const destination = await buildDestination(db, store, code);
  return { destination };
}

// ── capture: the recipient lands & chats ─────────────────────────────────────
/** A recipient arrived via a referral code. Bind them to the initiator
 *  (first-referrer wins, never self-referral) and log chat_started. Best-effort:
 *  a failure here must never break the chat. */
export async function captureReferral(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  code: string,
): Promise<void> {
  const { data: link } = await db
    .from("referral_links")
    .select("id, campaign_id, initiator_member_id, reward_campaigns!inner(store_id)")
    .eq("code", code)
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  if (!link || (link as any).reward_campaigns?.store_id !== store.id) return;

  // Resolve or lightly provision the recipient contact.
  let recipientId: string | null = null;
  const resolved = await resolveMember(db, store, sessionId);
  if (resolved?.id) {
    recipientId = resolved.id;
  } else if (sessionId.startsWith("wa_")) {
    const phone = sessionId.slice(3);
    const ins = await db
      .from("store_members")
      .insert({ store_id: store.id, phone })
      .select("id")
      .maybeSingle();
    // On a race/dup (unique phone) the insert returns no row -> re-resolve.
    recipientId = ins.data?.id ?? (await resolveMember(db, store, sessionId))?.id ?? null;
  }

  // Log the chat_started (recipient may still be null for anon web).
  await db.from("attribution_events").insert({
    campaign_id: link.campaign_id,
    referral_link_id: link.id,
    member_id: recipientId,
    type: "chat_started",
  });

  if (!recipientId || recipientId === link.initiator_member_id) return; // self-referral / unknown

  // First-referrer wins: only set referred_by if not already attributed.
  const { data: cur } = await db
    .from("store_members")
    .select("referred_by")
    .eq("id", recipientId)
    .maybeSingle();
  if (cur && cur.referred_by == null) {
    await db.from("store_members")
      .update({ referred_by: link.initiator_member_id })
      .eq("id", recipientId);
  }
}

// ── attribution: the recipient orders ────────────────────────────────────────
type ActiveRule = { campaignId: string; rule: RewardRule };

async function activeReferralRule(
  db: SupabaseClient,
  storeId: string,
  trigger: "referral_first_order" | "referral_order",
): Promise<ActiveRule | null> {
  const { data } = await db
    .from("reward_rules")
    .select(`${RULE_COLS}, campaign_id, reward_campaigns!inner(id, status, store_id)`)
    .eq("trigger", trigger)
    .eq("reward_campaigns.store_id", storeId)
    .eq("reward_campaigns.status", "active")
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  // deno-lint-ignore no-explicit-any
  const d = data as any;
  return { campaignId: d.campaign_id, rule: d as RewardRule };
}

/** On a placed order, if the buyer was referred, accrue the initiator's reward
 *  on the net order value. Idempotent per order. Best-effort — never throws into
 *  the order path. */
export async function attributeReferralOrder(
  db: SupabaseClient,
  store: Store,
  args: { sessionId: string; orderId: string; netCents: number },
): Promise<{ attributed: boolean; amountCents?: number; status?: string }> {
  const recipient = await resolveMember(db, store, args.sessionId);
  if (!recipient?.id) return { attributed: false };

  const { data: mem } = await db
    .from("store_members")
    .select("referred_by")
    .eq("id", recipient.id)
    .maybeSingle();
  const initiator = mem?.referred_by as string | null | undefined;
  if (!initiator) return { attributed: false };

  // First attributed order vs a repeat.
  const { data: prior } = await db
    .from("attribution_events")
    .select("id")
    .eq("member_id", recipient.id)
    .in("type", ["first_order", "repeat_order"])
    .limit(1)
    .maybeSingle();
  const isFirst = !prior;
  const active = await activeReferralRule(db, store.id, isFirst ? "referral_first_order" : "referral_order")
    // fall back to the first-order rule if no repeat rule is configured
    ?? (isFirst ? null : await activeReferralRule(db, store.id, "referral_first_order"));
  if (!active) return { attributed: false };

  const amountCents = computeAmountCents(active.rule, { netOrderCents: args.netCents });

  // Always record the funnel event (even a below-min order is real attribution).
  await db.from("attribution_events").insert({
    campaign_id: active.campaignId,
    member_id: recipient.id,
    type: isFirst ? "first_order" : "repeat_order",
  });

  if (amountCents <= 0) return { attributed: true, amountCents: 0, status: "below_min" };

  const res = await accrueReferralReward(db, {
    storeId: store.id,
    campaignId: active.campaignId,
    initiatorMemberId: initiator,
    sourceOrderId: args.orderId,
    amountCents,
    sourceType: "referral_order",
  });
  return { attributed: true, amountCents, status: res.status };
}
