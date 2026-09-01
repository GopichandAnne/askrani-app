"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X, ShieldAlert, UserCheck, Store as StoreIcon, Loader2 } from "lucide-react";
import { decideActionRequest } from "@/app/(app)/activity/actions";

export type Approval = {
  id: string;
  created_at: string;
  tool: string;
  kind: string;
  acted_as: string | null;
  detail: string;
};

/** Pending approvals — the held actions Rani flagged for a person. The owner
 *  approves (signs off, then completes it in their system) or declines. */
export function Approvals({ initial }: { initial: Approval[] }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  if (rows.length === 0) return null;

  function decide(id: string, decision: "approved" | "declined") {
    setBusy(id);
    startTransition(async () => {
      const res = await decideActionRequest(id, decision);
      setBusy(null);
      if (res.ok) {
        setRows((r) => r.filter((x) => x.id !== id));
        toast.success(decision === "approved" ? "Approved — complete it in your system" : "Declined");
        router.refresh();
      } else {
        toast.error("Couldn't update", { description: res.error });
      }
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 text-amber-600" />
        <h2 className="font-display text-lg italic">Pending approvals</h2>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          {rows.length}
        </span>
      </div>
      <p className="text-muted-foreground -mt-1 text-sm">
        Rani held these writes because their tool is set to require approval. Nothing ran — review and
        decide. Approving records your sign-off; you then complete the action in your system.
      </p>

      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.id}
            className="bg-card flex flex-col gap-3 rounded-lg border border-amber-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/50"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono text-[13px] font-medium">{r.tool}</span>
                <span className="text-muted-foreground text-xs">· {r.kind}</span>
                {r.acted_as ? (
                  <span className="text-teal-deep inline-flex items-center gap-1 text-xs">
                    <UserCheck className="size-3.5" /> {r.acted_as}
                  </span>
                ) : (
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                    <StoreIcon className="size-3.5" /> the account
                  </span>
                )}
              </div>
              {r.detail && <p className="text-muted-foreground mt-1 break-words text-sm">{r.detail}</p>}
              <p className="text-muted-foreground mt-1 text-[11px] tabular-nums">{fmt(r.created_at)}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => decide(r.id, "approved")}
                disabled={busy === r.id}
                className="inline-flex items-center gap-1.5 rounded-md bg-teal-deep px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy === r.id ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Approve
              </button>
              <button
                onClick={() => decide(r.id, "declined")}
                disabled={busy === r.id}
                className="border-input text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                <X className="size-4" />
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function fmt(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso;
  }
}
