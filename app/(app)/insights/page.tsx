import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { InsightsFrame } from "@/components/insights/insights-frame";
import { Telescope } from "lucide-react";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  not_enabled: "Insights isn't enabled for this store.",
  not_configured: "Insights isn't configured yet. Contact support.",
  no_email: "Your account has no email on file, which Insights needs to sign you in.",
};

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const ctx = await getActiveStore();
  if (!ctx?.active) redirect("/login");

  const { error } = await searchParams;

  // Entitlement gate (also enforced server-side in the /api/insights/sso handoff).
  if (!ctx.active.insightsEnabled || error) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 p-10 text-center">
        <div className="bg-muted grid size-12 place-items-center rounded-full">
          <Telescope className="text-muted-foreground size-6" />
        </div>
        <h1 className="font-display text-xl italic">Ask Rani Insights</h1>
        <p className="text-muted-foreground text-sm">
          {(error && ERRORS[error]) ||
            "Local market intelligence for your business — competitor pricing, reviews, social and a weekly plan."}
        </p>
        <p className="text-muted-foreground text-xs">
          {ctx.active.insightsEnabled
            ? "Try reopening from the sidebar."
            : "Ask your Ask Rani admin to switch it on for this store."}
        </p>
      </div>
    );
  }

  return <InsightsFrame />;
}
