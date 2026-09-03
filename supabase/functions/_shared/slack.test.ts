// Slack core vetting — signature (against Slack's own published vector), event
// classification (never respond to bots/edits/loops), session keys, identity, and
// reply chunking. Pure functions, no network.
//
//   deno test --allow-env supabase/functions/_shared/slack.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildApprovalBlocks, buildRawIdentity, chunkForSlack, classifyInbound, parseInteraction, signState, slackSessionId, verifySlackSignature, verifyState } from "./slack.ts";

// ── Slack's documented example (api.slack.com/authentication/verifying-requests) ──
const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
const TS = "1531420618";
const BODY = "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c";
const SIG = "v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503";
const AT = Number(TS); // evaluate the replay window as if "now" == the signed time

Deno.test("signature: Slack's published vector verifies", async () => {
  assertEquals(await verifySlackSignature(SECRET, TS, BODY, SIG, AT), true);
});

Deno.test("signature: tampered body is rejected", async () => {
  assertEquals(await verifySlackSignature(SECRET, TS, BODY + "&x=1", SIG, AT), false);
});

Deno.test("signature: wrong secret is rejected", async () => {
  assertEquals(await verifySlackSignature("not-the-secret", TS, BODY, SIG, AT), false);
});

Deno.test("signature: stale timestamp is rejected (replay guard)", async () => {
  assertEquals(await verifySlackSignature(SECRET, TS, BODY, SIG, AT + 400), false);
});

Deno.test("signature: missing inputs are rejected", async () => {
  assertEquals(await verifySlackSignature("", TS, BODY, SIG, AT), false);
  assertEquals(await verifySlackSignature(SECRET, TS, BODY, "", AT), false);
  assertEquals(await verifySlackSignature(SECRET, TS, BODY, "deadbeef", AT), false); // no v0= prefix
});

// ── Event classification ──
const wrap = (event: unknown, extra: Record<string, unknown> = {}) => ({ type: "event_callback", team_id: "T1", event_id: "Ev1", event, ...extra });

Deno.test("classify: a plain DM is answered", () => {
  const c = classifyInbound(wrap({ type: "message", user: "U1", channel: "D1", text: "hi there", channel_type: "im" }));
  assertEquals(c.act, true);
  assertEquals(c.event?.text, "hi there");
  assertEquals(c.event?.user, "U1");
  assertEquals(c.event?.teamId, "T1");
  assertEquals(c.event?.eventId, "Ev1");
});

Deno.test("classify: an @mention is answered with the bot mention stripped", () => {
  const c = classifyInbound(wrap({ type: "app_mention", user: "U1", channel: "C1", text: "<@U0BOT> what's my plan?" }));
  assertEquals(c.act, true);
  assertEquals(c.event?.text, "what's my plan?");
  assertEquals(c.event?.isMention, true);
});

Deno.test("classify: a bot's own message is ignored (no loops)", () => {
  assertEquals(classifyInbound(wrap({ type: "message", user: "U1", channel: "D1", text: "hi", bot_id: "B1" })).act, false);
});

Deno.test("classify: edits/deletes and other subtypes are ignored", () => {
  assertEquals(classifyInbound(wrap({ type: "message", subtype: "message_changed", channel: "D1", text: "x" })).act, false);
});

Deno.test("classify: empty text is ignored", () => {
  assertEquals(classifyInbound(wrap({ type: "message", user: "U1", channel: "D1", text: "   " })).act, false);
});

Deno.test("classify: non-event_callback payloads are ignored", () => {
  assertEquals(classifyInbound({ type: "url_verification", challenge: "abc" }).act, false);
  assertEquals(classifyInbound({}).act, false);
  assertEquals(classifyInbound(null).act, false);
});

// ── Session, identity, chunking ──
Deno.test("session id is stable and namespaced", () => {
  assertEquals(slackSessionId("T1", "U9"), "slack_T1_U9");
});

Deno.test("raw identity: email is the join key, slack user id is the sub", () => {
  const r = buildRawIdentity("U9", "T1", "ada@acme.com", "Ada Lovelace");
  assertEquals(r.email, "ada@acme.com");
  assertEquals(r.sub, "U9");
  assertEquals(r.name, "Ada Lovelace");
  assertEquals(r.rawToken, null);
});

Deno.test("chunking: short text stays one message", () => {
  assertEquals(chunkForSlack("just a short reply"), ["just a short reply"]);
  assertEquals(chunkForSlack("   "), []);
});

Deno.test("chunking: long text splits into <= limit pieces on boundaries", () => {
  const long = Array.from({ length: 400 }, (_, i) => `line ${i} with some words here`).join("\n");
  const parts = chunkForSlack(long, 1000);
  assert(parts.length > 1, "should split");
  for (const p of parts) assert(p.length <= 1000, `chunk within limit (was ${p.length})`);
  assert(parts.join(" ").includes("line 399"), "keeps all content");
});

// ── OAuth state signing (install can't be spoofed to another store) ──
const STATE_SECRET = "state-secret-xyz";

Deno.test("state: round-trips to the store id", async () => {
  const s = await signState(STATE_SECRET, "store-123", 600);
  assertEquals(await verifyState(STATE_SECRET, s), "store-123");
});

Deno.test("state: wrong secret is rejected", async () => {
  const s = await signState(STATE_SECRET, "store-123", 600);
  assertEquals(await verifyState("other-secret", s), null);
});

Deno.test("state: tampered payload is rejected", async () => {
  const s = await signState(STATE_SECRET, "store-123", 600);
  const [, sig] = s.split(".");
  const forged = btoa(JSON.stringify({ s: "store-999", exp: Math.floor(Date.now() / 1000) + 600 })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assertEquals(await verifyState(STATE_SECRET, `${forged}.${sig}`), null);
});

Deno.test("state: expired is rejected", async () => {
  const s = await signState(STATE_SECRET, "store-123", 600);
  assertEquals(await verifyState(STATE_SECRET, s, Date.now() / 1000 + 900), null);
});

Deno.test("state: junk is rejected", async () => {
  assertEquals(await verifyState(STATE_SECRET, "notatoken", ), null);
  assertEquals(await verifyState(STATE_SECRET, "", ), null);
});

// ── Approval buttons (governance in Slack) ──
Deno.test("approval message: Approve/Decline buttons carry the request id", () => {
  const { text, blocks } = buildApprovalBlocks({ id: "req-77", detail: "refund_order — order: 7742", orgName: "Acme", actedAs: "ada@acme.com" });
  assert(text.includes("Acme"));
  // deno-lint-ignore no-explicit-any
  const actions = (blocks as any[]).find((b) => b.type === "actions");
  assertEquals(actions.elements.map((e: { action_id: string }) => e.action_id), ["approve", "decline"]);
  assertEquals(actions.elements[0].value, "req-77");
  assertEquals(actions.elements[1].value, "req-77");
});

Deno.test("interaction: an Approve click parses to a decision + request id + user", () => {
  const p = parseInteraction({
    type: "block_actions",
    user: { name: "manager.jo" },
    response_url: "https://hooks.slack.com/actions/x",
    actions: [{ action_id: "approve", value: "req-77" }],
  });
  assertEquals(p?.decision, "approved");
  assertEquals(p?.actionRequestId, "req-77");
  assertEquals(p?.userName, "manager.jo");
  assertEquals(p?.responseUrl, "https://hooks.slack.com/actions/x");
});

Deno.test("interaction: a Decline click parses to declined", () => {
  const p = parseInteraction({ type: "block_actions", user: { id: "U1" }, actions: [{ action_id: "decline", value: "req-9" }] });
  assertEquals(p?.decision, "declined");
  assertEquals(p?.actionRequestId, "req-9");
});

Deno.test("interaction: unrelated payloads are ignored", () => {
  assertEquals(parseInteraction({ type: "view_submission" }), null);
  assertEquals(parseInteraction({ type: "block_actions", actions: [{ action_id: "something_else", value: "x" }] }), null);
  assertEquals(parseInteraction({ type: "block_actions", actions: [{ action_id: "approve" }] }), null); // no value
  assertEquals(parseInteraction(null), null);
});
