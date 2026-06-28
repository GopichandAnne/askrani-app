import type { Database } from "@/lib/database.types";

export type RoutingState = Database["public"]["Enums"]["routing_state"];
export type Thread = Database["public"]["Tables"]["threads"]["Row"];
export type ThreadMessage =
  Database["public"]["Tables"]["thread_messages"]["Row"];

/** The fields the thread view reads (messages + interleaved events). */
export type ConversationMessage = Pick<
  ThreadMessage,
  | "message_id"
  | "created_at"
  | "direction"
  | "sender"
  | "text"
  | "kind"
  | "event_type"
  | "related_order_id"
>;

/** Owner is actively handling the customer (the bot stays silent). */
export const isActive = (s: RoutingState) => s === "active_owner_handling";

export function threadTitle(t: Thread): string {
  return t.customer_name?.trim() || t.customer_phone || t.thread_id;
}
