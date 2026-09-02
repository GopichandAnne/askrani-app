"use client";

import { useEffect } from "react";

/**
 * Root-level graceful boundary. Catches client exceptions that escape past the
 * root layout / hydration — the ones that otherwise show Next's raw
 * "Application error: a client-side exception has occurred while loading …".
 *
 * The common, benign cause is a STALE BUNDLE after a deploy: an open or cached
 * tab still references old JS chunk hashes; once a new version ships those chunks
 * 404 and the import throws (ChunkLoadError) at the root. The fix is a hard reload
 * to fetch the fresh bundle. A sessionStorage timestamp bounds recovery so a
 * genuinely broken build can't reload-loop — after one attempt we show a calm
 * manual "Reload".
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global] render error:", error);
    const msg = `${error?.name ?? ""} ${error?.message ?? ""}`;
    const isChunk =
      error?.name === "ChunkLoadError" ||
      /chunk|dynamically imported module|Importing a module script failed|Failed to fetch/i.test(msg);

    const KEY = "ar_global_err_recovered_at";
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(KEY)) || 0;
    } catch {
      /* storage blocked */
    }
    // Already recovered in the last few seconds → stop; show the manual option.
    if (Date.now() - last < 8000) return;
    try {
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* ignore */
    }

    if (isChunk) {
      window.location.reload(); // stale bundle → fetch fresh chunks
    } else {
      const t = setTimeout(() => reset(), 500);
      return () => clearTimeout(t);
    }
  }, [error, reset]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          background: "#faf9f6",
          color: "#1b1a17",
        }}
      >
        <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
          <div>
            <div
              style={{
                width: 22,
                height: 22,
                margin: "0 auto 14px",
                border: "2px solid #0f766e",
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "arspin .8s linear infinite",
              }}
            />
            <p style={{ fontSize: 14, color: "#57606a", margin: "0 0 10px" }}>Reconnecting…</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                fontSize: 14,
                color: "#0f766e",
                background: "none",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              Reload
            </button>
          </div>
        </div>
        <style>{`@keyframes arspin{to{transform:rotate(360deg)}}`}</style>
      </body>
    </html>
  );
}
