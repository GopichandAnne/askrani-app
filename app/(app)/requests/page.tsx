import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { listRequests, listRequestTypes } from "./actions";
import { RequestsView } from "@/components/requests/requests-view";

export const metadata: Metadata = { title: "Requests · Ask Rani" };

export default async function RequestsPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: store.id });
  if (!isOwner) redirect("/orders");

  const [requests, types] = await Promise.all([listRequests(), listRequestTypes()]);

  return (
    <RequestsView key={store.slug} requests={requests} types={types} storeName={store.name} />
  );
}
