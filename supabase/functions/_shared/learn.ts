// Learn-from-escalations — Bot Phase 5b.
// When a teammate answers an escalated question, an LLM decides whether it's a
// reusable FAQ (vs a one-off like "is MY order ready?"), cleans it into a
// general question + store-voice answer, and judges whether it's safe to publish
// automatically. Safe, high-confidence, price-free (in request mode) answers go
// LIVE immediately (active + indexed); anything borderline is saved as an
// inactive draft for the owner to review. Owners can always exclude/edit either.
//
// Runs in the webhook's background task (after the customer already got the
// answer), so the LLM call + re-embed never delay anything customer-facing.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import { loadAgentConfig } from "./agent.ts";
import { reindexKnowledge, syncSavedQaToIndex } from "./knowledge.ts";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type LearnOutcome = "auto" | "draft" | "skipped";

interface Verdict {
  keep: boolean;
  question: string;
  answer: string;
  contains_price: boolean;
  auto_approve: boolean;
  reason: string;
}

/** LLM judgment: is this a reusable FAQ, and is it safe to auto-publish? */
async function judge(storeName: string, question: string, answer: string): Promise<Verdict | null> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return null;
  const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-latest";

  const sys =
    `You curate the FAQ knowledge base for ${storeName}. A staff member just answered a ` +
    "customer's escalated question. Decide whether it should become a reusable FAQ the " +
    "assistant can answer on its own next time. Return STRICT JSON.\n" +
    "keep = true ONLY if the question is a general, reusable question about the store (its " +
    "products, services, policies, hours, locations, offerings) AND the answer is a general " +
    "fact useful to any customer. keep = false for anything customer-specific or one-off: a " +
    "particular person's order/delivery/refund/account status ('is my order ready', 'where is " +
    "my delivery'), a complaint about a specific incident, or an answer that only applies to " +
    "one customer.\n" +
    "If keep = true:\n" +
    "- question: rewrite as a clean, general question ANY customer might ask — remove names, " +
    "order numbers, phone numbers, and first-person specifics ('my', 'I').\n" +
    "- answer: rewrite as a concise, friendly, factual answer in the store's voice. Stay " +
    "accurate to what the staff said; never invent details.\n" +
    "- contains_price = true if the answer states a specific price, amount, or currency figure.\n" +
    "- auto_approve = true ONLY if you are highly confident this is a correct, general, " +
    "unambiguous, non-sensitive FAQ that is safe to publish automatically. Set false when it is " +
    "borderline, ambiguous, incomplete, sensitive, or you are unsure — those go to human review.\n" +
    "- reason: one short sentence.\n" +
    "If keep = false, still fill the other fields with best-effort values (they are ignored).";

  try {
    const res = await fetch(`${API_BASE}/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents: [{ role: "user", parts: [{ text: `QUESTION: ${question}\nANSWER: ${answer}` }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 600,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              keep: { type: "boolean" },
              question: { type: "string" },
              answer: { type: "string" },
              contains_price: { type: "boolean" },
              auto_approve: { type: "boolean" },
              reason: { type: "string" },
            },
            required: ["keep", "question", "answer", "contains_price", "auto_approve", "reason"],
          },
        },
      }),
    });
    if (!res.ok) {
      console.error(`[learn] judge ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    // deno-lint-ignore no-explicit-any
    const json: any = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    return JSON.parse(text) as Verdict;
  } catch (e) {
    console.error(`[learn] judge error: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * Turn one answered escalation into knowledge. Returns what happened:
 *  "auto"    -> published live (active + indexed)
 *  "draft"   -> saved inactive for owner review
 *  "skipped" -> not a reusable FAQ, or a duplicate.
 */
export async function learnFromAnswer(
  db: SupabaseClient,
  store: Store,
  rawQuestion: string,
  rawAnswer: string,
  session: string | null,
): Promise<LearnOutcome> {
  const q0 = (rawQuestion ?? "").trim();
  const a0 = (rawAnswer ?? "").trim();
  if (!q0 || !a0) return "skipped";

  const config = await loadAgentConfig(db, store);
  const v = await judge(store.store_display_name ?? store.slug, q0, a0);

  // If the judge is unavailable, fall back to the safe old behavior: a raw draft.
  const keep = v ? v.keep : true;
  if (!keep) return "skipped";
  const question = (v?.question?.trim()) || q0;
  const answer = (v?.answer?.trim()) || a0;

  // Safety: never auto-publish a priced answer in request mode (the bot must not
  // quote prices there). It still goes to review.
  const requestMode = !config.catalogEnabled;
  const autoApprove = !!v?.auto_approve && !(requestMode && v?.contains_price);

  // Dedupe on the cleaned question (case-insensitive).
  const { data: dupe } = await db
    .from("saved_qa")
    .select("id")
    .eq("store_id", store.id)
    .ilike("question", question)
    .limit(1);
  if (dupe && dupe.length > 0) return "skipped";

  const { error } = await db.from("saved_qa").insert({
    store_id: store.id,
    question,
    answer,
    source_session: session,
    active: autoApprove,
    category: autoApprove ? "Learned automatically" : "From a conversation",
  });
  if (error) {
    console.error(`[learn] insert: ${error.message}`);
    return "skipped";
  }

  if (autoApprove) {
    // Make it searchable now — same path as the panel's Sync (only re-embeds the
    // small saved_qa set; document chunks aren't stale, so they're untouched).
    try {
      await syncSavedQaToIndex(db, store.id);
      await reindexKnowledge(db, store.id, 200);
    } catch (e) {
      console.error(`[learn] index: ${e instanceof Error ? e.message : e}`);
    }
  }
  return autoApprove ? "auto" : "draft";
}
