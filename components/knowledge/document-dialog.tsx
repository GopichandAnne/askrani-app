"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ingestDocument, ingestFile } from "@/app/(app)/knowledge/actions";
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
  const [file, setFile] = useState<File | null>(null);
  const [pending, startTransition] = useTransition();

  function onOpenChange(o: boolean) {
    if (o) {
      setTitle("");
      setText("");
      setFile(null);
    }
    setOpen(o);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || (!file && !text.trim())) return;
    startTransition(async () => {
      let res;
      if (file) {
        const fd = new FormData();
        fd.set("title", title);
        fd.set("file", file);
        res = await ingestFile(fd);
      } else {
        res = await ingestDocument(title, text);
      }
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
            Upload a file (PDF, image, menu photo, CSV, text) or paste text. Rani
            reads it (transcribing PDFs and images) and searches it by meaning.
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
              placeholder="e.g. Menu / Delivery & Returns Policy"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-file">Upload a file</Label>
            <Input
              id="doc-file"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.csv,.tsv,.json,image/*,application/pdf,text/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-muted-foreground text-xs">PDF, image (menu/flyer photo), CSV, or text — up to 20 MB.</p>
          </div>
          {!file && (
            <div className="space-y-1.5">
              <Label htmlFor="doc-text">…or paste text</Label>
              <Textarea
                id="doc-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                placeholder="Paste a policy, FAQ, or guide here…"
              />
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending || !title.trim() || (!file && !text.trim())}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {file ? "Upload & index" : "Index document"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
