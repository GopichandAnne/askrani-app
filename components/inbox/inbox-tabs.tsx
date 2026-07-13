"use client";

import { useState } from "react";
import { TicketsView } from "@/components/tickets/tickets-view";
import { RequestsView } from "@/components/requests/requests-view";
import type { Ticket } from "@/lib/tickets/types";
import type {
  CapturedRequest,
  ConfigAuditEntry,
  RequestType,
} from "@/app/(app)/requests/actions";

/** One roof for the two "needs attention" surfaces: Questions (tickets Rani
 *  couldn't answer) and Requests (structured captures). Each tab renders its own
 *  existing view; Requests is owner-only. */
export function InboxTabs({
  tickets,
  requests,
  types,
  audit,
  storeName,
  isOwner,
  openTickets,
  newRequests,
}: {
  tickets: Ticket[];
  requests: CapturedRequest[];
  types: RequestType[];
  audit: ConfigAuditEntry[];
  storeName: string;
  isOwner: boolean;
  openTickets: number;
  newRequests: number;
}) {
  const [tab, setTab] = useState<"questions" | "requests">("questions");

  function Pill({ id, label, count }: { id: "questions" | "requests"; label: string; count: number }) {
    const active = tab === id;
    return (
      <button
        onClick={() => setTab(id)}
        className={
          "flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors " +
          (active ? "bg-gradient-primary text-primary-foreground shadow-primary" : "text-muted-foreground hover:bg-muted")
        }
      >
        {label}
        {count > 0 && (
          <span
            className={
              "rounded-full px-1.5 py-0 text-[10px] font-semibold " +
              (active ? "bg-white/25 text-white" : "bg-teal text-white")
            }
          >
            {count}
          </span>
        )}
      </button>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-6 pt-5">
        <Pill id="questions" label="Questions" count={openTickets} />
        {isOwner && <Pill id="requests" label="Requests" count={newRequests} />}
      </div>

      {tab === "questions" ? (
        <TicketsView initialTickets={tickets} storeName={storeName} />
      ) : (
        <RequestsView requests={requests} types={types} audit={audit} storeName={storeName} />
      )}
    </div>
  );
}
