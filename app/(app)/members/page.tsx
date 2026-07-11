import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { MembersManager } from "@/components/members/members-manager";

export const metadata: Metadata = { title: "Members · Ask Rani" };

export default async function MembersPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: store.id });
  if (!isOwner && !ctx.isPlatformAdmin) redirect("/orders");

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <header>
        <h1 className="font-display text-2xl italic">Members &amp; access</h1>
        <p className="text-muted-foreground text-sm">
          {store.name} — who can use the agent, their roles, and how they&apos;re recognized
        </p>
      </header>
      <div className="bg-card rounded-lg border p-5">
        <MembersManager storeId={store.id} />
      </div>
    </div>
  );
}
