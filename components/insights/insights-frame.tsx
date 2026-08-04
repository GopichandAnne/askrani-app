"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * Embeds the Ask Rani Insights app. The iframe points at our own
 * /api/insights/sso handoff route, which mints a fresh signed token and 302s into
 * Insights — so the token never appears in this page's HTML and every open
 * re-establishes the session (resilient to third-party-cookie partitioning).
 */
export function InsightsFrame() {
  const [loading, setLoading] = useState(true);
  return (
    <div className="relative h-[calc(100dvh-3.5rem)] w-full">
      {loading && (
        <div className="text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Opening Insights…
        </div>
      )}
      <iframe
        src="/api/insights/sso"
        title="Ask Rani Insights"
        className="h-full w-full border-0"
        onLoad={() => setLoading(false)}
        allow="clipboard-write; geolocation"
      />
    </div>
  );
}
