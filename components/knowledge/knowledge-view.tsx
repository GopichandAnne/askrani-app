"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import type { SavedQA } from "@/lib/knowledge/types";
import { deleteQA, refreshKnowledgeBase } from "@/app/(app)/knowledge/actions";
import { useStore } from "@/components/store/store-provider";
import { QADialog } from "./qa-dialog";
import { Input } from "@/components/ui/input";
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
import { BookOpen, Loader2, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";

export function KnowledgeView({
  initialEntries,
  storeName,
}: {
  initialEntries: SavedQA[];
  storeName: string;
}) {
  const { active, isPlatformAdmin } = useStore();
  const isOwner = isPlatformAdmin || active.role === "owner";
  const [entries, setEntries] = useState<SavedQA[]>(initialEntries);
  const [query, setQuery] = useState("");
  const [refreshing, startRefresh] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      `${e.question} ${e.answer ?? ""} ${e.category ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [entries, query]);

  function upsert(qa: SavedQA) {
    setEntries((prev) => {
      const i = prev.findIndex((e) => e.id === qa.id);
      if (i === -1) return [qa, ...prev];
      const copy = prev.slice();
      copy[i] = qa;
      return copy;
    });
  }

  async function remove(id: string) {
    const before = entries;
    setEntries((prev) => prev.filter((e) => e.id !== id));
    const res = await deleteQA(id);
    if (res.ok) toast.success("Entry removed");
    else {
      setEntries(before);
      toast.error("Couldn't remove", { description: res.error });
    }
  }

  function refresh() {
    startRefresh(async () => {
      const res = await refreshKnowledgeBase();
      if (res.ok) toast.success(res.message);
      else toast.error("Refresh document KB", { description: res.error });
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl italic">Knowledge</h1>
          <p className="text-muted-foreground text-sm">{storeName}</p>
        </div>
        {isOwner && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Refresh document KB
            </Button>
            <QADialog
              mode="create"
              onSaved={upsert}
              trigger={
                <Button size="sm">
                  <Plus className="size-4" /> Add Q&amp;A
                </Button>
              }
            />
          </div>
        )}
      </header>

      <div className="relative max-w-sm">
        <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search questions, answers, categories"
          className="pl-8"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="bg-card flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <BookOpen className="text-muted-foreground size-6" />
          <p className="text-sm font-medium">
            {entries.length === 0 ? "No saved answers yet" : "Nothing matches"}
          </p>
          <p className="text-muted-foreground max-w-sm text-sm">
            {entries.length === 0
              ? isOwner
                ? `Add ${storeName}'s first escalation answer.`
                : "An owner can add escalation answers here."
              : "Try a different search."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((e) => (
            <QACard
              key={e.id}
              entry={e}
              isOwner={isOwner}
              onSaved={upsert}
              onRemove={remove}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function QACard({
  entry,
  isOwner,
  onSaved,
  onRemove,
}: {
  entry: SavedQA;
  isOwner: boolean;
  onSaved: (qa: SavedQA) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <li className="bg-card rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{entry.question}</p>
          {entry.answer && (
            <p className="text-muted-foreground mt-1 whitespace-pre-wrap text-sm">
              {entry.answer}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {entry.category && (
              <Badge variant="secondary">{entry.category}</Badge>
            )}
            {!entry.active && (
              <Badge variant="outline" className="text-muted-foreground">
                Inactive
              </Badge>
            )}
            <span className="text-muted-foreground">
              used {entry.times_used}×
            </span>
          </div>
        </div>
        {isOwner && (
          <div className="flex shrink-0 items-center gap-1">
            <QADialog
              mode="edit"
              initial={entry}
              onSaved={onSaved}
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="Edit entry"
                >
                  <Pencil className="size-4" />
                </Button>
              }
            />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive size-8"
                  aria-label="Delete entry"
                >
                  <Trash2 className="size-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes the saved answer from the knowledge base.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onRemove(entry.id)}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
    </li>
  );
}
