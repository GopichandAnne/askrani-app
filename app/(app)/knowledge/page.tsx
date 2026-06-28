import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import type { SavedQA } from "@/lib/knowledge/types";
import { KnowledgeView } from "@/components/knowledge/knowledge-view";

export const metadata: Metadata = { title: "Knowledge · Ask Rani" };

export default async function KnowledgePage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  const { data: entries } = await supabase
    .from("saved_qa")
    .select("*")
    .eq("store_id", store.id)
    .order("created_at", { ascending: false })
    .limit(1000);

  return (
    <KnowledgeView
      key={store.slug}
      initialEntries={(entries ?? []) as SavedQA[]}
      storeName={store.name}
    />
  );
}
