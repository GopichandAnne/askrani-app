"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveStore } from "@/lib/store/active-store";
import { callBotAdmin } from "@/lib/knowledge/bot-admin";
import type {
  KnowledgeDoc,
  SavedQA,
  SavedQAInput,
  SavedQAPatch,
} from "@/lib/knowledge/types";

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

/** Owner-gate the active store; returns its {id, slug} or an error. */
async function requireActiveOwner(
  supabase: SupabaseServerClient,
): Promise<{ ok: true; id: string; slug: string } | { ok: false; error: string }> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return { ok: false, error: "No active store." };
  const { data: isOwner } = await supabase.rpc("user_is_owner", {
    p_store_id: ctx.active.id,
  });
  if (!isOwner) return { ok: false, error: "Only owners can manage the knowledge base." };
  return { ok: true, id: ctx.active.id, slug: ctx.active.slug };
}

/**
 * Sync saved Q&A into the searchable knowledge index (embeds new/changed
 * entries). The bot retrieves these via search_knowledge at chat time.
 */
export async function refreshKnowledgeBase(): Promise<RefreshResult> {
  const supabase = await createClient();
  const gate = await requireActiveOwner(supabase);
  if (!gate.ok) return gate;

  const res = await callBotAdmin({ action: "sync_saved_qa", store_slug: gate.slug });
  if (!res.ok) return { ok: false, error: res.error };
  const synced = Number(res.data.synced ?? 0);
  return { ok: true, message: `Synced ${synced} Q&A ${synced === 1 ? "entry" : "entries"} to search.` };
}

/** List the active store's KB documents, aggregated from their chunks. */
export async function listDocuments(): Promise<KnowledgeDoc[]> {
  const ctx = await getActiveStore();
  if (!ctx?.active) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("knowledge_index")
    .select("source_ref, embedding_stale, updated_at")
    .eq("store_id", ctx.active.id)
    .eq("kind", "document_chunk");

  const byTitle = new Map<string, KnowledgeDoc>();
  for (const row of data ?? []) {
    const title = row.source_ref ?? "(untitled)";
    const doc = byTitle.get(title) ?? { title, chunks: 0, indexed: true, updatedAt: null };
    doc.chunks += 1;
    if (row.embedding_stale) doc.indexed = false;
    if (!doc.updatedAt || (row.updated_at && row.updated_at > doc.updatedAt)) {
      doc.updatedAt = row.updated_at;
    }
    byTitle.set(title, doc);
  }
  return [...byTitle.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** Ingest (chunk + embed) a pasted document into the KB (owners only). */
export async function ingestDocument(
  title: string,
  text: string,
): Promise<RefreshResult> {
  const t = cleanStr(title);
  const body = cleanStr(text);
  if (!t) return { ok: false, error: "A title is required." };
  if (!body) return { ok: false, error: "Paste the document text." };

  const supabase = await createClient();
  const gate = await requireActiveOwner(supabase);
  if (!gate.ok) return gate;

  const res = await callBotAdmin({
    action: "ingest_document",
    store_slug: gate.slug,
    title: t,
    text: body,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/knowledge");
  const chunks = Number(res.data.chunks ?? 0);
  return { ok: true, message: `Indexed "${t}" (${chunks} ${chunks === 1 ? "chunk" : "chunks"}).` };
}

/** Remove a KB document and its chunks (owners only). */
export async function deleteDocument(title: string): Promise<SimpleResult> {
  const supabase = await createClient();
  const gate = await requireActiveOwner(supabase);
  if (!gate.ok) return gate;

  const res = await callBotAdmin({
    action: "delete_document",
    store_slug: gate.slug,
    title,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/knowledge");
  return { ok: true };
}
