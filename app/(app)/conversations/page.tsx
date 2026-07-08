import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { ConversationsView } from "@/components/conversations/conversations-view";
import { computeThreadSignals } from "@/lib/conversations/signals";

export const metadata: Metadata = { title: "Conversations · Ask Rani" };

export default async function ConversationsPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  const [{ data: threads }, { data: convs }] = await Promise.all([
    supabase
      .from("threads")
      .select("*")
      .eq("store_slug", store.slug)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200),
    supabase
      .from("conversations")
      .select("session_id, analytics_json, created_at")
      .eq("store_slug", store.slug)
      .order("created_at", { ascending: false })
      .limit(4000),
  ]);

  const signals = computeThreadSignals(threads ?? [], convs ?? []);

  return (
    <ConversationsView
      key={store.slug}
      initialThreads={threads ?? []}
      signals={signals}
      storeName={store.name}
    />
  );
}
