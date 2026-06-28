"use client";

import type { Order } from "@/lib/orders/types";
import { StatusChip } from "./status-chip";
import { OrderModeBadge } from "./order-mode-badge";
import { formatRelative } from "@/lib/format";
import { formatMoney } from "@/lib/orders/totals";
import { cn } from "@/lib/utils";

export function OrderRow({
  order,
  selected,
  highlighted,
  onSelect,
}: {
  order: Order;
  selected: boolean;
  highlighted: boolean;
  onSelect: (order: Order) => void;
}) {
  const total = order.total ?? order.subtotal;
  const itemCount = order.items_json.length;
  const customer =
    order.customer_name?.trim() || order.customer_phone || "Unknown customer";

  return (
    <button
      type="button"
      onClick={() => onSelect(order)}
      aria-pressed={selected}
      className={cn(
        "block w-full rounded-lg border px-4 py-3 text-left transition-colors ease-lift",
        selected
          ? "border-teal bg-teal-mist/60 dark:bg-secondary"
          : "hover:border-teal/40 hover:bg-muted/40",
        highlighted && "animate-slide-in ring-1 ring-teal/50",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-sm font-medium">
            {order.order_id}
          </span>
          <OrderModeBadge mode={order.order_mode} />
        </div>
        <StatusChip status={order.status} />
      </div>
      <div className="text-muted-foreground mt-1.5 flex items-center justify-between gap-3 text-sm">
        <span className="truncate">{customer}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-foreground font-medium">
            {formatMoney(total, order.currency ?? "USD")}
          </span>
          <span aria-hidden>·</span>
          <span>{itemCount} item{itemCount === 1 ? "" : "s"}</span>
          {order.timestamp && (
            <>
              <span aria-hidden>·</span>
              <span>{formatRelative(order.timestamp)}</span>
            </>
          )}
        </span>
      </div>
    </button>
  );
}
