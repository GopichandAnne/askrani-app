import Link from "next/link";
import {
  MessagesSquare,
  Gauge,
  UserPlus,
  Clock,
  HelpCircle,
  BookOpen,
  Code2,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { SaasHealth } from "@/lib/dashboard/saas-health";

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function Kpi({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card rounded-xl border p-4">
      <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <Icon className="size-4" /> {label}
      </div>
      <div className="font-display mt-2 text-3xl font-extrabold">{value}</div>
      {hint && <div className="text-muted-foreground mt-1 text-xs">{hint}</div>}
    </div>
  );
}

export function SaasHealthView({ health, storeName }: { health: SaasHealth; storeName: string }) {
  const h = health;
  const empty = h.totalConversations === 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="font-display text-2xl italic">Assistant health</h1>
        <p className="text-muted-foreground text-sm">
          {storeName} — last {h.windowDays} days
        </p>
      </header>

      {empty ? (
        <div className="bg-card rounded-xl border p-8 text-center">
          <Sparkles className="mx-auto size-8" style={{ color: "#0d9488" }} />
          <h2 className="font-display mt-3 text-xl font-bold">Rani&apos;s ready to work</h2>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            No conversations yet. Connect your docs so Rani can answer from them, then embed her on your site.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link href="/knowledge" className="hover:bg-muted inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium">
              <BookOpen className="size-4" /> Connect your docs
            </Link>
            <Link href="/link" className="bg-gradient-primary text-primary-foreground shadow-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium">
              <Code2 className="size-4" /> Embed &amp; install
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi icon={MessagesSquare} label="Conversations" value={String(h.totalConversations)} />
            <Kpi icon={Gauge} label="Self-serve rate" value={h.selfServeRate == null ? "—" : `${h.selfServeRate}%`} hint="answered without a gap" />
            <Kpi icon={UserPlus} label="Leads captured" value={String(h.leadsCaptured)} />
            <Kpi icon={Clock} label="Avg response" value={fmtMs(h.avgResponseMs)} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="bg-card rounded-xl border p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-display font-bold">Questions Rani couldn&apos;t answer</h3>
                <Link href="/knowledge" className="text-xs font-medium hover:underline" style={{ color: "#0d9488" }}>
                  Fill your docs →
                </Link>
              </div>
              {h.gaps.length === 0 ? (
                <p className="text-muted-foreground mt-3 text-sm">No gaps — Rani had an answer for everything. 🎉</p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {h.gaps.map((g) => (
                    <li key={g.item} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <HelpCircle className="text-muted-foreground size-3.5 shrink-0" /> {g.item}
                      </span>
                      <span className="text-muted-foreground shrink-0 text-xs">{g.count}×</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-card rounded-xl border p-5">
              <h3 className="font-display font-bold">What people ask most</h3>
              {h.topAsks.length === 0 ? (
                <p className="text-muted-foreground mt-3 text-sm">Not enough data yet.</p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {h.topAsks.map((a) => (
                    <li key={a.item} className="flex items-center justify-between text-sm">
                      <span>{a.item}</span>
                      <span className="text-muted-foreground shrink-0 text-xs">{a.count}×</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="bg-card rounded-xl border p-5">
            <h3 className="font-display font-bold">How conversations felt</h3>
            <SentimentBar s={h.sentiment} />
          </div>
        </>
      )}
    </div>
  );
}

function SentimentBar({ s }: { s: { positive: number; neutral: number; negative: number } }) {
  const total = s.positive + s.neutral + s.negative;
  if (total === 0) return <p className="text-muted-foreground mt-3 text-sm">Not enough sentiment data yet.</p>;
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  return (
    <div className="mt-3">
      <div className="flex h-3 overflow-hidden rounded-full">
        <div style={{ width: pct(s.positive), background: "#14b8a6" }} />
        <div style={{ width: pct(s.neutral), background: "#cbd5e1" }} />
        <div style={{ width: pct(s.negative), background: "#fb923c" }} />
      </div>
      <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>😊 {pct(s.positive)} positive</span>
        <span>😐 {pct(s.neutral)} neutral</span>
        <span>🙁 {pct(s.negative)} negative</span>
      </div>
    </div>
  );
}
