"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addProduct } from "@/app/(app)/inventory/actions";
import type { Product } from "@/lib/inventory/types";
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
import { ImagePicker } from "./product-image";
import { Loader2, Plus } from "lucide-react";

const EMPTY = { name: "", sku: "", brand: "", size: "", unit: "", price: "", image_url: "" };

export function AddProductDialog({
  onAdded,
}: {
  onAdded: (product: Product) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [pending, startTransition] = useTransition();

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    startTransition(async () => {
      const res = await addProduct({
        name: form.name,
        sku: form.sku,
        brand: form.brand,
        size: form.size,
        unit: form.unit,
        price: form.price === "" ? null : Number(form.price),
        image_url: form.image_url || null,
      });
      if (res.ok) {
        onAdded(res.product);
        toast.success("Product added");
        setForm({ ...EMPTY });
        setOpen(false);
      } else {
        toast.error("Couldn't add product", { description: res.error });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> Add product
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add product</DialogTitle>
          <DialogDescription>
            Add an item to this store&apos;s inventory.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="p-name">Name *</Label>
            <Input
              id="p-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Basmati Rice"
              required
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-brand">Brand</Label>
              <Input id="p-brand" value={form.brand} onChange={(e) => set("brand", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-sku">SKU</Label>
              <Input id="p-sku" value={form.sku} onChange={(e) => set("sku", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-size">Size</Label>
              <Input id="p-size" value={form.size} onChange={(e) => set("size", e.target.value)} placeholder="10lb" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-unit">Unit</Label>
              <Input id="p-unit" value={form.unit} onChange={(e) => set("unit", e.target.value)} placeholder="bag" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-price">Price</Label>
            <Input
              id="p-price"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={form.price}
              onChange={(e) => set("price", e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Image</Label>
            <ImagePicker value={form.image_url || null} onChange={(u) => set("image_url", u ?? "")} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Add product
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
