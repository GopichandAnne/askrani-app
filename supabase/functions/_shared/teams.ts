// Microsoft Teams front door — the pure, testable core (Bot Framework activity shape).
// The edge function (teams-messages) is a thin shell: verify the BF token, classify,
// resolve identity, run the core, post the reply.
import type { RawIdentity } from "./identity.ts";

export interface TeamsInbound {
  text: string;
  aadObjectId: string; // the user's Azure AD object id (stable) — the identity anchor
  userId: string; // Bot Framework from.id
  name: string;
  serviceUrl: string;
  conversationId: string;
  tenantId: string;
  activityId?: string;
}

/** Decide whether a Bot Framework activity is a user message we should answer, and
 *  extract the normalized inbound. (Bot Framework doesn't echo the bot's own
 *  messages, so no loop guard is needed — unlike Slack.) */
// deno-lint-ignore no-explicit-any
export function classifyActivity(a: any): { act: boolean; reason: string; event?: TeamsInbound } {
  if (!a || typeof a !== "object") return { act: false, reason: "no activity" };
  if (a.type !== "message") return { act: false, reason: `type=${a.type}` };
  const text = String(a.text ?? "").replace(/<at>.*?<\/at>/g, "").trim(); // strip @mention chips
  const from = a.from ?? {};
  const aadObjectId = String(from.aadObjectId ?? "");
  const userId = String(from.id ?? "");
  const conversationId = String(a.conversation?.id ?? "");
  const serviceUrl = String(a.serviceUrl ?? "");
  if (!text || !userId || !conversationId || !serviceUrl) return { act: false, reason: "missing text/from/conversation/serviceUrl" };
  return {
    act: true,
    reason: "ok",
    event: {
      text,
      aadObjectId,
      userId,
      name: String(from.name ?? ""),
      serviceUrl,
      conversationId,
      tenantId: String(a.channelData?.tenant?.id ?? a.conversation?.tenantId ?? ""),
      activityId: a.id ? String(a.id) : undefined,
    },
  };
}

/** Stable per-user session key for a Teams tenant (aadObjectId is stable across chats). */
export function teamsSessionId(tenantId: string, aadObjectId: string, userId: string): string {
  return `teams_${tenantId}_${aadObjectId || userId}`;
}

/** Azure AD already authenticated this user — email (via Graph) is the join key, the
 *  aadObjectId is the stable sub. */
export function buildTeamsRawIdentity(aadObjectId: string, userId: string, name?: string | null, email?: string | null): RawIdentity {
  return { email: email ?? null, phone: null, name: name ?? null, sub: aadObjectId || userId, rawToken: null };
}
