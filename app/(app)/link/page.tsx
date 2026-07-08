import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { StoreLinkPanel } from "@/components/store-link/store-link-panel";

export const metadata: Metadata = { title: "Web chat link · Ask Rani" };

export default async function LinkPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  // Owner-only screen (nav is owner-gated too; enforce here as well).
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: store.id });
  if (!isOwner && !ctx.isPlatformAdmin) redirect("/orders");

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <header>
        <h1 className="font-display text-2xl italic">Web chat link</h1>
        <p className="text-muted-foreground text-sm">
          {store.name} — your in-store QR and shareable chat link
        </p>
      </header>
      <div className="bg-card rounded-lg border p-5">
        <StoreLinkPanel key={store.slug} storeId={store.id} storeSlug={store.slug} storeName={store.name} />
      </div>
    </div>
  );
}
