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
