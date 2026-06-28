"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveStore } from "@/lib/store/active-store";
import type { SavedQA, SavedQAInput, SavedQAPatch } from "@/lib/knowledge/types";

export type QAResult =
  | { ok: true; qa: SavedQA }
  | { ok: false; error: string };
export type SimpleResult = { ok: true } | { ok: false; error: string };
export type RefreshResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

const QA_COLUMNS =
  "id, store_id, question, answer, source_session, times_used, last_used, created_by, active, category, created_at, updated_at";

function cleanStr(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = v.trim();
  return s === "" ? null : s;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** Resolve a saved_qa's store and confirm the caller owns it. */
async function ownerOfQA(
  supabase: SupabaseServerClient,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: row } = await supabase
    .from("saved_qa")
    .select("store_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { ok: false, error: "Entry not found." };
  const { data: isOwner } = await supabase.rpc("user_is_owner", {
    p_store_id: row.store_id,
  });
  if (!isOwner) return { ok: false, error: "Only owners can edit the knowledge base." };
  return { ok: true };
}

/** Create a saved_qa entry on the active store (owners only). */
export async function createQA(input: SavedQAInput): Promise<QAResult> {
  const question = cleanStr(input.question);
  if (!question) return { ok: false, error: "Question is required." };

  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: isOwner } = await supabase.rpc("user_is_owner", {
    p_store_id: ctx.active.id,
  });
  if (!isOwner) return { ok: false, error: "Only owners can add entries." };

  const { data, error } = await supabase
    .from("saved_qa")
    .insert({
      store_id: ctx.active.id,
      question,
      answer: cleanStr(input.answer),
      category: cleanStr(input.category),
      active: input.active ?? true,
      created_by: user?.id ?? null,
    })
    .select(QA_COLUMNS)
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath("/knowledge");
  return { ok: true, qa: data as SavedQA };
}

/** Edit a saved_qa entry (owners only). */
export async function updateQA(
  id: string,
  patch: SavedQAPatch,
): Promise<QAResult> {
  const supabase = await createClient();
  const gate = await ownerOfQA(supabase, id);
  if (!gate.ok) return gate;

  const next: SavedQAPatch = {};
  if ("question" in patch) {
    const q = cleanStr(patch.question);
    if (!q) return { ok: false, error: "Question can't be empty." };
    next.question = q;
  }
  if ("answer" in patch) next.answer = cleanStr(patch.answer);
  if ("category" in patch) next.category = cleanStr(patch.category);
  if ("active" in patch) next.active = !!patch.active;

  const { data, error } = await supabase
    .from("saved_qa")
    .update(next)
    .eq("id", id)
    .select(QA_COLUMNS)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Entry not found." };
  revalidatePath("/knowledge");
  return { ok: true, qa: data as SavedQA };
}

/** Delete a saved_qa entry (owners only). */
export async function deleteQA(id: string): Promise<SimpleResult> {
  const supabase = await createClient();
  const gate = await ownerOfQA(supabase, id);
  if (!gate.ok) return gate;

  const { error } = await supabase.from("saved_qa").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/knowledge");
  return { ok: true };
}

/**
 * Trigger the existing document-KB reindex for the active store. The reindex
 * endpoint lives in the AskRani-WA backend; its URL is configured out-of-band.
 * HUMAN TODO: set KB_REINDEX_URL (and confirm the auth/payload it expects).
 */
export async function refreshKnowledgeBase(): Promise<RefreshResult> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", {
    p_store_id: ctx.active.id,
  });
  if (!isOwner) return { ok: false, error: "Only owners can refresh the KB." };

  const endpoint = process.env.KB_REINDEX_URL;
  if (!endpoint) {
    return {
      ok: false,
      error:
        "Reindex endpoint not configured yet (HUMAN TODO: set KB_REINDEX_URL).",
    };
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store_slug: ctx.active.slug }),
    });
    if (!res.ok) {
      return { ok: false, error: `Reindex failed (HTTP ${res.status}).` };
    }
    return { ok: true, message: "Knowledge base reindex started." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reindex failed." };
  }
}
