import type { Database } from "@/lib/database.types";

export type Ticket = Database["public"]["Tables"]["tickets"]["Row"];
export type TicketStatus = Database["public"]["Enums"]["ticket_status"];

/** Lifecycle order, for filter tabs. */
export const TICKET_STATUSES: TicketStatus[] = [
  "created",
  "sent_to_owner",
  "answered",
  "timed_out",
];

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  created: "Created",
  sent_to_owner: "Sent to owner",
  answered: "Answered",
  timed_out: "Timed out",
};

/**
 * Chip colors reuse the order-status CSS vars from tokens.css so the palette
 * stays the single source of truth.
 *   created -> grey, sent_to_owner -> amber, answered -> green, timed_out -> red
 */
export function ticketStatusVars(status: TicketStatus): {
  color: string;
  background: string;
} {
  const map: Record<TicketStatus, string> = {
    created: "placed",
    sent_to_owner: "submitted",
    answered: "fulfilled",
    timed_out: "rejected",
  };
  const k = map[status];
  return { color: `var(--status-${k})`, background: `var(--status-${k}-bg)` };
}
