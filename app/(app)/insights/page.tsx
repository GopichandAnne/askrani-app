import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { Button } from "@/components/ui/button";
import { ExternalLink, Telescope } from "lucide-react";

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
  const enabled = ctx.active.insightsEnabled && !error;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-10 text-center">
      <div className="bg-muted grid size-14 place-items-center rounded-2xl">
        <Telescope className="text-foreground/70 size-7" />
      </div>
      <div className="space-y-1">
        <h1 className="font-display text-xl italic">Ask Rani Insights</h1>
        <p className="text-muted-foreground text-sm">
          Local market intelligence for {ctx.active.name} — competitor pricing, reviews and social,
          plus a weekly plan of what to do next.
        </p>
      </div>

      {enabled ? (
        <>
          {/* Opens Insights in its own tab: it runs first-party there, so sign-in
              is rock-solid across every browser (no third-party-cookie issues).
              The /api/insights/sso route mints the handoff token and redirects. */}
          <Button asChild size="lg">
            <a href="/api/insights/sso" target="_blank" rel="noopener noreferrer">
              Open Insights
              <ExternalLink className="size-4" />
            </a>
          </Button>
          <p className="text-muted-foreground text-xs">Opens in a new tab · you&apos;ll be signed in automatically.</p>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          {(error && ERRORS[error]) ||
            "Ask your Ask Rani admin to switch Insights on for this store."}
        </p>
      )}
    </div>
  );
}
