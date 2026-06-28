"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createQA, updateQA } from "@/app/(app)/knowledge/actions";
import type { SavedQA } from "@/lib/knowledge/types";
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";

export function QADialog({
  mode,
  initial,
  trigger,
  onSaved,
}: {
  mode: "create" | "edit";
  initial?: SavedQA;
  trigger: React.ReactNode;
  onSaved: (qa: SavedQA) => void;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [category, setCategory] = useState("");
  const [active, setActive] = useState(true);
  const [pending, startTransition] = useTransition();

  function onOpenChange(o: boolean) {
    if (o) {
      // (re)seed the form each time it opens
      setQuestion(initial?.question ?? "");
      setAnswer(initial?.answer ?? "");
      setCategory(initial?.category ?? "");
      setActive(initial?.active ?? true);
    }
    setOpen(o);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    startTransition(async () => {
      const res =
        mode === "create"
          ? await createQA({ question, answer, category, active })
          : await updateQA(initial!.id, { question, answer, category, active });
      if (res.ok) {
        onSaved(res.qa);
        toast.success(mode === "create" ? "Entry added" : "Entry saved");
        setOpen(false);
      } else {
        toast.error("Couldn't save", { description: res.error });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add Q&A" : "Edit Q&A"}</DialogTitle>
          <DialogDescription>
            An escalation answer Rani can reuse for this store.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="qa-q">Question *</Label>
            <Textarea
              id="qa-q"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              required
              autoFocus
              placeholder="What do customers ask?"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qa-a">Answer</Label>
            <Textarea
              id="qa-a"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={4}
              placeholder="The answer Rani should give."
            />
          </div>
          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="qa-cat">Category</Label>
              <Input
                id="qa-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Returns"
              />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch
                id="qa-active"
                checked={active}
                onCheckedChange={setActive}
              />
              <Label htmlFor="qa-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {mode === "create" ? "Add entry" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
