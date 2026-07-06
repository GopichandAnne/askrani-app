"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Product, ProductPatch } from "@/lib/inventory/types";
import { removeProduct, updateProduct } from "@/app/(app)/inventory/actions";
import { useStore } from "@/components/store/store-provider";
import { formatMoney } from "@/lib/orders/totals";
import { AddProductDialog } from "./add-product-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
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
import { PackageOpen, Search, Trash2 } from "lucide-react";

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
    const res = await removeProduct(id);
    if (res.ok) toast.success("Product removed");
    else {
      setProducts(before);
      toast.error("Couldn't remove", { description: res.error });
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl italic">Catalog</h1>
          <p className="text-muted-foreground text-sm">{storeName}</p>
        </div>
        {isOwner && (
          <AddProductDialog
            onAdded={(p) => setProducts((prev) => [p, ...prev])}
          />
        )}
      </header>

      <div className="relative max-w-sm">
        <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, brand, or SKU"
          className="pl-8"
        />
      </div>

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
                <TableHead>Product</TableHead>
                <TableHead className="w-28">SKU</TableHead>
                <TableHead className="w-32">Price</TableHead>
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
  onSave,
  onRemove,
}: {
  product: Product;
  isOwner: boolean;
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
