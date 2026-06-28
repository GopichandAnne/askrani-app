import type { ConversationMessage } from "@/lib/conversations/types";
import { eventLabel } from "@/lib/conversations/events";
import { formatDateTime } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Interleaved chat view: customer/agent message bubbles and inline event chips,
 * in created_at order. Chat-bubble styling echoes the marketing site (teal-mist
 * tint for agent/owner, white/muted for the customer).
 */
export function MessageList({
  messages,
}: {
  messages: ConversationMessage[] | null;
}) {
  if (messages == null) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="ml-auto h-10 w-1/2" />
        <Skeleton className="h-10 w-3/5" />
      </div>
    );
  }
  if (messages.length === 0) {
    return (
      <p className="text-muted-foreground p-6 text-center text-sm">
        No messages in this conversation yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {messages.map((m) => {
        if (m.kind === "event") {
          return (
            <div key={m.message_id} className="flex justify-center">
              <span className="bg-secondary text-secondary-foreground inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium">
                {eventLabel(m.event_type)}
                {m.related_order_id && (
                  <span className="font-mono opacity-70">
                    {m.related_order_id}
                  </span>
                )}
                <span className="text-muted-foreground font-normal">
                  {formatDateTime(m.created_at)}
                </span>
              </span>
            </div>
          );
        }

        // A system message (not an event) — centered, muted.
        if (m.direction === "system") {
          return (
            <p
              key={m.message_id}
              className="text-muted-foreground text-center text-xs"
            >
              {m.text} · {formatDateTime(m.created_at)}
            </p>
          );
        }

        const inbound = m.direction === "inbound";
        return (
          <div
            key={m.message_id}
            className={cn("flex", inbound ? "justify-start" : "justify-end")}
          >
            <div
              className={cn(
                "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm",
                inbound
                  ? "bg-card text-card-foreground rounded-tl-sm border"
                  : "bg-teal-mist text-teal-deep dark:bg-secondary dark:text-secondary-foreground rounded-tr-sm",
              )}
            >
              {m.text && <p className="whitespace-pre-wrap">{m.text}</p>}
              <p
                className={cn(
                  "mt-1 text-[10px]",
                  inbound ? "text-muted-foreground" : "text-teal-deep/70 dark:text-muted-foreground",
                )}
              >
                {m.sender ?? (inbound ? "customer" : "agent")} ·{" "}
                {formatDateTime(m.created_at)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
