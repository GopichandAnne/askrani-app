// SMS sender — Twilio, platform-wide via env (mirrors the shared-Gmail pattern
// in email.ts). No-ops and returns false when unconfigured, so anything built on
// it ships DORMANT until the operator sets the three TWILIO_* env vars.
//
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (E.164, e.g. +1555…)

export function smsConfigured(): boolean {
  return !!(
    Deno.env.get("TWILIO_ACCOUNT_SID") &&
    Deno.env.get("TWILIO_AUTH_TOKEN") &&
    Deno.env.get("TWILIO_FROM_NUMBER")
  );
}

/** Send an SMS. Best-effort — never throws; returns whether Twilio accepted it. */
export async function sendSms(to: string, body: string): Promise<boolean> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!sid || !token || !from) return false;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
    if (!res.ok) console.error(`[sms] Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.ok;
  } catch (e) {
    console.error(`[sms] send failed: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}
