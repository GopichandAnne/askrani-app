import {
  lastNDays,
  inWindow,
  sentimentCounts,
  topMissing,
  topRequested,
  countPerDay,
  gapConversationCount,
  DASHBOARD_DAYS,
  type ConvRow,
} from "./metrics";

/**
 * The SaaS/product "Assistant health" home. Reuses the conversation-analytics
 * engine (metrics.ts) and adds the numbers a product team cares about: how much
 * the assistant self-serves, where it falls short, and how many leads it caught.
 */
export function computeSaasHealth(convs: ConvRow[], leadsCaptured: number) {
  const days = lastNDays(DASHBOARD_DAYS);
  const c = inWindow(convs, days);
  const total = c.length;
  const gaps = gapConversationCount(c);
  // Self-serve = conversations Rani answered without naming a gap it couldn't cover.
  const selfServeRate = total > 0 ? Math.round(((total - gaps) / total) * 100) : null;

  const rts = c
    .map((x) => x.response_time_ms)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const avgResponseMs = rts.length
    ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length)
    : null;

  return {
    days,
    windowDays: DASHBOARD_DAYS,
    totalConversations: total,
    leadsCaptured,
    selfServeRate,
    gapConversations: gaps,
    avgResponseMs,
    sentiment: sentimentCounts(c),
    topAsks: topRequested(c),
    gaps: topMissing(c),
    convsPerDay: countPerDay(c, days),
  };
}

export type SaasHealth = ReturnType<typeof computeSaasHealth>;
