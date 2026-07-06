const GRAPH_VERSION = "v21.0";

/**
 * Send a plain text WhatsApp message via the Cloud API. Best-effort: failures
 * are logged, never thrown (a send failure must not break intake).
 */
export async function sendText(
  accessToken: string,
  phoneNumberId: string,
  to: string,
  body: string,
): Promise<void> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { preview_url: false, body },
        }),
      },
    );
    if (!res.ok) {
      console.error(`[wa] send ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.error("[wa] send error:", err);
  }
}

/** Send an image message by URL (WhatsApp fetches the link server-side). The
 *  link must be publicly reachable for the fetch window — we pass a short-lived
 *  Storage signed URL. Best-effort: returns whether it was accepted. */
export async function sendImage(
  accessToken: string,
  phoneNumberId: string,
  to: string,
  link: string,
  caption?: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "image",
          image: { link, ...(caption ? { caption } : {}) },
        }),
      },
    );
    if (!res.ok) console.error(`[wa] sendImage ${res.status}: ${await res.text()}`);
    return res.ok;
  } catch (err) {
    console.error("[wa] sendImage error:", err);
    return false;
  }
}

/** Download inbound media (a customer's photo) by media id. Two hops: resolve
 *  the media URL, then fetch the bytes — both need the access token. Returns
 *  null on any failure (caller proceeds text-only). */
export async function downloadMedia(
  accessToken: string,
  mediaId: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const meta = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!meta.ok) {
      console.error(`[wa] media meta ${meta.status}`);
      return null;
    }
    const { url, mime_type } = await meta.json();
    if (!url) return null;
    const bin = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!bin.ok) {
      console.error(`[wa] media download ${bin.status}`);
      return null;
    }
    return { bytes: new Uint8Array(await bin.arrayBuffer()), mime: mime_type ?? "image/jpeg" };
  } catch (err) {
    console.error("[wa] downloadMedia error:", err);
    return null;
  }
}
