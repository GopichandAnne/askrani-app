import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import type { Ticket } from "@/lib/tickets/types";
import { listConfigAudit, listRequests, listRequestTypes } from "@/app/(app)/requests/actions";
import { InboxTabs } from "@/components/inbox/inbox-tabs";

export const metadata: Metadata = { title: "Inbox · Ask Rani" };

const OPEN_TICKET = new Set(["created", "sent_to_owner"]);

export default async function InboxPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: store.id });

  const { data: ticketRows } = await supabase
    .from("tickets")
    .select("*")
    .eq("store_slug", store.slug)
    .order("created_at", { ascending: false })
    .limit(500);
  const tickets = (ticketRows ?? []) as Ticket[];

  // Requests are owner-only (the list actions gate + return [] otherwise).
  const [requests, types, audit] = isOwner
    ? await Promise.all([listRequests(), listRequestTypes(), listConfigAudit()])
    : [[], [], []];

  const openTickets = tickets.filter((t) => OPEN_TICKET.has(t.status)).length;
  const newRequests = requests.filter((r) => r.status === "new").length;

  return (
    <InboxTabs
      key={store.slug}
      tickets={tickets}
      requests={requests}
      types={types}
      audit={audit}
      storeName={store.name}
      isOwner={!!isOwner}
      openTickets={openTickets}
      newRequests={newRequests}
    />
  );
}
