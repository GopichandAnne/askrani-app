"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setDocumentDates } from "@/app/(app)/knowledge/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

/** Owner control to set/clear a KB document's effective window (auto-expiry). */
export function DocumentDatesDialog({
  trigger,
  title,
  validFrom,
  validUntil,
  onSaved,
}: {
  trigger: React.ReactNode;
  title: string;
  validFrom: string | null;
  validUntil: string | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(validFrom ?? "");
  const [until, setUntil] = useState(validUntil ?? "");
  const [pending, start] = useTransition();

  function onOpenChange(o: boolean) {
    if (o) {
      setFrom(validFrom ?? "");
      setUntil(validUntil ?? "");
    }
    setOpen(o);
  }

  function save() {
    if (from && until && until < from) {
      toast.error("Expiry date can't be before the effective date.");
      return;
    }
    start(async () => {
      const res = await setDocumentDates(title, from || null, until || null);
      if (res.ok) {
        toast.success("Dates updated");
        onSaved();
        setOpen(false);
      } else {
        toast.error("Couldn't update dates", { description: res.error });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Effective dates</DialogTitle>
          <DialogDescription>
            Rani only mentions “{title}” within this window and stops after it ends.
            Clear both for always-on info.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dd-from">Effective from</Label>
            <Input id="dd-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dd-until">Expires</Label>
            <Input id="dd-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => { setFrom(""); setUntil(""); }}>
            Clear both
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Human validity status for a doc's window, relative to today (local). */
export function docValidity(
  validFrom: string | null,
  validUntil: string | null,
): { label: string; tone: "expired" | "scheduled" | "active" } | null {
  if (!validFrom && !validUntil) return null;
  const today = new Intl.DateTimeFormat("en-CA").format(new Date()); // YYYY-MM-DD local
  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (validUntil && validUntil < today) return { label: `Expired ${fmt(validUntil)}`, tone: "expired" };
  if (validFrom && validFrom > today) return { label: `Starts ${fmt(validFrom)}`, tone: "scheduled" };
  if (validUntil) return { label: `Until ${fmt(validUntil)}`, tone: "active" };
  return { label: `From ${fmt(validFrom!)}`, tone: "active" };
}
