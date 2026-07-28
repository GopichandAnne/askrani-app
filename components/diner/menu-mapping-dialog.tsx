"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Link2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadPosMapping, setPosItemMapping, type MappingPayload } from "@/app/(app)/diner/actions";
import type { PosCatalogItem } from "@/lib/pos/types";

const NONE = "__none__";

/** Owner tool to map each dish to the POS's item id, so orders push as real
 *  menu items. Uses a picker when the POS catalog is listable (Square/Clover),
 *  a free-text id field otherwise (Toast/Lightspeed). */
export function MenuMappingDialog({
  provider,
  label,
}: {
  provider: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<MappingPayload | null>(null);
  const [maps, setMaps] = useState<MappingPayload["mappings"]>({});
  const [loading, startLoad] = useTransition();
  const [, startSave] = useTransition();

  function onOpenChange(o: boolean) {
    setOpen(o);
    if (o && !data) {
      startLoad(async () => {
        const res = await loadPosMapping(provider);
        if ("error" in res) {
          toast.error(res.error);
          setOpen(false);
          return;
        }
        setData(res);
        setMaps(res.mappings);
      });
    }
  }

  function save(sku: string, externalId: string, externalName: string | null) {
    // optimistic
    setMaps((m) => {
      const next = { ...m };
      if (externalId) next[sku] = { external_id: externalId, external_name: externalName };
      else delete next[sku];
      return next;
    });
    startSave(async () => {
      const res = await setPosItemMapping(provider, sku, externalId, externalName);
      if (!res.ok) toast.error(res.error);
    });
  }

  const catalog = data?.catalog ?? null;
  const usePicker = !!catalog && catalog.length > 0;
  const catById = new Map<string, PosCatalogItem>((catalog ?? []).map((c) => [c.id, c]));
  const mappedCount = data ? data.products.filter((p) => maps[p.sku]).length : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Link2 className="size-4" /> Map menu
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Map {label} menu</DialogTitle>
          <DialogDescription>
            {data
              ? `${mappedCount} of ${data.products.length} dishes mapped. ${
                  usePicker ? "Pick the matching item." : `Paste each dish's ${label} item id.`
                }`
              : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {loading || !data ? (
          <div className="text-muted-foreground flex items-center gap-2 py-8 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading menu…
          </div>
        ) : data.products.length === 0 ? (
          <p className="text-muted-foreground py-8 text-sm">No dishes with a SKU yet — add your menu first.</p>
        ) : (
          <div className="-mx-1 flex-1 space-y-1.5 overflow-y-auto px-1">
            {data.products.map((p) => {
              const cur = maps[p.sku];
              return (
                <div key={p.sku} className="flex items-center gap-2 rounded-md border p-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="text-muted-foreground truncate text-[11px]">{p.sku}</p>
                  </div>
                  {usePicker ? (
                    <Select
                      value={cur?.external_id ?? NONE}
                      onValueChange={(v) =>
                        v === NONE ? save(p.sku, "", null) : save(p.sku, v, catById.get(v)?.name ?? null)
                      }
                    >
                      <SelectTrigger className="h-9 w-48 shrink-0">
                        <SelectValue placeholder="Not mapped" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Not mapped</SelectItem>
                        {catalog!.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                            {c.price != null ? ` · ${c.price.toFixed(2)}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      defaultValue={cur?.external_id ?? ""}
                      placeholder={`${label} item id`}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (cur?.external_id ?? "")) save(p.sku, v, null);
                      }}
                      className="h-9 w-48 shrink-0"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
