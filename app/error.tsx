"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";

/**
 * Graceful boundary for the control panel. A transient first-render blip — e.g. a
 * cold `getUser()` over the network right after login — would otherwise surface
 * Next's raw "Application error: a client-side exception" flash. Here we quietly
 * auto-retry ONCE (self-heals the blip), and if it recurs we show a calm manual
 * retry instead of a scary crash. A sessionStorage timestamp bounds the auto-retry
 * so a genuinely broken page can't loop.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] render error:", error);
    const KEY = "ar_err_retry_at";
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(KEY)) || 0;
    } catch {
      /* private mode / storage blocked */
    }
    // Already auto-retried in the last few seconds → stop; show the manual retry.
    if (Date.now() - last < 5000) return;
    try {
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    const t = setTimeout(() => reset(), 400);
    return () => clearTimeout(t);
  }, [error, reset]);

  return (
    <div className="grid min-h-[60vh] place-items-center p-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
        <p className="text-muted-foreground text-sm">Reconnecting…</p>
        <button
          type="button"
          onClick={() => reset()}
          className="text-teal text-sm font-medium hover:underline"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
