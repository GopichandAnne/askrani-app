import type { OrderStatus } from "@/lib/orders/types";
import { ORDER_STATUSES } from "@/lib/orders/status";

export const DASHBOARD_DAYS = 30;

export type OrderRow = {
  status: OrderStatus;
  timestamp: string | null;
  total: number | null;
  created_at: string;
};

export type ConvRow = {
  timestamp: string | null;
  device_type: string | null;
  analytics_json: string | null;
  response_time_ms: number | null;
  created_at: string;
};

/** Business date (UTC) for a row, preferring `timestamp` over `created_at`. */
function dayKey(row: { timestamp: string | null; created_at: string }): string | null {
  const iso = row.timestamp ?? row.created_at;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** The last `n` calendar days (UTC) as YYYY-MM-DD, oldest first. */
export function lastNDays(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  const base = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(base - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

/** Filter rows to the window covered by `days`. */
function inWindow<T extends { timestamp: string | null; created_at: string }>(
  rows: T[],
  days: string[],
): T[] {
  const set = new Set(days);
  return rows.filter((r) => {
    const k = dayKey(r);
    return k !== null && set.has(k);
  });
}

export function orderStatusCounts(
  orders: OrderRow[],
): { status: OrderStatus; count: number }[] {
  const c = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<
    OrderStatus,
    number
  >;
  for (const o of orders) c[o.status] = (c[o.status] ?? 0) + 1;
  return ORDER_STATUSES.map((s) => ({ status: s, count: c[s] }));
}

/** Per-day counts aligned to `days`. */
export function countPerDay(
  rows: { timestamp: string | null; created_at: string }[],
  days: string[],
): number[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = dayKey(r);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return days.map((d) => m.get(d) ?? 0);
}

export function parseLanguage(analyticsJson: string | null): string {
  if (!analyticsJson) return "unknown";
  try {
    const o = JSON.parse(analyticsJson);
    const lang = o?.language ?? o?.lang ?? o?.detected_language;
    return typeof lang === "string" && lang.trim()
      ? lang.trim().toLowerCase()
      : "unknown";
  } catch {
    return "unknown";
  }
}

export function languageCounts(
  convs: ConvRow[],
): { language: string; count: number }[] {
  const m = new Map<string, number>();
  for (const c of convs) {
    const l = parseLanguage(c.analytics_json);
    m.set(l, (m.get(l) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count);
}

export const LANGUAGE_LABEL: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  te: "Telugu",
  ta: "Tamil",
  gu: "Gujarati",
  pa: "Punjabi",
  bn: "Bengali",
  ml: "Malayalam",
  ur: "Urdu",
  unknown: "Unknown",
};

export function languageLabel(code: string): string {
  return LANGUAGE_LABEL[code] ?? code.toUpperCase();
}

/** Everything the dashboard needs, computed over the last DASHBOARD_DAYS. */
export function computeDashboard(orders: OrderRow[], convs: ConvRow[]) {
  const days = lastNDays(DASHBOARD_DAYS);
  const o = inWindow(orders, days);
  const c = inWindow(convs, days);

  const confirmed = o.filter((x) => x.status === "confirmed").length;
  const responseTimes = c
    .map((x) => x.response_time_ms)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const avgResponseMs =
    responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : null;

  return {
    days,
    totalOrders: o.length,
    confirmedOrders: confirmed,
    totalConversations: c.length,
    avgResponseMs,
    statusCounts: orderStatusCounts(o),
    ordersPerDay: countPerDay(o, days),
    convsPerDay: countPerDay(c, days),
    languages: languageCounts(c),
  };
}

export type DashboardMetrics = ReturnType<typeof computeDashboard>;
