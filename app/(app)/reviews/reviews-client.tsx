"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { reviewSubmission, type PendingSubmission } from "./actions";

export function ReviewsClient({ initial }: { initial: PendingSubmission[] }) {
  const [subs, setSubs] = useState(initial);
  const [reach, setReach] = useState<Record<string, string>>({});
  const [fmt, setFmt] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const act = (s: PendingSubmission, decision: "approve" | "reject") =>
    start(async () => {
      const r = await reviewSubmission(s.id, decision, {
        reach: s.pricing === "tier" && decision === "approve" ? Number(reach[s.id] || 0) : undefined,
        format: s.pricing === "format" && decision === "approve" ? fmt[s.id] : undefined,
      });
      if (r.ok) {
        toast.success(
          decision === "approve"
            ? r.amountUsd != null && r.amountUsd > 0
              ? `Approved — $${r.amountUsd.toFixed(2)} credited`
              : "Approved"
            : "Rejected",
        );
        setSubs((prev) => prev.filter((x) => x.id !== s.id));
      } else {
        toast.error(r.error);
      }
    });

  if (!subs.length) {
    return <p className="text-muted-foreground text-sm">No posts waiting for review. 🎉</p>;
  }

  const pill = (on: boolean) =>
    `rounded-full border px-3 py-1 text-xs capitalize ${on ? "bg-teal border-teal text-white" : "text-muted-foreground"}`;

  return (
    <div className="max-w-2xl space-y-3">
      {subs.map((s) => {
        const needsReach = s.pricing === "tier";
        const needsFormat = s.pricing === "format";
        const canApprove = (!needsReach || !!reach[s.id]) && (!needsFormat || !!fmt[s.id]);
        return (
          <Card key={s.id}>
            <CardContent className="space-y-3 pt-5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-medium">{s.memberName ?? "Customer"}</span>{" "}
                  <span className="text-muted-foreground text-sm">
                    {[s.platform, s.format].filter(Boolean).join(" · ") || "post"}
                  </span>
                </div>
                <a
                  href={s.postUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-teal shrink-0 text-sm underline underline-offset-2"
                >
                  Open post ↗
                </a>
              </div>

              {s.promoContext && (
                <p className="text-muted-foreground text-xs">
                  Should be about: <span className="text-foreground">{s.promoContext}</span>
                </p>
              )}

              {needsFormat && (
                <div className="space-y-1.5">
                  <label className="text-muted-foreground text-xs">Which format did they post?</label>
                  <div className="flex flex-wrap gap-2">
                    {s.formats.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setFmt((a) => ({ ...a, [s.id]: f.key }))}
                        className={pill(fmt[s.id] === f.key)}
                      >
                        {f.key} · ${f.usd.toFixed(2)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-end gap-2">
                {needsReach && (
                  <div className="space-y-1">
                    <label className="text-muted-foreground text-xs">Reach / views</label>
                    <Input
                      inputMode="numeric"
                      placeholder="e.g. 6000"
                      value={reach[s.id] ?? ""}
                      onChange={(e) => setReach((a) => ({ ...a, [s.id]: e.target.value.replace(/\D/g, "") }))}
                      className="w-32 tabular-nums"
                    />
                  </div>
                )}
                <Button onClick={() => act(s, "approve")} disabled={pending || !canApprove}>
                  Approve
                </Button>
                <Button variant="ghost" onClick={() => act(s, "reject")} disabled={pending}>
                  Reject
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Confirm the post is real, tags the store, and includes #ad / #gifted before approving. Approving
                credits the customer.
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
