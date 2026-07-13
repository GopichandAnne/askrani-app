"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/app-shell/wordmark";
import { NAV_ITEMS } from "@/components/app-shell/nav-items";
import { getNavCounts } from "@/app/(app)/actions";
import { useStore } from "@/components/store/store-provider";
import { Badge } from "@/components/ui/badge";

export function Sidebar() {
  const pathname = usePathname();
  const { active, isPlatformAdmin } = useStore();
  const isOwner = active.role === "owner" || isPlatformAdmin;

  // "Needs attention" counts (open questions, new requests). Refresh on
  // navigation + store switch (so answering something updates it) + every 60s.
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    const load = () => getNavCounts().then((c) => alive && setCounts(c)).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pathname, active.id]);

  return (
    <aside className="bg-card hidden w-60 shrink-0 flex-col border-r md:flex">
      <div className="flex h-14 items-center px-5">
        <Link href="/orders" aria-label="Ask Rani home">
          <Wordmark />
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV_ITEMS.map((item, i) => {
          if (item.ownerOnly && !isOwner) return null;
          if (item.platformAdminOnly && !isPlatformAdmin) return null;
          const Icon = item.icon;
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          // Divider label above the first platform-admin item.
          const startsAdminSection =
            item.platformAdminOnly && !NAV_ITEMS[i - 1]?.platformAdminOnly;
          const adminLabel = startsAdminSection ? (
            <p
              key="admin-label"
              className="text-muted-foreground/70 mt-3 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide"
            >
              Admin
            </p>
          ) : null;

          const content = !item.available ? (
            <div
              className="text-muted-foreground/60 flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-sm"
              aria-disabled
            >
              <Icon className="size-4" />
              <span className="flex-1">{item.label}</span>
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                Soon
              </Badge>
            </div>
          ) : (
            <Link
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-gradient-primary text-primary-foreground shadow-primary font-medium"
                  : "text-foreground/80 hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              <span className="flex-1">{item.label}</span>
              {(counts[item.href] ?? 0) > 0 && (
                <Badge
                  className={cn(
                    "px-1.5 py-0 text-[10px]",
                    isActive ? "bg-white/25 text-white" : "bg-teal text-white",
                  )}
                >
                  {counts[item.href]}
                </Badge>
              )}
            </Link>
          );

          return (
            <Fragment key={item.href}>
              {adminLabel}
              {content}
            </Fragment>
          );
        })}
      </nav>

      <div className="text-muted-foreground px-5 py-3 text-[11px]">
        Operator panel · v0
      </div>
    </aside>
  );
}
