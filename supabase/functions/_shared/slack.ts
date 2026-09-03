// Slack front-door — the pure, testable core. The edge function (slack-events) is a
// thin I/O shell around these: verify the request, classify the event, map identity,
// chunk the reply. Kept side-effect-free so it can be vetted without a live workspace.
import type { RawIdentity } from "./identity.ts";

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
function hex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
/** Length-independent constant-time compare (both are hex strings of equal length). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verify a Slack request signature (v0 scheme) with a 5-minute replay window.
 *  base = "v0:{timestamp}:{rawBody}"; signature = "v0=" + HMAC-SHA256(secret, base). */
export async function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
  nowSec: number = Date.now() / 1000,
): Promise<boolean> {
  if (!signingSecret || !timestamp || !signature || !signature.startsWith("v0=")) return false;
  const ts = Number(timestamp);
  if (!isFinite(ts) || Math.abs(nowSec - ts) > 300) return false; // stale/replayed
  const key = await crypto.subtle.importKey("raw", enc(signingSecret) as unknown as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc(`v0:${timestamp}:${rawBody}`) as unknown as BufferSource);
  return timingSafeEqual("v0=" + hex(new Uint8Array(mac)), signature);
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc(secret) as unknown as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc(msg) as unknown as BufferSource);
  return hex(new Uint8Array(mac));
}
function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): string {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

/** Sign the OAuth `state` so the install callback can trust which store started it —
 *  base64url({s: storeId, exp}) + "." + HMAC-SHA256. */
export async function signState(secret: string, storeId: string, ttlSec = 600): Promise<string> {
  const payload = b64url(JSON.stringify({ s: storeId, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  return payload + "." + await hmacHex(secret, payload);
}

/** Verify a signed OAuth state → the store id, or null (bad signature / expired). */
export async function verifyState(secret: string, state: string, nowSec: number = Date.now() / 1000): Promise<string | null> {
  if (!secret || !state) return null;
  const i = state.lastIndexOf(".");
  if (i <= 0) return null;
  const payload = state.slice(0, i);
  if (state.slice(i + 1) !== await hmacHex(secret, payload)) return null;
  try {
    const p = JSON.parse(b64urlDecode(payload));
    if (p.exp && nowSec > Number(p.exp)) return null;
    return p.s ? String(p.s) : null;
  } catch {
    return null;
  }
}

export interface SlackInbound {
  text: string;
  user: string;
  channel: string;
  teamId: string;
  channelType?: string;
  eventId?: string;
  isMention: boolean;
}

/** Decide whether an Events-API payload is a user message we should answer, and
 *  extract the normalized inbound. Ignores bot messages, edits/deletes/other
 *  subtypes, and non-message events — so the bot never talks to itself or loops. */
// deno-lint-ignore no-explicit-any
export function classifyInbound(body: any): { act: boolean; reason: string; event?: SlackInbound } {
  if (!body || typeof body !== "object") return { act: false, reason: "no body" };
  if (body.type !== "event_callback") return { act: false, reason: `type=${body.type}` };
  const e = body.event;
  if (!e || (e.type !== "message" && e.type !== "app_mention")) return { act: false, reason: `event=${e?.type}` };
  if (e.bot_id || e.subtype) return { act: false, reason: "bot/subtype" }; // never respond to bots or edits
  const user = String(e.user ?? "");
  const channel = String(e.channel ?? "");
  // app_mention text carries the leading <@BOT> — strip it.
  const text = String(e.text ?? "").replace(/^\s*<@[^>]+>\s*/, "").trim();
  if (!user || !text || !channel) return { act: false, reason: "missing user/text/channel" };
  return {
    act: true,
    reason: "ok",
    event: {
      text,
      user,
      channel,
      teamId: String(body.team_id ?? e.team ?? ""),
      channelType: e.channel_type ? String(e.channel_type) : undefined,
      eventId: body.event_id ? String(body.event_id) : undefined,
      isMention: e.type === "app_mention",
    },
  };
}

/** Stable per-user session key for a Slack workspace. */
export function slackSessionId(teamId: string, userId: string): string {
  return `slack_${teamId}_${userId}`;
}

/** The channel already authenticated this user — hand the verified identity straight
 *  to resolveIdentity. Email is the join key; the Slack user id is the stable sub. */
export function buildRawIdentity(userId: string, _teamId: string, email?: string | null, name?: string | null): RawIdentity {
  return { email: email ?? null, phone: null, name: name ?? null, sub: userId, rawToken: null };
}

/** Split a reply to fit Slack's per-message limit (~4000 chars), breaking on a
 *  newline or space near the cut rather than mid-word. */
export function chunkForSlack(text: string, max = 3800): string[] {
  const t = (text ?? "").trim();
  if (!t) return [];
  if (t.length <= max) return [t];
  const out: string[] = [];
  let rem = t;
  while (rem.length > max) {
    let cut = rem.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rem.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    out.push(rem.slice(0, cut).trim());
    rem = rem.slice(cut).trim();
  }
  if (rem) out.push(rem);
  return out;
}
