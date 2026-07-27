"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Product, ProductPatch } from "@/lib/inventory/types";
import { removeProduct, updateProduct } from "@/app/(app)/inventory/actions";
import { useStore } from "@/components/store/store-provider";
import { formatMoney } from "@/lib/orders/totals";
import { AddProductDialog } from "./add-product-dialog";
import { ImportCatalogueDialog } from "./import-catalogue-dialog";
import { ImagePicker } from "./product-image";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Camera, ImageIcon, PackageOpen, Search, Star, Tags, Trash2 } from "lucide-react";
import { ALLERGENS, DIETARY, labelFor } from "@/lib/dietary";
import { ModifiersDialog } from "./modifiers-dialog";
import { cn } from "@/lib/utils";

export function InventoryTable({
  initialProducts,
  storeName,
}: {
  initialProducts: Product[];
  storeName: string;
}) {
  const { active, isPlatformAdmin } = useStore();
  const isOwner = isPlatformAdmin || active.role === "owner";
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioQueue, setStudioQueue] = useState<string[]>([]);
  const photolessCount = products.filter((p) => !p.image_url).length;
  function openStudio() {
    setStudioQueue(products.filter((p) => !p.image_url).map((p) => p.id));
    setStudioOpen(true);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      `${p.name} ${p.brand ?? ""} ${p.sku ?? ""}`.toLowerCase().includes(q),
    );
  }, [products, query]);

  function patchLocal(id: string, patch: Partial<Product>) {
    setProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  }

  async function save(id: string, patch: ProductPatch) {
    const before = products.find((p) => p.id === id);
    patchLocal(id, patch as Partial<Product>);
    const res = await updateProduct(id, patch);
    if (res.ok) {
      patchLocal(id, res.product);
    } else {
      if (before) patchLocal(id, before);
      toast.error("Couldn't save", { description: res.error });
    }
  }

  async function remove(id: string) {
    const before = products;
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setSelected((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    const res = await removeProduct(id);
    if (res.ok) toast.success("Product removed");
    else {
      setProducts(before);
      toast.error("Couldn't remove", { description: res.error });
    }
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  const allShownSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  function toggleSelectAll() {
    setSelected((s) => {
      const n = new Set(s);
      if (allShownSelected) filtered.forEach((p) => n.delete(p.id));
      else filtered.forEach((p) => n.add(p.id));
      return n;
    });
  }

  // Bulk apply: add/remove a set of tags across every selected product, merging
  // with each product's existing tags (so we never wipe a dish's other tags).
  async function applyBulk(addDiet: string[], rmDiet: string[], addAll: string[], rmAll: string[]) {
    const ids = [...selected];
    setBulkOpen(false);
    const merge = (cur: string[], add: string[], rm: string[]) =>
      [...new Set([...cur.filter((x) => !rm.includes(x)), ...add])];
    for (const id of ids) {
      const p = products.find((x) => x.id === id);
      if (!p) continue;
      const dietary = merge(p.dietary ?? [], addDiet, rmDiet);
      const allergens = merge(p.allergens ?? [], addAll, rmAll);
      await save(id, { dietary, allergens });
    }
    toast.success(`Updated tags on ${ids.length} product${ids.length === 1 ? "" : "s"}`);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl italic">Catalog</h1>
          <p className="text-muted-foreground text-sm">{storeName}</p>
        </div>
        {isOwner && (
          <div className="flex items-center gap-2">
            {photolessCount > 0 && (
              <Button size="sm" variant="outline" onClick={openStudio}>
                <Camera className="size-4" /> Add photos ({photolessCount})
              </Button>
            )}
            <ImportCatalogueDialog />
            <AddProductDialog onAdded={(p) => setProducts((prev) => [p, ...prev])} />
          </div>
        )}
      </header>
      {isOwner && (
        <PhotoStudioDialog
          open={studioOpen}
          onOpenChange={setStudioOpen}
          queueIds={studioQueue}
          products={products}
          onSave={save}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, brand, or SKU"
            className="pl-8"
          />
        </div>
        {isOwner && selected.size > 0 && (
          <div className="border-teal/40 bg-teal-mist/50 flex items-center gap-2 rounded-lg border px-3 py-1.5">
            <span className="text-teal-deep text-sm font-medium">{selected.size} selected</span>
            <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
              <Tags className="size-4" /> Edit tags
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}
      </div>
      {isOwner && (
        <BulkTagsDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          count={selected.size}
          onApply={applyBulk}
        />
      )}

      {filtered.length === 0 ? (
        <div className="bg-card flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <PackageOpen className="text-muted-foreground size-6" />
          <p className="text-sm font-medium">
            {products.length === 0 ? "No products yet" : "No products match"}
          </p>
          <p className="text-muted-foreground text-sm">
            {products.length === 0
              ? `Add ${storeName}'s first product.`
              : "Try a different search."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {isOwner && (
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      className="accent-teal size-4 align-middle"
                      checked={allShownSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all"
                    />
                  </TableHead>
                )}
                <TableHead className="w-14" />
                <TableHead>Product</TableHead>
                <TableHead className="w-28">SKU</TableHead>
                <TableHead className="w-32">Price</TableHead>
                <TableHead className="w-28 text-center">Tags</TableHead>
                <TableHead className="w-24 text-center">Options</TableHead>
                <TableHead className="w-16 text-center">Special</TableHead>
                <TableHead className="w-24 text-center">In stock</TableHead>
                <TableHead className="w-24 text-center">Verified</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => (
                <ProductRow
                  key={p.id}
                  product={p}
                  isOwner={isOwner}
                  selected={selected.has(p.id)}
                  onToggleSelect={() => toggleSelect(p.id)}
                  onSave={save}
                  onRemove={remove}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ProductRow({
  product,
  isOwner,
  selected,
  onToggleSelect,
  onSave,
  onRemove,
}: {
  product: Product;
  isOwner: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onSave: (id: string, patch: ProductPatch) => void;
  onRemove: (id: string) => void;
}) {
  const [priceStr, setPriceStr] = useState(
    product.price != null ? String(product.price) : "",
  );
  useEffect(() => {
    setPriceStr(product.price != null ? String(product.price) : "");
  }, [product.price]);

  function commitPrice() {
    const trimmed = priceStr.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (trimmed !== "" && !Number.isFinite(next)) {
      setPriceStr(product.price != null ? String(product.price) : "");
      return;
    }
    if (next === product.price) return;
    onSave(product.id, { price: next });
  }

  const meta = [product.brand, product.size, product.unit]
    .filter(Boolean)
    .join(" · ");

  return (
    <TableRow className={product.in_stock ? "" : "opacity-60"}>
      {isOwner && (
        <TableCell>
          <input
            type="checkbox"
            className="accent-teal size-4 align-middle"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`Select ${product.name}`}
          />
        </TableCell>
      )}
      <TableCell>
        <ImageCell product={product} isOwner={isOwner} onSave={onSave} />
      </TableCell>
      <TableCell>
        <p className="font-medium">{product.name}</p>
        {meta && <p className="text-muted-foreground text-xs">{meta}</p>}
      </TableCell>
      <TableCell className="text-muted-foreground font-mono text-xs">
        {product.sku ?? "—"}
      </TableCell>
      <TableCell>
        {isOwner ? (
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground text-xs">$</span>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={priceStr}
              onChange={(e) => setPriceStr(e.target.value)}
              onBlur={commitPrice}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="h-8 w-24"
              placeholder="—"
            />
          </div>
        ) : (
          // Staff: price is read-only (owner-gated catalog/money field).
          <span className="text-sm">
            {product.price == null
              ? "—"
              : formatMoney(product.price, product.currency ?? "USD")}
          </span>
        )}
      </TableCell>
      <TableCell className="text-center">
        <RowTagsDialog product={product} isOwner={isOwner} onSave={onSave} />
      </TableCell>
      <TableCell className="text-center">
        <ModifiersDialog product={product} isOwner={isOwner} onSave={onSave} />
      </TableCell>
      <TableCell className="text-center">
        <button
          type="button"
          onClick={() => onSave(product.id, { featured: !product.featured })}
          aria-label={product.featured ? "Remove special" : "Mark as today's special"}
          aria-pressed={product.featured}
          className="text-muted-foreground hover:text-amber-500 transition-colors"
        >
          <Star className={product.featured ? "size-5 fill-amber-400 text-amber-500" : "size-5"} />
        </button>
      </TableCell>
      <TableCell className="text-center">
        <Switch
          checked={product.in_stock}
          onCheckedChange={(c) => onSave(product.id, { in_stock: c })}
          aria-label="In stock"
        />
      </TableCell>
      <TableCell className="text-center">
        <Switch
          checked={product.verified}
          onCheckedChange={(c) => onSave(product.id, { verified: c })}
          aria-label="Verified"
        />
      </TableCell>
      <TableCell>
        {isOwner && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive size-8"
                aria-label="Remove product"
              >
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {product.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This deletes the product from this store&apos;s inventory.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep</AlertDialogCancel>
                <AlertDialogAction onClick={() => onRemove(product.id)}>
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </TableCell>
    </TableRow>
  );
}

function ImageCell({
  product,
  isOwner,
  onSave,
}: {
  product: Product;
  isOwner: boolean;
  onSave: (id: string, patch: ProductPatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const thumb = (
    <div className="bg-muted size-10 overflow-hidden rounded-md border">
      {product.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.image_url} alt="" className="size-full object-cover" />
      ) : (
        <div className="text-muted-foreground flex size-full items-center justify-center">
          <ImageIcon className="size-4" />
        </div>
      )}
    </div>
  );

  if (!isOwner) return thumb;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" aria-label="Edit image" className="rounded-md hover:opacity-80">
          {thumb}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{product.name} — image</DialogTitle>
        </DialogHeader>
        <ImagePicker value={product.image_url} onChange={(u) => onSave(product.id, { image_url: u })} />
        <DialogFooter>
          <Button size="sm" onClick={() => setOpen(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const toggleSet = (s: Set<string>, id: string): Set<string> => {
  const n = new Set(s);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
};

function TagChips({
  items,
  selected,
  onToggle,
  variant,
}: {
  items: readonly { id: string; label: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  variant: "diet" | "allergen";
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t) => {
        const on = selected.has(t.id);
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(t.id)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              on
                ? variant === "diet"
                  ? "border-teal bg-teal-mist text-teal-deep"
                  : "border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                : "text-muted-foreground hover:border-foreground/30",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** Per-product tag summary + (owner) editor for exact dietary/allergen tags. */
function RowTagsDialog({
  product,
  isOwner,
  onSave,
}: {
  product: Product;
  isOwner: boolean;
  onSave: (id: string, patch: ProductPatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const [diet, setDiet] = useState<Set<string>>(new Set(product.dietary ?? []));
  const [allg, setAllg] = useState<Set<string>>(new Set(product.allergens ?? []));
  const [heat, setHeat] = useState<string | null>(product.heat ?? null);

  const dietTags = product.dietary ?? [];
  const allgCount = product.allergens?.length ?? 0;
  const empty = dietTags.length === 0 && allgCount === 0 && !product.heat;
  const summary = empty ? (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <Tags className="size-3.5" />
      {isOwner ? "Add" : "—"}
    </span>
  ) : (
    <span className="inline-flex flex-wrap items-center justify-center gap-1">
      {dietTags.slice(0, 2).map((d) => (
        <span key={d} className="bg-teal-mist text-teal-deep rounded-full px-1.5 py-0.5 text-[10px]">
          {labelFor(d)}
        </span>
      ))}
      {dietTags.length > 2 && <span className="text-muted-foreground text-[10px]">+{dietTags.length - 2}</span>}
      {product.heat && (
        <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700 dark:bg-red-950 dark:text-red-300" title="heat level">
          {product.heat === "hot" ? "🌶 Hot" : product.heat === "medium" ? "🌶 Medium" : "🌶 Mild"}
        </span>
      )}
      {allgCount > 0 && (
        <span className="text-amber-700 dark:text-amber-300 text-[10px]" title="contains allergens">
          ⚠{allgCount}
        </span>
      )}
    </span>
  );

  if (!isOwner) return <div className="flex justify-center">{summary}</div>;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setDiet(new Set(product.dietary ?? []));
          setAllg(new Set(product.allergens ?? []));
          setHeat(product.heat ?? null);
        }
      }}
    >
      <DialogTrigger asChild>
        <button type="button" aria-label={`Edit tags for ${product.name}`} className="mx-auto flex hover:opacity-80">
          {summary}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{product.name} — tags</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Dietary</p>
            <TagChips items={DIETARY} selected={diet} onToggle={(id) => setDiet((s) => toggleSet(s, id))} variant="diet" />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Contains allergens</p>
            <TagChips items={ALLERGENS} selected={allg} onToggle={(id) => setAllg((s) => toggleSet(s, id))} variant="allergen" />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">
              Spice level <span className="text-muted-foreground font-normal">— lets diners filter by heat</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {([["None", null], ["Mild", "mild"], ["Medium", "medium"], ["Hot", "hot"]] as const).map(([label, val]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setHeat(val)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    heat === val
                      ? "border-red-400 bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {val ? `🌶 ${label}` : label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            size="sm"
            onClick={() => {
              onSave(product.id, { dietary: [...diet], allergens: [...allg], heat });
              setOpen(false);
            }}
          >
            Save tags
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Guided photo capture: step through the products that have no image yet, snap +
 *  auto-enhance each on a phone. The queue is snapshotted when opened so the list
 *  doesn't shift as photos are added. */
function PhotoStudioDialog({
  open,
  onOpenChange,
  queueIds,
  products,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  queueIds: string[];
  products: Product[];
  onSave: (id: string, patch: ProductPatch) => void;
}) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (open) setIdx(0);
  }, [open]);
  if (queueIds.length === 0) return null;
  const clampedIdx = Math.min(idx, queueIds.length - 1);
  const product = products.find((p) => p.id === queueIds[clampedIdx]);
  const last = clampedIdx === queueIds.length - 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add dish photos</DialogTitle>
          <DialogDescription>
            {clampedIdx + 1} of {queueIds.length} · {product?.name ?? "—"}
          </DialogDescription>
        </DialogHeader>
        {product ? (
          <ImagePicker value={product.image_url} onChange={(u) => onSave(product.id, { image_url: u })} />
        ) : (
          <p className="text-muted-foreground text-sm">This product is no longer here.</p>
        )}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button size="sm" variant="ghost" disabled={clampedIdx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>
            Back
          </Button>
          {last ? (
            <Button size="sm" onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <Button size="sm" onClick={() => setIdx((i) => i + 1)}>
              {product?.image_url ? "Next" : "Skip"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Add/remove tags across every selected product (existing tags preserved). */
function BulkTagsDialog({
  open,
  onOpenChange,
  count,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  count: number;
  onApply: (addDiet: string[], rmDiet: string[], addAll: string[], rmAll: string[]) => void;
}) {
  const [addDiet, setAddDiet] = useState<Set<string>>(new Set());
  const [rmDiet, setRmDiet] = useState<Set<string>>(new Set());
  const [addAll, setAddAll] = useState<Set<string>>(new Set());
  const [rmAll, setRmAll] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (open) {
      setAddDiet(new Set());
      setRmDiet(new Set());
      setAddAll(new Set());
      setRmAll(new Set());
    }
  }, [open]);
  const nothing = addDiet.size + rmDiet.size + addAll.size + rmAll.size === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit tags · {count} product{count === 1 ? "" : "s"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Add to all selected</p>
            <p className="text-muted-foreground text-xs">Dietary</p>
            <TagChips items={DIETARY} selected={addDiet} onToggle={(id) => setAddDiet((s) => toggleSet(s, id))} variant="diet" />
            <p className="text-muted-foreground text-xs">Contains allergens</p>
            <TagChips items={ALLERGENS} selected={addAll} onToggle={(id) => setAddAll((s) => toggleSet(s, id))} variant="allergen" />
          </div>
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium">Remove from all selected</p>
            <p className="text-muted-foreground text-xs">Dietary</p>
            <TagChips items={DIETARY} selected={rmDiet} onToggle={(id) => setRmDiet((s) => toggleSet(s, id))} variant="diet" />
            <p className="text-muted-foreground text-xs">Allergens</p>
            <TagChips items={ALLERGENS} selected={rmAll} onToggle={(id) => setRmAll((s) => toggleSet(s, id))} variant="allergen" />
          </div>
          <p className="text-muted-foreground text-xs">
            Each product keeps its other tags — only the changes above are applied.
          </p>
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={nothing} onClick={() => onApply([...addDiet], [...rmDiet], [...addAll], [...rmAll])}>
            Apply to {count}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
