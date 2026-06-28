/**
 * Human labels for thread_messages event_type values (kind = 'event').
 * Shared by the Orders timeline and the Conversations thread view. The bot is
 * out of scope and may emit new types, so unknown values fall back to the raw
 * string via eventLabel().
 */
export const EVENT_LABEL: Record<string, string> = {
  order_created: "Order created",
  order_proposed: "Proposed to customer",
  order_confirmed: "Order confirmed",
  order_cancelled: "Order cancelled",
  price_edited: "Price edited",
  ticket_opened: "Ticket opened",
  ticket_resolved: "Ticket resolved",
  routing_state_changed: "Routing changed",
};

export function eventLabel(eventType: string | null | undefined): string {
  if (!eventType) return "Event";
  return EVENT_LABEL[eventType] ?? eventType;
}
