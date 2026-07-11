// photos — powers the public "view all photos" gallery. Given {slug, token, q},
// it validates the visitor token (same gate as web-chat), finds the store's
// image KB docs matching the query, and returns 7-day signed URLs so the gallery
// page can render every related picture. Read-only; no writes.

import { serviceClient } from "../_shared/supabase.ts";
import { getStoreBySlug } from "../_shared/config.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_PHOTOS = 40;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: { slug?: string; token?: string; q?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const slug = String(body.slug ?? "").trim();
  const token = String(body.token ?? "").trim();
  const q = String(body.q ?? "").trim();
  if (!slug || !token) return json({ error: "slug and token are required" }, 400);

  const db = serviceClient();
  const store = await getStoreBySlug(db, slug);
  if (!store) return json({ error: "unknown store" }, 404);

  // Validate the visitor token (active, unexpired) — same gate as the chat.
  const { data: tok } = await db
    .from("store_tokens")
    .select("id")
    .eq("store_id", store.id)
    .eq("token", token)
    .eq("active", true)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .limit(1);
  if (!tok || tok.length === 0) return json({ error: "invalid or expired link" }, 403);

  // Image KB docs, ranked by keyword overlap on title + extracted text.
  const { data: docs } = await db
    .from("knowledge_index")
    .select("source_ref, source_path, chunk_text")
    .eq("store_id", store.id)
    .eq("kind", "document_chunk")
    .not("source_path", "is", null)
    .like("source_mime", "image/%");

  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const ranked = ((docs ?? []) as { source_ref: string | null; source_path: string; chunk_text: string | null }[])
    .map((d) => {
      const hay = `${d.source_ref ?? ""} ${d.chunk_text ?? ""}`.toLowerCase();
      const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
      return { d, score };
    })
    .filter((x) => words.length === 0 || x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PHOTOS);

  const photos: { title: string | null; url: string }[] = [];
  for (const { d } of ranked) {
    const { data: signed } = await db.storage.from("kb").createSignedUrl(d.source_path, 60 * 60 * 24 * 7);
    if (signed?.signedUrl) photos.push({ title: d.source_ref, url: signed.signedUrl });
  }

  return json({ store: store.slug, name: store.store_display_name ?? store.slug, query: q, photos });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
