// health — synthetic health check of the bot's real dependencies.
//
// This exists because a dependency can fail SILENTLY: when Google retired
// gemini-2.5-flash the whole bot was down and no one knew until a customer
// complained. This pings the actual things a live turn needs — Gemini
// generation, embeddings, the database — records the result, and (on a
// healthy→failing transition, so it doesn't spam) posts an alert to a webhook.
//
// Returns 200 when healthy / 503 when not, so an external uptime monitor
// (UptimeRobot, Better Stack, …) can watch it too. verify_jwt=false so the cron
// and monitors can reach it; it exposes only health status, nothing sensitive.

import { serviceClient } from "../_shared/supabase.ts";
import { embedQuery } from "../_shared/embeddings.ts";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

type Check = { ok: boolean; detail?: string };

async function checkGemini(): Promise<Check> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return { ok: false, detail: "GEMINI_API_KEY not set" };
  const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-latest";
  try {
    const res = await fetch(`${API_BASE}/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 5, temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    if (!res.ok) return { ok: false, detail: `${model} HTTP ${res.status}: ${(await res.text()).slice(0, 160)}` };
    // deno-lint-ignore no-explicit-any
    const j: any = await res.json();
    const cand = j?.candidates?.[0];
    const text = (cand?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "").trim();
    return text ? { ok: true } : { ok: false, detail: `${model} empty (finishReason=${cand?.finishReason})` };
  } catch (e) {
    return { ok: false, detail: `gemini error: ${e instanceof Error ? e.message : e}` };
  }
}

async function checkEmbeddings(): Promise<Check> {
  try {
    const v = await embedQuery("health check");
    return v?.length === 768 ? { ok: true } : { ok: false, detail: `embedding length ${v?.length}` };
  } catch (e) {
    return { ok: false, detail: `embeddings error: ${e instanceof Error ? e.message : e}` };
  }
}

// deno-lint-ignore no-explicit-any
async function checkDb(db: any): Promise<Check> {
  try {
    const { error } = await db.from("stores").select("id", { head: true, count: "exact" });
    return error ? { ok: false, detail: `db: ${error.message}` } : { ok: true };
  } catch (e) {
    return { ok: false, detail: `db error: ${e instanceof Error ? e.message : e}` };
  }
}

async function alert(title: string, checks: Record<string, Check>): Promise<void> {
  const failing = Object.entries(checks)
    .filter(([, v]) => !v.ok)
    .map(([k, v]) => `${k}: ${v.detail}`)
    .join(" · ") || "all checks passing";
  const hook = Deno.env.get("ALERT_WEBHOOK_URL");
  if (!hook) {
    console.error(`[health] ALERT (no ALERT_WEBHOOK_URL set): ${title} — ${failing}`);
    return;
  }
  const msg = `${title}\n${failing}`;
  try {
    // `text` (Slack) and `content` (Discord) so one payload works for either.
    await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: msg, content: msg }),
    });
  } catch (e) {
    console.error(`[health] alert post failed: ${e instanceof Error ? e.message : e}`);
  }
}

Deno.serve(async () => {
  const db = serviceClient();
  const [gemini, embeddings, dbCheck] = await Promise.all([checkGemini(), checkEmbeddings(), checkDb(db)]);
  const checks = { gemini, embeddings, db: dbCheck };
  const ok = gemini.ok && embeddings.ok && dbCheck.ok;

  // De-dupe alerts: only fire on a state CHANGE vs the previous check.
  const { data: prev } = await db
    .from("health_checks")
    .select("ok")
    .order("checked_at", { ascending: false })
    .limit(1);
  const wasOk = prev?.[0]?.ok ?? true;

  await db.from("health_checks").insert({ ok, detail: checks });
  // Cheap retention: keep ~2 weeks of history.
  await db.from("health_checks").delete().lt(
    "checked_at",
    new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString(),
  );

  if (wasOk && !ok) await alert("🔴 Ask Rani health check FAILING", checks);
  else if (!wasOk && ok) await alert("🟢 Ask Rani recovered", checks);

  return new Response(JSON.stringify({ ok, checks, at: new Date().toISOString() }), {
    status: ok ? 200 : 503,
    headers: { "Content-Type": "application/json" },
  });
});
