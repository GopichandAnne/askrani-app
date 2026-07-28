import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { VoiceCard } from "@/components/agent/voice-card";
import { StreakCard } from "@/components/agent/streak-card";
import { PosCard, type PosProviderState } from "@/components/diner/pos-card";
import { TableQrs } from "@/components/store-link/table-qrs";
import { configuredAdapters } from "@/lib/pos/registry";
import { getPosCreds } from "@/lib/pos/credentials";
import { Button } from "@/components/ui/button";
import { Utensils, Flame, Leaf, Star, ArrowRight, QrCode } from "lucide-react";

export const metadata: Metadata = { title: "Diner · Ask Rani" };

/**
 * Restaurant "Diner" config home — one place for everything a guest experiences
 * when they scan a table QR: the menu, the table QRs, Rani's voice, and rewards.
 * These settings live on several generic pages; this gathers them, restaurant-
 * framed, so an owner isn't hunting. Restaurant-only (redirects other verticals).
 */
export default async function DinerPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: store.id });
  if (!isOwner) redirect("/orders");
  // This home is the restaurant diner console; other verticals don't have it.
  if (store.businessType !== "restaurant") redirect("/agent");

  const [cfgRes, tokRes, prodRes] = await Promise.all([
    supabase
      .from("agent_config")
      .select("key, value")
      .eq("store_id", store.id)
      .in("key", ["streak_goal", "streak_bonus_cents", "streak_cap_cents"]),
    supabase
      .from("store_tokens")
      .select("token")
      .eq("store_id", store.id)
      .is("listing_ref", null)
      .eq("active", true)
      .limit(1),
    supabase.from("products").select("heat, dietary, featured").eq("store_id", store.id).limit(2000),
  ]);

  const cfg: Record<string, string> = {};
  for (const r of cfgRes.data ?? []) cfg[r.key] = r.value ?? "";
  const token = tokRes.data?.[0]?.token ?? null;

  // Build the connectable-POS list (only providers whose server env is set).
  const posProviders: PosProviderState[] = await Promise.all(
    configuredAdapters().map(async (a) => {
      const creds = await getPosCreds(a.id, store.id);
      return {
        id: a.id,
        label: a.label,
        connected: !!creds,
        locationName: creds?.location_name ?? null,
        environment: a.environment(),
      };
    }),
  );

  const products = prodRes.data ?? [];
  const dishes = products.length;
  const spiceTagged = products.filter((p) => p.heat).length;
  const dietaryTagged = products.filter((p) => (p.dietary ?? []).length > 0).length;
  const specials = products.filter((p) => p.featured).length;

  const stats = [
    { icon: Utensils, label: "dishes", value: dishes },
    { icon: Flame, label: "spice-tagged", value: spiceTagged },
    { icon: Leaf, label: "dietary-tagged", value: dietaryTagged },
    { icon: Star, label: "specials", value: specials },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-center gap-2">
        <Utensils className="text-muted-foreground size-5" />
        <div>
          <h1 className="font-display text-2xl italic">Diner</h1>
          <p className="text-muted-foreground text-sm">{store.name}</p>
        </div>
      </header>

      <p className="text-muted-foreground text-sm">
        Everything a guest experiences when they scan a table QR — Rani serves
        them the menu, takes the order, and earns them rewards. Set it all up here.
      </p>

      {/* Menu at a glance */}
      <div className="bg-card space-y-4 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">Your menu</h2>
            <p className="text-muted-foreground text-sm">
              Dishes, photos, prices, spice and dietary tags — Rani serves exactly what&apos;s here.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/inventory">
              Manage menu <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-muted/40 flex flex-col items-center gap-1 rounded-lg border p-3 text-center">
              <s.icon className="text-teal-deep size-4" />
              <span className="text-xl font-semibold tabular-nums">{s.value}</span>
              <span className="text-muted-foreground text-xs">{s.label}</span>
            </div>
          ))}
        </div>
        {dishes > 0 && spiceTagged < dishes && (
          <p className="text-muted-foreground text-xs">
            {dishes - spiceTagged} dish{dishes - spiceTagged === 1 ? "" : "es"} still untagged for spice —
            tag them so guests can filter by heat. Mark your best sellers as specials to feature them up top.
          </p>
        )}
      </div>

      {/* Table QR codes */}
      <div className="bg-card rounded-lg border p-4">
        <h2 className="text-sm font-medium">Tables</h2>
        {token ? (
          <TableQrs storeSlug={store.slug} storeName={store.name} token={token} />
        ) : (
          <div className="text-muted-foreground mt-2 flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <QrCode className="size-4" /> Create your web link first, then table QRs appear here.
            </span>
            <Button asChild size="sm" variant="outline">
              <Link href="/link">Web Chat <ArrowRight className="size-4" /></Link>
            </Button>
          </div>
        )}
      </div>

      {/* Point of sale — approved orders route to the connected location */}
      <PosCard providers={posProviders} />

      {/* Rani's voice */}
      <VoiceCard />

      {/* Rewards & streaks */}
      <StreakCard
        initialGoal={cfg.streak_goal ?? ""}
        initialBonusCents={cfg.streak_bonus_cents ?? ""}
        initialCapCents={cfg.streak_cap_cents ?? ""}
      />
    </div>
  );
}
