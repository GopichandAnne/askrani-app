"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ingestDocument } from "@/app/(app)/knowledge/actions";
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
import { Loader2 } from "lucide-react";

/**
 * Paste-text document ingestion. On submit the server action chunks + embeds
 * the text into knowledge_index (via bot-admin). Re-ingesting the same title
 * replaces that document's chunks.
 */
export function DocumentDialog({
  trigger,
  onIngested,
}: {
  trigger: React.ReactNode;
  onIngested: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();

  function onOpenChange(o: boolean) {
    if (o) {
      setTitle("");
      setText("");
    }
    setOpen(o);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !text.trim()) return;
    startTransition(async () => {
      const res = await ingestDocument(title, text);
      if (res.ok) {
        toast.success(res.message);
        onIngested();
        setOpen(false);
      } else {
        toast.error("Couldn't index document", { description: res.error });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add document</DialogTitle>
          <DialogDescription>
            Paste a policy, FAQ, or guide. Rani searches it by meaning when
            customers ask (hours, delivery, returns, etc.).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="doc-title">Title *</Label>
            <Input
              id="doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
              placeholder="e.g. Delivery & Returns Policy"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-text">Text *</Label>
            <Textarea
              id="doc-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              required
              placeholder="Paste the document here…"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Index document
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
