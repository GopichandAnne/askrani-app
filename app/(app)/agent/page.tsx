import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { AgentView } from "@/components/agent/agent-view";
import { listResponders } from "./actions";

export const metadata: Metadata = { title: "Agent · Ask Rani" };

export default async function AgentPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  // Owner-only screen (nav is owner-gated too; enforce here as well).
  const { data: isOwner } = await supabase.rpc("user_is_owner", {
    p_store_id: store.id,
  });
  if (!isOwner) redirect("/orders");

  const [{ data: rows }, responders] = await Promise.all([
    supabase.from("agent_config").select("key, value").eq("store_id", store.id),
    listResponders(),
  ]);

  const config: Record<string, string> = {};
  for (const r of rows ?? []) config[r.key] = r.value ?? "";

  return (
    <AgentView
      key={store.slug}
      initialConfig={config}
      initialResponders={responders}
      storeName={store.name}
    />
  );
}
