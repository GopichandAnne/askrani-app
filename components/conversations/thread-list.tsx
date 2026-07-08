"use client";

import { isActive, threadTitle, type Thread } from "@/lib/conversations/types";
import type { ThreadSignal } from "@/lib/conversations/signals";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

function SignalBadges({ sig }: { sig: ThreadSignal | undefined }) {
  if (!sig) return null;
  const badges: { label: string; className: string }[] = [];
  if (sig.complaint) badges.push({ label: "Complaint", className: "bg-coral/15 text-coral-dark" });
  if (sig.frustrated) badges.push({ label: "Frustrated", className: "bg-coral/15 text-coral-dark" });
  if (sig.feedback) badges.push({ label: "Feedback", className: "bg-teal-mist text-teal-deep" });
  if (badges.length === 0 && sig.sentiment === "negative")
    badges.push({ label: "Negative", className: "bg-coral/15 text-coral-dark" });
  if (badges.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {badges.map((b) => (
        <span key={b.label} className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", b.className)}>
          {b.label}
        </span>
      ))}
    </div>
  );
}

export function ThreadList({
  threads,
  signals,
  selectedId,
  onSelect,
}: {
  threads: Thread[];
  signals: Record<string, ThreadSignal>;
  selectedId: string | null;
  onSelect: (thread: Thread) => void;
}) {
  if (threads.length === 0) {
    return (
      <p className="text-muted-foreground p-6 text-center text-sm">
        No conversations match.
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {threads.map((t) => {
        const active = isActive(t.routing_state);
        const selected = t.thread_id === selectedId;
        return (
          <li key={t.thread_id}>
            <button
              type="button"
              onClick={() => onSelect(t)}
              aria-pressed={selected}
              className={cn(
                "w-full px-4 py-3 text-left transition-colors",
                selected
                  ? "bg-teal-mist/60 dark:bg-secondary"
                  : "hover:bg-muted/50",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {threadTitle(t)}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {formatRelative(t.last_message_at)}
                </span>
              </div>
              <div className="text-muted-foreground mt-1 flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{t.customer_phone}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {t.message_count > 0 && <span>{t.message_count} msgs</span>}
                  {active && (
                    <span className="text-teal-deep dark:text-teal-light inline-flex items-center gap-1 font-medium">
                      <span className="bg-teal size-1.5 animate-live-pulse rounded-full" />
                      handling
                    </span>
                  )}
                </span>
              </div>
              <SignalBadges sig={signals[t.thread_id]} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
