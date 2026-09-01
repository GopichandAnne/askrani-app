import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import {
  computeDashboard,
  type ConvRow,
  type OrderRow,
} from "@/lib/dashboard/metrics";
import { computeSaasDashboard, type LeadRow } from "@/lib/dashboard/saas-dashboard";
import { profileFor } from "@/lib/console-profile";
import { Dashboard } from "@/components/dashboard/dashboard";
import { SaasDashboard } from "@/components/dashboard/saas-dashboard";

export const metadata: Metadata = { title: "Dashboard · Ask Rani" };

export default async function DashboardPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;

  // Server-side owner gate: non-owners never get the dashboard data, even if
  // they navigate here directly. (The nav link is also hidden for staff.)
  const isOwner = ctx.isPlatformAdmin || store.role === "owner";
  if (!isOwner) return <OwnersOnly />;

  const supabase = await createClient();
  const convsQuery = supabase
    .from("conversations")
    .select("timestamp, device_type, analytics_json, response_time_ms, created_at")
    .eq("store_slug", store.slug)
    .order("created_at", { ascending: false })
    .limit(8000);

  // SaaS/product accounts don't take orders — show conversations + captured
  // leads instead of an all-zero orders board.
  if (profileFor(store.businessType) === "saas") {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [convsRes, leadsRes] = await Promise.all([
      convsQuery,
      supabase
        .from("requests")
        .select("type, status, created_at")
        .eq("store_id", store.id)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000),
    ]);
    const metrics = computeSaasDashboard(
      (convsRes.data ?? []) as ConvRow[],
      (leadsRes.data ?? []) as LeadRow[],
    );
    return <SaasDashboard metrics={metrics} storeName={store.name} />;
  }

  const [ordersRes, convsRes] = await Promise.all([
    supabase
      .from("orders")
      .select("status, timestamp, total, created_at")
      .eq("store_slug", store.slug)
      .order("created_at", { ascending: false })
      .limit(3000),
    convsQuery,
  ]);

  const metrics = computeDashboard(
    (ordersRes.data ?? []) as OrderRow[],
    (convsRes.data ?? []) as ConvRow[],
  );

  return <Dashboard metrics={metrics} storeName={store.name} />;
}

function OwnersOnly() {
  return (
    <div className="mx-auto max-w-md p-10 text-center">
      <h1 className="font-display text-2xl italic">Dashboard</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        This page is for store owners. Ask an owner for access.
      </p>
    </div>
  );
}
