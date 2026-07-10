// Transactional email from edge functions (escalation / order notifications to
// responders who prefer email). Uses the SAME Gmail account as the marketing
// app's waitlist email — set GMAIL_USER + GMAIL_APP_PASSWORD as function secrets.
// No secrets set -> no-op (logged), like the rest of the best-effort notify path.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

export async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  const user = Deno.env.get("GMAIL_USER");
  const pass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!user || !pass) {
    console.warn("[email] GMAIL_USER/GMAIL_APP_PASSWORD not set — skipping email");
    return false;
  }
  const client = new SMTPClient({
    connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: user, password: pass } },
  });
  try {
    await client.send({ from: `Ask Rani <${user}>`, to, subject, content: body });
    return true;
  } catch (e) {
    console.error(`[email] send to ${to} failed: ${e instanceof Error ? e.message : e}`);
    return false;
  } finally {
    try {
      await client.close();
    } catch { /* ignore */ }
  }
}
