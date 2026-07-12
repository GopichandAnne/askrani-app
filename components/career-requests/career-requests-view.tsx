"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  setCareerRequestStatus,
  type CareerRequest,
  type CareerRequestStatus,
} from "@/app/(app)/career-requests/actions";
import { Badge } from "@/components/ui/badge";
import { Briefcase, Mail } from "lucide-react";

const STATUSES: CareerRequestStatus[] = ["new", "reviewed", "contacted", "closed"];

const STATUS_STYLE: Record<CareerRequestStatus, string> = {
  new: "bg-teal text-white",
  reviewed: "bg-amber-500 text-white",
  contacted: "bg-blue-500 text-white",
  closed: "bg-muted text-muted-foreground",
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function CareerRequestsView({
  initial,
  storeName,
}: {
  initial: CareerRequest[];
  storeName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function changeStatus(id: string, status: CareerRequestStatus) {
    setBusy(id);
    startTransition(async () => {
      const res = await setCareerRequestStatus(id, status);
      setBusy(null);
      if (res.ok) {
        router.refresh();
      } else {
        toast.error("Couldn't update", { description: res.error });
      }
    });
  }

  const openCount = initial.filter((r) => r.status === "new").length;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Briefcase className="text-muted-foreground size-5" />
          <div>
            <h1 className="font-display text-2xl italic">Career requests</h1>
            <p className="text-muted-foreground text-sm">{storeName}</p>
          </div>
        </div>
        {openCount > 0 && (
          <Badge className="bg-teal text-white">
            {openCount} new
          </Badge>
        )}
      </header>

      <p className="text-muted-foreground text-sm">
        Job-seekers who chatted with your assistant and shared their interest. Each row is the roles
        they want, their key skills, and an email to reach back. New requests also arrive by email to
        your HR inbox.
      </p>

      {initial.length === 0 ? (
        <div className="bg-card text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <Briefcase className="size-6" />
          <p className="text-sm font-medium">No career requests yet</p>
          <p className="max-w-sm text-sm">
            When a visitor tells the assistant they&apos;re looking for opportunities, it collects
            their details and they show up here for HR to review.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {initial.map((r) => (
            <li key={r.id} className="bg-card rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <a
                    href={`mailto:${r.email}`}
                    className="text-teal-deep inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
                  >
                    <Mail className="size-4 shrink-0" />
                    {r.email}
                  </a>
                  {r.positions && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">Positions: </span>
                      {r.positions}
                    </p>
                  )}
                  {r.skills && (
                    <p className="text-sm">
                      <span className="text-muted-foreground">Skills: </span>
                      {r.skills}
                    </p>
                  )}
                  {r.notes && (
                    <p className="text-muted-foreground text-sm italic">&ldquo;{r.notes}&rdquo;</p>
                  )}
                  <p className="text-muted-foreground text-xs">{fmtDate(r.created_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={STATUS_STYLE[r.status]}>{r.status}</Badge>
                  <select
                    value={r.status}
                    disabled={busy === r.id}
                    onChange={(e) => changeStatus(r.id, e.target.value as CareerRequestStatus)}
                    className="border-input bg-background h-8 rounded-md border px-2 text-sm disabled:opacity-50"
                    aria-label="Update status"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
