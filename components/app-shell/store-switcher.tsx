"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Store } from "lucide-react";
import { useStore } from "@/components/store/store-provider";
import { setActiveStore } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function StoreSwitcher() {
  const { stores, active } = useStore();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Single store: no switcher, just a label.
  if (stores.length <= 1) {
    return (
      <div className="text-foreground flex items-center gap-2 px-2 text-sm font-medium">
        <Store className="text-muted-foreground size-4" />
        {active.name}
      </div>
    );
  }

  function select(slug: string) {
    if (slug === active.slug) return;
    startTransition(async () => {
      await setActiveStore(slug);
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="max-w-[220px] justify-between gap-2"
          disabled={pending}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Store className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate">{active.name}</span>
          </span>
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[240px]">
        <DropdownMenuLabel>Switch store</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {stores.map((s) => (
          <DropdownMenuItem
            key={s.slug}
            onSelect={() => select(s.slug)}
            className="gap-2"
          >
            <Check
              className={cn(
                "size-4",
                s.slug === active.slug ? "opacity-100" : "opacity-0",
              )}
            />
            <span className="flex-1 truncate">{s.name}</span>
            <span className="text-muted-foreground text-xs capitalize">
              {s.role}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
