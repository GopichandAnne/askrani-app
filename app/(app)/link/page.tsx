import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { profileFor, homeHrefFor } from "@/lib/console-profile";
import { StoreLinkPanel } from "@/components/store-link/store-link-panel";
import { SignedInEmbedGuide } from "@/components/store-link/signed-in-embed-guide";
import { IdentityProviders } from "@/components/store-link/identity-providers";
import { SsoDevTools } from "@/components/members/sso-dev-tools";
import { SlackConnect } from "@/components/store-link/slack-connect";
import { TeamsConnect } from "@/components/store-link/teams-connect";

export const metadata: Metadata = { title: "Web chat link · Ask Rani" };

export default async function LinkPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  // Owner-only screen (nav is owner-gated too; enforce here as well).
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: store.id });
  if (!isOwner && !ctx.isPlatformAdmin) redirect(homeHrefFor(profileFor(store.businessType)));
  const isSaas = profileFor(store.businessType) === "saas";
  // The publishable key, so the signed-in guide can show a ready-to-copy snippet.
  const { data: tok } = await supabase
    .from("store_tokens")
    .select("token")
    .eq("store_id", store.id)
    .eq("active", true)
    .like("token", "pk_live_%")
    .maybeSingle();
  const pubKey = (tok as { token?: string } | null)?.token ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <header>
        <h1 className="font-display text-2xl italic">{isSaas ? "Embed & install" : "Web chat link"}</h1>
        <p className="text-muted-foreground text-sm">
          {store.name} — {isSaas ? "your embed snippet, QR, and shareable chat link" : "your in-store QR and shareable chat link"}
        </p>
      </header>
      <div className="bg-card rounded-lg border p-5">
        <StoreLinkPanel key={store.slug} storeId={store.id} storeSlug={store.slug} storeName={store.name} />
      </div>
      {isSaas && <SlackConnect storeId={store.id} />}
      {isSaas && <TeamsConnect storeId={store.id} />}
      {isSaas && <SignedInEmbedGuide pubKey={pubKey} />}
      {isSaas && <IdentityProviders storeId={store.id} />}
      {isSaas && <SsoDevTools storeId={store.id} />}
    </div>
  );
}
