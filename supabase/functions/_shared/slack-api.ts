// Slack Web API calls (network). Kept apart from the pure logic in slack.ts so the
// adapters, the holds hook, and the interactions endpoint share one implementation.

/** Post a message (optionally Block Kit) to a channel/DM. Returns true on success. */
export async function slackPostMessage(botToken: string, channel: string, text: string, blocks?: unknown[]): Promise<boolean> {
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${botToken}` },
      body: JSON.stringify({ channel, text, ...(blocks ? { blocks } : {}) }),
    });
    // deno-lint-ignore no-explicit-any
    const j: any = await res.json();
    if (!j?.ok) console.warn(`[slack] chat.postMessage: ${j?.error}`);
    return !!j?.ok;
  } catch (e) {
    console.warn(`[slack] chat.postMessage error: ${(e as Error)?.message}`);
    return false;
  }
}

/** Look up a Slack user's email + name (needs users:read.email). Best-effort. */
export async function slackUserInfo(botToken: string, userId: string): Promise<{ email?: string | null; name?: string | null } | null> {
  try {
    const res = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`, {
      headers: { authorization: `Bearer ${botToken}` },
    });
    // deno-lint-ignore no-explicit-any
    const j: any = await res.json();
    if (!j?.ok) {
      console.warn(`[slack] users.info: ${j?.error}`);
      return null;
    }
    return { email: j.user?.profile?.email ?? null, name: j.user?.profile?.real_name ?? j.user?.real_name ?? null };
  } catch (e) {
    console.warn(`[slack] users.info error: ${(e as Error)?.message}`);
    return null;
  }
}

/** Reply to an interaction's response_url (e.g. replace the approval message). */
export async function slackRespond(responseUrl: string, body: Record<string, unknown>): Promise<void> {
  try {
    await fetch(responseUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) {
    console.warn(`[slack] respond error: ${(e as Error)?.message}`);
  }
}
