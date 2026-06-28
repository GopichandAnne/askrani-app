import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import type { Ticket } from "@/lib/tickets/types";
import { TicketsView } from "@/components/tickets/tickets-view";

export const metadata: Metadata = { title: "Tickets · Ask Rani" };

export default async function TicketsPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  const { data: tickets } = await supabase
    .from("tickets")
    .select("*")
    .eq("store_slug", store.slug)
    .order("created_at", { ascending: false })
    .limit(500);

  return (
    <TicketsView
      key={store.slug}
      initialTickets={(tickets ?? []) as Ticket[]}
      storeName={store.name}
    />
  );
}
