// Persist a photo a CUSTOMER sent into the chat so it survives beyond the live
// turn — the staff panel reads it back via a signed URL. Best-effort: any failure
// returns null and the caller proceeds text-only (the model still saw the image).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Store } from "./types.ts";
import { decodeBase64 } from "jsr:@std/encoding@1/base64";

const BUCKET = "chat-media";
const SIGN_TTL = 60 * 60 * 24 * 7; // 7 days — long enough for later review in the panel

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
};

/** Upload an inbound customer image; returns a signed URL (or null on failure). */
export async function storeChatImage(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  base64: string,
  mime: string,
): Promise<string | null> {
  try {
    const ext = EXT[mime.toLowerCase()] ?? "jpg";
    const path = `${store.slug}/${sessionId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await db.storage.from(BUCKET).upload(path, decodeBase64(base64), {
      contentType: mime,
      upsert: false,
    });
    if (error) {
      console.error("[chat-media] upload:", error.message);
      return null;
    }
    const { data } = await db.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL);
    return data?.signedUrl ?? null;
  } catch (e) {
    console.error("[chat-media] error:", e);
    return null;
  }
}

/** Upload an inbound customer document (résumé, etc.); returns a signed URL. A
 *  parse connector fetches this URL to extract fields. Best-effort → null. */
export async function storeChatFile(
  db: SupabaseClient,
  store: Store,
  sessionId: string,
  base64: string,
  mime: string,
): Promise<string | null> {
  try {
    const ext = EXT[mime.toLowerCase()] ?? "bin";
    const path = `${store.slug}/${sessionId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await db.storage.from(BUCKET).upload(path, decodeBase64(base64), {
      contentType: mime,
      upsert: false,
    });
    if (error) {
      console.error("[chat-media] file upload:", error.message);
      return null;
    }
    const { data } = await db.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL);
    return data?.signedUrl ?? null;
  } catch (e) {
    console.error("[chat-media] file error:", e);
    return null;
  }
}
