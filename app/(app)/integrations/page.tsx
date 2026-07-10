import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { listIntegrations } from "./actions";
import { IntegrationsView } from "@/components/integrations/integrations-view";

export const metadata: Metadata = { title: "Integrations · Ask Rani" };

export default async function IntegrationsPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: store.id });
  if (!isOwner) redirect("/orders");

  const integrations = await listIntegrations();

  return <IntegrationsView key={store.slug} initial={integrations} storeName={store.name} />;
}
