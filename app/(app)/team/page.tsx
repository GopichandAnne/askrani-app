import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { TeamManager } from "@/components/team/team-manager";

export const metadata: Metadata = { title: "Team · Ask Rani" };

export default async function TeamPage() {
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
        <h1 className="font-display text-2xl italic">Team</h1>
        <p className="text-muted-foreground text-sm">
          {store.name} — owners and staff who can log into this panel. (Your customers live in Members.)
        </p>
      </header>
      <div className="bg-card rounded-lg border p-5">
        <TeamManager storeId={store.id} storeName={store.name} />
      </div>
    </div>
  );
}
