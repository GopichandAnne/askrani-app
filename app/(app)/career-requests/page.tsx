import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { listCareerRequests } from "./actions";
import { CareerRequestsView } from "@/components/career-requests/career-requests-view";

export const metadata: Metadata = { title: "Career requests · Ask Rani" };

export default async function CareerRequestsPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: store.id });
  if (!isOwner) redirect("/orders");

  const requests = await listCareerRequests();

  return <CareerRequestsView key={store.slug} initial={requests} storeName={store.name} />;
}
