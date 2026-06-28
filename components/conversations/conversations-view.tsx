"use client";

import { useMemo, useState } from "react";
import type { RoutingState, Thread } from "@/lib/conversations/types";
import { threadTitle } from "@/lib/conversations/types";
import { ThreadList } from "./thread-list";
import { ThreadPanel } from "./thread-panel";
import { Input } from "@/components/ui/input";
import { Search, MessagesSquare } from "lucide-react";

export function ConversationsView({
  initialThreads,
  storeName,
}: {
  initialThreads: Thread[];
  storeName: string;
}) {
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) =>
      `${threadTitle(t)} ${t.customer_phone ?? ""}`.toLowerCase().includes(q),
    );
  }, [threads, query]);

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
          <div className="border-b p-2">
            <div className="relative">
              <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or phone"
                className="pl-8"
              />
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
