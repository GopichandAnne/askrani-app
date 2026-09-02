import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { profileFor } from "@/lib/console-profile";
import HealthPage from "./health/page";
import OrdersPage from "./orders/page";

/**
 * Home → the profile's primary surface: the assistant's health for a SaaS/product
 * account, Orders for a local business.
 *
 * We render that surface INLINE rather than redirect()-ing to /health or /orders.
 * A page-level redirect on the initial post-login load turned into a client-side
 * navigation during hydration, which tripped React error #310 inside Next's own
 * App Router (`useMemo` over the URL) — the "Application error" flash that showed
 * only on login. Rendering here keeps the URL at "/" and avoids that transition
 * entirely; /health and /orders still exist as their own routes for the nav links.
 */
export default async function AppHome() {
  const ctx = await getActiveStore();
  if (!ctx?.active) redirect("/login");
  return profileFor(ctx.active.businessType) === "saas" ? <HealthPage /> : <OrdersPage />;
}
