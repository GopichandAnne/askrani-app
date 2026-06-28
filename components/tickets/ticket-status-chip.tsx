import type { TicketStatus } from "@/lib/tickets/types";
import { TICKET_STATUS_LABEL, ticketStatusVars } from "@/lib/tickets/types";
import { cn } from "@/lib/utils";

export function TicketStatusChip({
  status,
  className,
}: {
  status: TicketStatus;
  className?: string;
}) {
  const v = ticketStatusVars(status);
  return (
    <span
      style={{ color: v.color, backgroundColor: v.background }}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {TICKET_STATUS_LABEL[status]}
    </span>
  );
}
