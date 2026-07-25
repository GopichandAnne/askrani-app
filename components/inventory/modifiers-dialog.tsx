"use client";

import { useState } from "react";
import type { Product, ProductPatch } from "@/lib/inventory/types";
import { cleanModifiers, type ModifierGroup, type ModifierOption, newId } from "@/lib/modifiers";
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
import { Plus, Settings2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Per-product editor for customization options (size, add-ons, "no onions"…).
 *  Guests pick these when ordering; prices adjust by the per-option delta. */
export function ModifiersDialog({
  product,
  isOwner,
  onSave,
}: {
  product: Product;
  isOwner: boolean;
  onSave: (id: string, patch: ProductPatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<ModifierGroup[]>(() => cleanModifiers(product.modifiers));

  const count = Array.isArray(product.modifiers) ? product.modifiers.length : 0;
  const summary = count > 0 ? (
    <span className="text-teal-deep text-xs font-medium">
      {count} group{count === 1 ? "" : "s"}
    </span>
  ) : (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <Settings2 className="size-3.5" />
      {isOwner ? "Add" : "—"}
    </span>
  );

  if (!isOwner) return <div className="flex justify-center">{summary}</div>;

  const addGroup = () =>
    setGroups((g) => [
      ...g,
      { id: newId("g"), name: "", type: "single", required: false, options: [{ id: newId("o"), name: "", price_delta: 0 }] },
    ]);
  const patchGroup = (i: number, p: Partial<ModifierGroup>) =>
    setGroups((g) => g.map((x, idx) => (idx === i ? { ...x, ...p } : x)));
  const removeGroup = (i: number) => setGroups((g) => g.filter((_, idx) => idx !== i));
  const addOption = (gi: number) =>
    setGroups((g) => g.map((x, idx) => (idx === gi ? { ...x, options: [...x.options, { id: newId("o"), name: "", price_delta: 0 }] } : x)));
  const patchOption = (gi: number, oi: number, p: Partial<ModifierOption>) =>
    setGroups((g) => g.map((x, idx) => (idx === gi ? { ...x, options: x.options.map((o, od) => (od === oi ? { ...o, ...p } : o)) } : x)));
  const removeOption = (gi: number, oi: number) =>
    setGroups((g) => g.map((x, idx) => (idx === gi ? { ...x, options: x.options.filter((_, od) => od !== oi) } : x)));

  function save() {
    onSave(product.id, { modifiers: cleanModifiers(groups) });
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setGroups(cleanModifiers(product.modifiers));
      }}
    >
      <DialogTrigger asChild>
        <button type="button" aria-label={`Edit options for ${product.name}`} className="mx-auto flex hover:opacity-80">
          {summary}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{product.name} — options</DialogTitle>
          <DialogDescription>
            Choices guests pick when ordering (size, add-ons, &ldquo;no onions&rdquo;…). The price adjusts by each
            option&apos;s amount automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          {groups.length === 0 && <p className="text-muted-foreground text-sm">No options yet — add a group to start.</p>}
          {groups.map((g, gi) => (
            <div key={g.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Input
                  value={g.name}
                  onChange={(e) => patchGroup(gi, { name: e.target.value })}
                  placeholder="Group name (e.g. Size)"
                  className="h-8 flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive size-8"
                  onClick={() => removeGroup(gi)}
                  aria-label="Remove group"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="flex rounded-md border p-0.5">
                  {(["single", "multi"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => patchGroup(gi, { type: t })}
                      className={cn(
                        "rounded px-2 py-0.5",
                        g.type === t ? "bg-teal-mist text-teal-deep font-medium" : "text-muted-foreground",
                      )}
                    >
                      {t === "single" ? "Pick one" : "Pick many"}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    className="accent-teal size-3.5"
                    checked={g.required}
                    onChange={(e) => patchGroup(gi, { required: e.target.checked })}
                  />
                  Required
                </label>
                {g.type === "multi" && (
                  <label className="text-muted-foreground flex items-center gap-1">
                    max
                    <Input
                      type="number"
                      min={1}
                      value={g.max ?? ""}
                      onChange={(e) => patchGroup(gi, { max: e.target.value === "" ? null : Number(e.target.value) })}
                      className="h-7 w-14"
                    />
                  </label>
                )}
              </div>

              <div className="space-y-1.5">
                {g.options.map((o, oi) => (
                  <div key={o.id} className="flex items-center gap-2">
                    <Input
                      value={o.name}
                      onChange={(e) => patchOption(gi, oi, { name: e.target.value })}
                      placeholder="Option (e.g. Large)"
                      className="h-8 flex-1"
                    />
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground text-xs">+$</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={o.price_delta || ""}
                        onChange={(e) => patchOption(gi, oi, { price_delta: Number(e.target.value) || 0 })}
                        placeholder="0"
                        className="h-8 w-20"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive size-8"
                      onClick={() => removeOption(gi, oi)}
                      aria-label="Remove option"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => addOption(gi)}>
                  <Plus className="size-3.5" /> Add option
                </Button>
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addGroup}>
            <Plus className="size-4" /> Add option group
          </Button>
        </div>

        <DialogFooter>
          <Button size="sm" onClick={save}>Save options</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
