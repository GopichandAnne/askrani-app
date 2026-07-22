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
  const [pending, start] = useTransition();

  const act = (s: PendingSubmission, decision: "approve" | "reject") =>
    start(async () => {
      const r = await reviewSubmission(
        s.id,
        decision,
        s.banded && decision === "approve" ? Number(reach[s.id] || 0) : undefined,
      );
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

  return (
    <div className="max-w-2xl space-y-3">
      {subs.map((s) => (
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
            <div className="flex items-end gap-2">
              {s.banded && (
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
              <Button onClick={() => act(s, "approve")} disabled={pending || (s.banded && !reach[s.id])}>
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
      ))}
    </div>
  );
}
