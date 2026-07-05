"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  isActive,
  threadTitle,
  type ConversationMessage,
  type RoutingState,
  type Thread,
} from "@/lib/conversations/types";
import { sendMessage, setRouting } from "@/app/(app)/conversations/actions";
import { MessageList } from "./message-list";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MessagesSquare, Send } from "lucide-react";
import { cn } from "@/lib/utils";

export function ThreadPanel({
  thread,
  onRouting,
}: {
  thread: Thread | null;
  onRouting: (threadId: string, next: RoutingState) => void;
}) {
  const [messages, setMessages] = useState<ConversationMessage[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const [sending, startSend] = useTransition();

  const threadId = thread?.thread_id;

  const loadMessages = useCallback(async (id: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("thread_messages")
      .select(
        "message_id, created_at, direction, sender, text, kind, event_type, related_order_id",
      )
      .eq("thread_id", id)
      .order("created_at", { ascending: true });
    return (data as ConversationMessage[]) ?? [];
  }, []);

  useEffect(() => {
    if (!threadId) return;
    let active = true;
    setMessages(null);
    loadMessages(threadId).then((rows) => {
      if (active) setMessages(rows);
    });
    return () => {
      active = false;
    };
  }, [threadId, loadMessages]);

  if (!thread) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <MessagesSquare className="size-6" />
        <p className="text-sm">Select a conversation to view it.</p>
      </div>
    );
  }

  const active = isActive(thread.routing_state);

  function send() {
    const body = draft.trim();
    if (!body) return;
    startSend(async () => {
      const res = await sendMessage(thread!.thread_id, body);
      if (res.ok) {
        setMessages((prev) => [...(prev ?? []), res.message]);
        setDraft("");
      } else {
        toast.error("Couldn't send", { description: res.error });
      }
    });
  }

  function toggle(next: RoutingState) {
    startTransition(async () => {
      const res = await setRouting(thread!.thread_id, next);
      if (res.ok) {
        onRouting(thread!.thread_id, res.routing_state);
        toast.success(
          next === "active_owner_handling"
            ? "You're now handling this conversation"
            : "Conversation handed back to Rani",
        );
        // Refresh so the new routing_state_changed event shows in the timeline.
        loadMessages(thread!.thread_id).then(setMessages);
      } else {
        toast.error("Couldn't update routing", { description: res.error });
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b p-4">
        <div className="min-w-0">
          <p className="truncate font-medium">{threadTitle(thread)}</p>
          {thread.customer_phone && (
            <p className="text-muted-foreground text-xs">
              {thread.customer_phone}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
              active
                ? "bg-teal-mist text-teal-deep dark:bg-secondary dark:text-teal-light"
                : "bg-muted text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                active ? "bg-teal animate-live-pulse" : "bg-muted-foreground/50",
              )}
            />
            {active ? "Owner handling" : "Rani (idle)"}
          </span>
          {active ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => toggle("idle")}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Mark resolved
            </Button>
          ) : (
            <Button size="sm" disabled={pending} onClick={() => toggle("active_owner_handling")}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Start messaging
            </Button>
          )}
        </div>
      </header>

      {active && (
        <div className="bg-teal-mist text-teal-deep dark:bg-secondary dark:text-secondary-foreground border-b px-4 py-2 text-xs">
          You&apos;re handling this conversation — Rani is paused. Mark it
          resolved to hand it back.
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <MessageList messages={messages} />
      </div>

      {active ? (
        <form
          className="flex items-end gap-2 border-t p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Message the customer as Rani…  (Enter to send, Shift+Enter for a new line)"
            className="max-h-32 min-h-9 flex-1 resize-none"
            disabled={sending}
          />
          <Button type="submit" size="icon" disabled={sending || !draft.trim()} aria-label="Send">
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </form>
      ) : (
        <div className="text-muted-foreground border-t px-4 py-3 text-center text-xs">
          Rani is handling this conversation. Click “Start messaging” to take over and reply.
        </div>
      )}
    </div>
  );
}
