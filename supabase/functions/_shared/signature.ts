/**
 * Verify Meta's `X-Hub-Signature-256` over the RAW request body. The HMAC must
 * be computed over the exact bytes Meta sent, so the caller passes the raw
 * Uint8Array (do NOT re-serialize the parsed JSON).
 */
export async function verifySignature(
  rawBody: Uint8Array,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!header || !appSecret) return false;
  const expected = header.startsWith("sha256=") ? header.slice(7) : header;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, rawBody);
  const actual = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(actual, expected);
}

/** Constant-time string compare (avoid leaking via early-exit). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
