"use client";

import { isActive, threadTitle, type Thread } from "@/lib/conversations/types";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ThreadList({
  threads,
  selectedId,
  onSelect,
}: {
  threads: Thread[];
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
            </button>
          </li>
        );
      })}
    </ul>
  );
}
