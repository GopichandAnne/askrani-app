"use client";

import { useMemo, useState } from "react";
import type { RoutingState, Thread } from "@/lib/conversations/types";
import { threadTitle } from "@/lib/conversations/types";
import { needsAttention, type ThreadSignal } from "@/lib/conversations/signals";
import { ThreadList } from "./thread-list";
import { ThreadPanel } from "./thread-panel";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Search, MessagesSquare } from "lucide-react";

export function ConversationsView({
  initialThreads,
  signals,
  storeName,
}: {
  initialThreads: Thread[];
  signals: Record<string, ThreadSignal>;
  storeName: string;
}) {
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);

  const attentionCount = useMemo(
    () => threads.filter((t) => needsAttention(signals[t.thread_id])).length,
    [threads, signals],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads.filter((t) => {
      if (attentionOnly && !needsAttention(signals[t.thread_id])) return false;
      if (!q) return true;
      return `${threadTitle(t)} ${t.customer_phone ?? ""}`.toLowerCase().includes(q);
    });
  }, [threads, query, attentionOnly, signals]);

  const selected = threads.find((t) => t.thread_id === selectedId) ?? null;

  function onRouting(threadId: string, next: RoutingState) {
    setThreads((prev) =>
      prev.map((t) =>
        t.thread_id === threadId ? { ...t, routing_state: next } : t,
      ),
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b p-4">
        <h1 className="font-display text-2xl italic">Conversations</h1>
        <p className="text-muted-foreground text-sm">{storeName}</p>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r">
          <div className="space-y-2 border-b p-2">
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or phone"
                className="pl-8"
              />
            </div>
            <div className="flex gap-1.5">
              <FilterChip active={!attentionOnly} onClick={() => setAttentionOnly(false)}>
                All
              </FilterChip>
              <FilterChip active={attentionOnly} onClick={() => setAttentionOnly(true)}>
                Needs attention{attentionCount > 0 ? ` · ${attentionCount}` : ""}
              </FilterChip>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {threads.length === 0 ? (
              <div className="text-muted-foreground flex flex-col items-center gap-2 p-8 text-center text-sm">
                <MessagesSquare className="size-5" />
                <p>No conversations yet for {storeName}.</p>
              </div>
            ) : (
              <ThreadList
                threads={filtered}
                signals={signals}
                selectedId={selectedId}
                onSelect={(t) => setSelectedId(t.thread_id)}
              />
            )}
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <ThreadPanel thread={selected} onRouting={onRouting} />
        </section>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-gradient-primary text-primary-foreground border-transparent"
          : "text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
