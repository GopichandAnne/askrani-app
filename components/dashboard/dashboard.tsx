import type { OrderStatus } from "@/lib/orders/types";
import {
  DASHBOARD_DAYS,
  languageLabel,
  type DashboardMetrics,
} from "@/lib/dashboard/metrics";
import { StatusChip } from "@/components/orders/status-chip";

function shortDay(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="bg-card rounded-lg border p-4">
      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {label}
      </p>
      <p className="font-display text-teal-deep dark:text-teal-light mt-1 text-4xl italic tabular-nums">
        {value}
      </p>
      {sub && <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p>}
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card rounded-lg border p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function StatusBars({
  counts,
}: {
  counts: { status: OrderStatus; count: number }[];
}) {
  const max = Math.max(1, ...counts.map((c) => c.count));
  return (
    <div className="space-y-2">
      {counts.map((c) => (
        <div key={c.status} className="flex items-center gap-3">
          <div className="w-32 shrink-0">
            <StatusChip status={c.status} />
          </div>
          <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
            <div
              className="bg-gradient-primary h-full rounded-full"
              style={{ width: `${(c.count / max) * 100}%` }}
            />
          </div>
          <span className="w-8 text-right text-sm tabular-nums">{c.count}</span>
        </div>
      ))}
    </div>
  );
}

function DailyChart({
  days,
  values,
  color,
}: {
  days: string[];
  values: number[];
  color: string;
}) {
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <div>
      <div className="flex h-24 items-end gap-px">
        {values.map((v, i) => (
          <div
            key={days[i]}
            title={`${days[i]}: ${v}`}
            className="flex-1 rounded-t-sm"
            style={{
              height: `${(v / max) * 100}%`,
              minHeight: v > 0 ? "2px" : "0",
              backgroundColor: color,
            }}
          />
        ))}
      </div>
      <div className="text-muted-foreground mt-1.5 flex justify-between text-[10px]">
        <span>{shortDay(days[0])}</span>
        <span>{total} total</span>
        <span>{shortDay(days[days.length - 1])}</span>
      </div>
    </div>
  );
}

function LanguageBars({
  languages,
  total,
}: {
  languages: { language: string; count: number }[];
  total: number;
}) {
  if (languages.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No conversation data yet.</p>
    );
  }
  return (
    <div className="space-y-2">
      {languages.map((l) => {
        const pct = total > 0 ? Math.round((l.count / total) * 100) : 0;
        return (
          <div key={l.language} className="flex items-center gap-3 text-sm">
            <span className="w-20 shrink-0">{languageLabel(l.language)}</span>
            <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
              <div
                className="bg-teal h-full rounded-full"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-muted-foreground w-16 text-right tabular-nums">
              {l.count} · {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function Dashboard({
  metrics,
  storeName,
}: {
  metrics: DashboardMetrics;
  storeName: string;
}) {
  const m = metrics;
  const confirmRate =
    m.totalOrders > 0
      ? `${Math.round((m.confirmedOrders / m.totalOrders) * 100)}% of orders`
      : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="font-display text-2xl italic">Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          {storeName} · last {DASHBOARD_DAYS} days
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Orders" value={m.totalOrders} />
        <StatCard label="Confirmed" value={m.confirmedOrders} sub={confirmRate} />
        <StatCard label="Conversations" value={m.totalConversations} />
        <StatCard
          label="Avg response"
          value={m.avgResponseMs != null ? `${(m.avgResponseMs / 1000).toFixed(1)}s` : "—"}
        />
      </div>

      <Card title="Orders by status">
        <StatusBars counts={m.statusCounts} />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Orders per day">
          <DailyChart days={m.days} values={m.ordersPerDay} color="var(--teal)" />
        </Card>
        <Card title="Conversations per day">
          <DailyChart
            days={m.days}
            values={m.convsPerDay}
            color="var(--teal-light)"
          />
        </Card>
      </div>

      <Card title="Languages">
        <LanguageBars languages={m.languages} total={m.totalConversations} />
      </Card>
    </div>
  );
}
