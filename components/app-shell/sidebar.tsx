"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/app-shell/wordmark";
import { NAV_ITEMS } from "@/components/app-shell/nav-items";
import { useStore } from "@/components/store/store-provider";
import { Badge } from "@/components/ui/badge";

export function Sidebar() {
  const pathname = usePathname();
  const { active, isPlatformAdmin } = useStore();
  const isOwner = active.role === "owner" || isPlatformAdmin;

  return (
    <aside className="bg-card hidden w-60 shrink-0 flex-col border-r md:flex">
      <div className="flex h-14 items-center px-5">
        <Link href="/orders" aria-label="Ask Rani home">
          <Wordmark />
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV_ITEMS.map((item) => {
          if (item.ownerOnly && !isOwner) return null;
          const Icon = item.icon;
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          if (!item.available) {
            return (
              <div
                key={item.href}
                className="text-muted-foreground/60 flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-sm"
                aria-disabled
              >
                <Icon className="size-4" />
                <span className="flex-1">{item.label}</span>
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  Soon
                </Badge>
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-gradient-primary text-primary-foreground shadow-primary font-medium"
                  : "text-foreground/80 hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="text-muted-foreground px-5 py-3 text-[11px]">
        Operator panel · v0
      </div>
    </aside>
  );
}
