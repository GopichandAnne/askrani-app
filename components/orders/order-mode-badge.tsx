import type { OrderMode } from "@/lib/orders/types";
import { cn } from "@/lib/utils";

/** Distinguishes catalog ("Standard") orders from off-catalog "Request" orders. */
export function OrderModeBadge({
  mode,
  className,
}: {
  mode: OrderMode;
  className?: string;
}) {
  const isRequest = mode === "request";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        isRequest
          ? "border-coral/40 text-coral-dark dark:text-coral"
          : "text-muted-foreground border-border",
        className,
      )}
    >
      {isRequest ? "Request" : "Standard"}
    </span>
  );
}
