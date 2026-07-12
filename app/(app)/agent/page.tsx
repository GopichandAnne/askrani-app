import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { AgentView } from "@/components/agent/agent-view";
import { listResponders } from "./actions";
import { listRequestTypes } from "@/app/(app)/requests/actions";

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

  const [{ data: rows }, responders, requestTypes] = await Promise.all([
    supabase.from("agent_config").select("key, value").eq("store_id", store.id),
    listResponders(),
    listRequestTypes(),
  ]);

  const config: Record<string, string> = {};
  for (const r of rows ?? []) config[r.key] = r.value ?? "";

  // Built-in topics + any request types this store defined (dynamic).
  const topics = [
    { key: "escalation", label: "Escalations" },
    { key: "order", label: "Orders" },
    ...requestTypes.map((t) => ({ key: t.key, label: t.label })),
  ];

  return (
    <AgentView
      key={store.slug}
      initialConfig={config}
      initialResponders={responders}
      topics={topics}
      storeName={store.name}
    />
  );
}
