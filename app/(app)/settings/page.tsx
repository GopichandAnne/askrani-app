import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { profileFor, homeHrefFor } from "@/lib/console-profile";
import { StoreSettings } from "@/components/settings/store-settings";

export const metadata: Metadata = { title: "Settings · Ask Rani" };

export default async function SettingsPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: store.id });
  if (!isOwner && !ctx.isPlatformAdmin) redirect(homeHrefFor(profileFor(store.businessType)));

  return (
    <StoreSettings
      key={store.slug}
      storeId={store.id}
      storeName={store.name}
      businessType={store.businessType}
      canChangeType={ctx.isPlatformAdmin}
    />
  );
}
