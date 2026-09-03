"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getSlackStatus, setSlackApprovalsChannel, type SlackStatus } from "@/app/(app)/link/slack-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [channel, setChannel] = useState("");
  const [savingCh, setSavingCh] = useState(false);

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
    getSlackStatus(storeId)
      .then((s) => { setStatus(s); setChannel(s.approvalsChannel ?? ""); })
      .catch(() => setStatus({ configured: false, connected: false }));
  }, [storeId]);

  async function saveChannel() {
    setSavingCh(true);
    const res = await setSlackApprovalsChannel(storeId, channel);
    setSavingCh(false);
    if (res.ok) toast.success(channel.trim() ? "Approvals will post to that channel" : "Approvals channel cleared");
    else toast.error("Couldn't save", { description: res.error });
  }

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
        <div className="space-y-3">
          <p className="text-teal-deep flex items-center gap-1.5 text-sm font-medium">
            <Check className="size-4" /> Connected{status.teamName ? ` to ${status.teamName}` : ""}
          </p>
          <div className="space-y-1.5 rounded-md border p-3">
            <Label className="text-xs">Approvals channel</Label>
            <p className="text-muted-foreground text-xs">
              Post <span className="font-medium">Approve / Decline</span> buttons for held actions to this
              Slack channel — a manager can sign off right there. Paste the channel ID (e.g.{" "}
              <code className="bg-muted rounded px-1">C0123ABCD</code>). Leave blank to only notify by email.
            </p>
            <div className="flex gap-2">
              <Input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="C0123ABCD" className="font-mono text-sm" />
              <Button size="sm" variant="outline" onClick={saveChannel} disabled={savingCh}>
                {savingCh ? <Loader2 className="size-4 animate-spin" /> : null} Save
              </Button>
            </div>
          </div>
        </div>
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
