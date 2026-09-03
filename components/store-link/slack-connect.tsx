"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getSlackStatus, type SlackStatus } from "@/app/(app)/link/slack-actions";
import { Button } from "@/components/ui/button";
import { Check, Loader2, MessageSquare } from "lucide-react";

const NOTES: Record<string, { ok: boolean; msg: string }> = {
  connected: { ok: true, msg: "Slack connected — Rani is now a teammate in that workspace." },
  denied: { ok: false, msg: "Slack install was cancelled." },
  badstate: { ok: false, msg: "That install link expired — try again." },
  error: { ok: false, msg: "Slack couldn't complete the install. Please try again." },
  unconfigured: { ok: false, msg: "Slack isn't fully configured yet." },
};

export function SlackConnect({ storeId }: { storeId: string }) {
  const [status, setStatus] = useState<SlackStatus | null>(null);

  useEffect(() => {
    // Surface the OAuth callback result (?slack=…) once, then clean the URL.
    try {
      const p = new URLSearchParams(window.location.search);
      const s = p.get("slack");
      if (s && NOTES[s]) {
        NOTES[s].ok ? toast.success(NOTES[s].msg) : toast.error(NOTES[s].msg);
        p.delete("slack");
        window.history.replaceState({}, "", window.location.pathname + (p.toString() ? `?${p}` : ""));
      }
    } catch { /* ignore */ }
    getSlackStatus(storeId).then(setStatus).catch(() => setStatus({ configured: false, connected: false }));
  }, [storeId]);

  return (
    <div className="bg-card space-y-3 rounded-lg border p-5">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold"><MessageSquare className="text-teal-deep size-4" /> Slack</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Add Rani to a Slack workspace as a teammate — it answers DMs and @mentions using the same
          knowledge and tools, and recognizes each person by their Slack identity.
        </p>
      </div>

      {status === null && <p className="text-muted-foreground text-sm">Checking…</p>}

      {status?.connected && (
        <p className="text-teal-deep flex items-center gap-1.5 text-sm font-medium">
          <Check className="size-4" /> Connected{status.teamName ? ` to ${status.teamName}` : ""}
        </p>
      )}

      {status && !status.connected && status.configured && status.installUrl && (
        <Button size="sm" onClick={() => { window.location.href = status.installUrl!; }}>
          <MessageSquare className="size-4" /> Add to Slack
        </Button>
      )}

      {status && !status.connected && !status.configured && (
        <p className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
          Slack isn&apos;t set up on this deployment yet. It needs a Slack app plus{" "}
          <code className="bg-muted rounded px-1">SLACK_CLIENT_ID</code>,{" "}
          <code className="bg-muted rounded px-1">SLACK_CLIENT_SECRET</code>,{" "}
          <code className="bg-muted rounded px-1">SLACK_STATE_SECRET</code>,{" "}
          <code className="bg-muted rounded px-1">SLACK_SIGNING_SECRET</code>, and{" "}
          <code className="bg-muted rounded px-1">SLACK_REDIRECT_URL</code>.
        </p>
      )}
    </div>
  );
}
