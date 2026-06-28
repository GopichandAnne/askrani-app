"use client";

import type { OrderMode, OrderStatus } from "@/lib/orders/types";
import { ORDER_STATUSES, STATUS_LABEL } from "@/lib/orders/status";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";

export type OrderFiltersValue = {
  status: OrderStatus | "all";
  mode: OrderMode | "all";
  query: string;
};

export function OrderFilters({
  value,
  counts,
  total,
  onChange,
}: {
  value: OrderFiltersValue;
  counts: Record<OrderStatus, number>;
  total: number;
  onChange: (next: OrderFiltersValue) => void;
}) {
  const tabs: { key: OrderStatus | "all"; label: string; count: number }[] = [
    { key: "all", label: "All", count: total },
    ...ORDER_STATUSES.map((s) => ({
      key: s,
      label: STATUS_LABEL[s],
      count: counts[s],
    })),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {tabs.map((t) => {
          const active = value.status === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange({ ...value, status: t.key })}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-transparent bg-gradient-primary text-white shadow-primary"
                  : "text-muted-foreground hover:border-teal/40 hover:text-foreground",
              )}
            >
              {t.label}
              <span
                className={cn(
                  "rounded-full px-1 text-[10px] tabular-nums",
                  active ? "bg-white/20" : "bg-muted",
                )}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={value.query}
            onChange={(e) => onChange({ ...value, query: e.target.value })}
            placeholder="Search order #, name, or phone"
            className="pl-8"
          />
        </div>
        <Select
          value={value.mode}
          onValueChange={(v) =>
            onChange({ ...value, mode: v as OrderFiltersValue["mode"] })
          }
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All modes</SelectItem>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="request">Request</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
