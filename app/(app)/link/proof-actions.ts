"use server";

import { getSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

const INSIGHTS = (process.env.INSIGHTS_API_URL || "https://insights.askrani.ai").replace(/\/$/, "");
const ANSWERS_SITE = (process.env.ANSWERS_SITE_URL || "https://askrani.ai").replace(/\/$/, "");

export type ProofRow = {
  question: string;
  engine: string;
  phase: "before" | "after";
  answered: boolean;
  cited: boolean;
  answer_text: string | null;
  citations: string[];
  checked_at: string;
};

export type ProofResult =
  | { ok: true; configured: boolean; rows: ProofRow[] }
  | { ok: false; error: string };

type Db = ReturnType<typeof createAdminClient>;

async function requireStoreAccess(storeId: string) {
  const ctx = await getSessionContext();
  const allowed =
    !!ctx && (ctx.isPlatformAdmin || ctx.stores.some((s) => s.id === storeId && s.role === "owner"));
  if (!allowed) throw new Error("Not authorized");
}

function engineConfigured(): boolean {
  return !!(process.env.INSIGHTS_OPS_SECRET || process.env.WEB_DETECT_SECRET);
}

async function readProofs(db: Db, storeId: string): Promise<ProofRow[]> {
  const { data } = await db
    .from("answer_proofs")
    .select("question, engine, phase, answered, cited, answer_text, citations, checked_at")
    .eq("store_id", storeId)
    .order("checked_at", { ascending: false })
    .limit(80);
  return (data ?? []).map((r) => ({
    question: r.question as string,
    engine: (r.engine as string) ?? "perplexity",
    phase: (r.phase as "before" | "after") ?? "after",
    answered: !!r.answered,
    cited: !!r.cited,
    answer_text: (r.answer_text as string | null) ?? null,
    citations: Array.isArray(r.citations) ? (r.citations as string[]) : [],
    checked_at: r.checked_at as string,
  }));
}

/** Load the proof receipts (no engine call). */
export async function getProofs(storeId: string): Promise<ProofResult> {
  await requireStoreAccess(storeId);
  const db = createAdminClient();
  return { ok: true, configured: engineConfigured(), rows: await readProofs(db, storeId) };
}

/** Ask the live engine the store's top questions and record the receipts. Run
 *  `before` at/around publish (engine shrugs) and `after` later (engine answers). */
export async function runProofCheck(storeId: string, phase: "before" | "after"): Promise<ProofResult> {
  await requireStoreAccess(storeId);
  const db = createAdminClient();

  const [{ data: store }, { data: qa }] = await Promise.all([
    db.from("stores").select("slug, store_display_name").eq("id", storeId).single(),
    db
      .from("saved_qa")
      .select("question")
      .eq("store_id", storeId)
      .eq("active", true)
      .not("answer", "is", null)
      .order("times_used", { ascending: false })
      .limit(4),
  ]);
  const name = (store?.store_display_name as string) || (store?.slug as string) || "";
  const slug = (store?.slug as string) || "";
  const questions = (qa ?? []).map((r) => r.question as string).filter(Boolean);
  if (!name || !questions.length) {
    return { ok: false, error: "Add a few saved Q&As first — those are the questions we test." };
  }

  const secret = process.env.INSIGHTS_OPS_SECRET || process.env.WEB_DETECT_SECRET;
  if (!secret) return { ok: false, error: "Proof engine isn't configured yet." };

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 58_000);
    const res = await fetch(`${INSIGHTS}/api/rani/probe`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ name, answersUrl: `${ANSWERS_SITE}/a/${slug}`, questions }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false, error: "The proof check failed. Try again in a moment." };
    const data = await res.json();
    if (!data?.ok) {
      if (data?.reason === "unconfigured") {
        return { ok: true, configured: false, rows: await readProofs(db, storeId) };
      }
      return { ok: false, error: "The proof check failed. Try again in a moment." };
    }

    const results: {
      question: string; engine?: string; answer?: string; citations?: string[]; answered?: boolean; citedOwn?: boolean;
    }[] = Array.isArray(data.results) ? data.results : [];
    if (results.length) {
      await db.from("answer_proofs").insert(
        results.map((r) => ({
          store_id: storeId,
          question: r.question,
          engine: r.engine ?? "perplexity",
          phase,
          answered: !!r.answered,
          cited: !!r.citedOwn,
          answer_text: r.answer ?? null,
          citations: r.citations ?? [],
        })),
      );
    }
    return { ok: true, configured: true, rows: await readProofs(db, storeId) };
  } catch {
    return { ok: false, error: "The proof check timed out. Try again in a moment." };
  }
}
