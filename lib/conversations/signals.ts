// Per-thread conversation signals: roll up the per-turn analytics_json
// (sentiment / frustrated / complaint / feedback) from the `conversations`
// turn-log onto each thread, so the Conversations list can flag threads.

export type ThreadSignal = {
  complaint: boolean;
  frustrated: boolean;
  feedback: boolean;
  sentiment: "positive" | "neutral" | "negative" | null;
};

export type ConvRowLite = {
  session_id: string | null;
  analytics_json: string | null;
  created_at: string;
};

/** A thread's session id: web sessions store it directly, WhatsApp is wa_<phone>. */
export function sessionIdForPhone(customerPhone: string | null): string | null {
  if (!customerPhone) return null;
  return customerPhone.startsWith("web_") ? customerPhone : `wa_${customerPhone}`;
}

function parse(json: string | null): {
  sentiment?: string;
  frustrated?: boolean;
  complaint?: boolean;
  feedback?: boolean;
} {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

/** thread_id -> rolled-up signal (flags OR'd across turns; latest sentiment). */
export function computeThreadSignals(
  threads: { thread_id: string; customer_phone: string | null }[],
  convs: ConvRowLite[],
): Record<string, ThreadSignal> {
  const bySession = new Map<string, ThreadSignal & { _ts: string }>();
  for (const c of convs) {
    if (!c.session_id) continue;
    const a = parse(c.analytics_json);
    let s = bySession.get(c.session_id);
    if (!s) {
      s = { complaint: false, frustrated: false, feedback: false, sentiment: null, _ts: "" };
      bySession.set(c.session_id, s);
    }
    if (a.complaint) s.complaint = true;
    if (a.frustrated) s.frustrated = true;
    if (a.feedback) s.feedback = true;
    if (
      (a.sentiment === "positive" || a.sentiment === "neutral" || a.sentiment === "negative") &&
      c.created_at > s._ts
    ) {
      s.sentiment = a.sentiment;
      s._ts = c.created_at;
    }
  }

  const out: Record<string, ThreadSignal> = {};
  for (const t of threads) {
    const sid = sessionIdForPhone(t.customer_phone);
    const s = sid ? bySession.get(sid) : undefined;
    if (s && (s.complaint || s.frustrated || s.feedback || s.sentiment)) {
      out[t.thread_id] = {
        complaint: s.complaint,
        frustrated: s.frustrated,
        feedback: s.feedback,
        sentiment: s.sentiment,
      };
    }
  }
  return out;
}

/** Threads worth the owner's attention: an active complaint or frustration. */
export function needsAttention(sig: ThreadSignal | undefined): boolean {
  return !!sig && (sig.complaint || sig.frustrated);
}
