"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { Database } from "@/lib/database.types";
import { deleteWaitlistEntry } from "@/app/(app)/admin/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ClipboardList, Mail, Trash2 } from "lucide-react";

type Row = Database["public"]["Tables"]["waitlist"]["Row"];

export function WaitlistView({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initial);

  async function remove(id: string) {
    const before = rows;
    setRows((prev) => prev.filter((r) => r.id !== id));
    const res = await deleteWaitlistEntry(id);
    if (!res.ok) {
      setRows(before);
      toast.error("Couldn't delete", { description: res.error });
    } else {
      toast.success("Signup removed");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl italic">Waitlist</h1>
          <p className="text-muted-foreground text-sm">
            Early-access signups from askrani.ai · {rows.length}
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="bg-card text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <ClipboardList className="size-6" />
          <p className="text-sm font-medium">No signups yet</p>
          <p className="text-sm">New waitlist submissions from the website will appear here.</p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {rows.map((r) => (
            <li key={r.id} className="bg-card rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{r.business_name}</p>
                    {r.business_type && (
                      <Badge variant="secondary" className="capitalize">
                        {r.business_type}
                      </Badge>
                    )}
                    {[r.city, r.state].filter(Boolean).length > 0 && (
                      <span className="text-muted-foreground text-xs">
                        {[r.city, r.state].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {r.full_name} ·{" "}
                    <a href={`mailto:${r.email}`} className="text-teal-deep hover:underline">
                      {r.email}
                    </a>
                    {r.phone ? ` · ${r.phone}` : ""}
                  </p>
                  {r.comments && (
                    <p className="text-muted-foreground mt-1 text-sm italic">“{r.comments}”</p>
                  )}
                  <p className="text-muted-foreground/70 text-xs">
                    {r.hear_about ? `Heard via ${r.hear_about} · ` : ""}
                    {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="outline" size="sm" asChild>
                    <a href={`mailto:${r.email}?subject=${encodeURIComponent("Ask Rani — your early access")}`}>
                      <Mail className="size-4" /> Reply
                    </a>
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive size-8"
                        aria-label="Delete signup"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this signup?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes {r.business_name}&apos;s waitlist entry.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(r.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
