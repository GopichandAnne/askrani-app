import {
  DASHBOARD_DAYS,
  languageLabel,
} from "@/lib/dashboard/metrics";
import {
  leadTypeLabel,
  type SaasDashboardMetrics,
} from "@/lib/dashboard/saas-dashboard";

function shortDay(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(dt);
}

function fmtResponse(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-card rounded-lg border p-4">
      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{label}</p>
      <p className="font-display text-teal-deep dark:text-teal-light mt-1 text-4xl italic tabular-nums">{value}</p>
      {sub && <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card rounded-lg border p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function DailyChart({ days, values, color }: { days: string[]; values: number[]; color: string }) {
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
            style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? "2px" : "0", backgroundColor: color }}
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

function Bars({
  rows,
  empty,
}: {
  rows: { label: string; count: number }[];
  empty: string;
}) {
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3 text-sm">
          <span className="w-32 shrink-0 truncate" title={r.label}>{r.label}</span>
          <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
            <div className="bg-gradient-primary h-full rounded-full" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
          <span className="w-8 text-right tabular-nums">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

function SentimentBars({ s }: { s: { positive: number; neutral: number; negative: number } }) {
  const total = s.positive + s.neutral + s.negative;
  if (total === 0) return <p className="text-muted-foreground text-sm">No conversation data yet.</p>;
  const rows = [
    { label: "Positive", count: s.positive, color: "var(--teal)" },
    { label: "Neutral", count: s.neutral, color: "var(--muted)" },
    { label: "Negative", count: s.negative, color: "var(--coral)" },
  ];
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const pct = Math.round((r.count / total) * 100);
        return (
          <div key={r.label} className="flex items-center gap-3 text-sm">
            <span className="w-16 shrink-0">{r.label}</span>
            <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: r.color }} />
            </div>
            <span className="text-muted-foreground w-16 text-right tabular-nums">{r.count} · {pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

export function SaasDashboard({ metrics, storeName }: { metrics: SaasDashboardMetrics; storeName: string }) {
  const m = metrics;
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <header>
        <h1 className="font-display text-3xl italic">Dashboard</h1>
        <p className="text-muted-foreground text-sm">{storeName} · last {DASHBOARD_DAYS} days</p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Conversations" value={m.totalConversations} />
        <StatCard label="Leads captured" value={m.totalLeads} sub="demo · sales · support · careers" />
        <StatCard label="Self-serve rate" value={m.selfServePct === null ? "—" : `${m.selfServePct}%`} sub="answered without a gap" />
        <StatCard label="Avg response" value={fmtResponse(m.avgResponseMs)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Conversations per day">
          <DailyChart days={m.days} values={m.convsPerDay} color="var(--teal)" />
        </Card>
        <Card title="Leads captured per day">
          <DailyChart days={m.days} values={m.leadsPerDay} color="var(--coral)" />
        </Card>
      </div>

      <Card title="Leads by type">
        <Bars
          rows={m.leadsByType.map((t) => ({ label: leadTypeLabel(t.type), count: t.count }))}
          empty="No leads captured yet — they'll appear here once Rani starts capturing demo, sales, support, or careers requests."
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="What prospects ask about most">
          <Bars
            rows={m.topicsAsked.map((t) => ({ label: t.item, count: t.count }))}
            empty="No topics yet."
          />
        </Card>
        <Card title="Questions Rani couldn't answer (gaps to close)">
          <Bars
            rows={m.gaps.map((t) => ({ label: t.item, count: t.count }))}
            empty="No gaps flagged — Rani is answering what it's asked."
          />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Languages">
          <Bars
            rows={m.languages.map((l) => ({ label: languageLabel(l.language), count: l.count }))}
            empty="No conversation data yet."
          />
        </Card>
        <Card title="Sentiment">
          <SentimentBars s={m.sentiment} />
        </Card>
      </div>
    </div>
  );
}
