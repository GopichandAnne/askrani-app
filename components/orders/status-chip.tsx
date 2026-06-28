import type { OrderStatus } from "@/lib/orders/types";
import { STATUS_LABEL, statusVars } from "@/lib/orders/status";
import { cn } from "@/lib/utils";

/** Soft-tint status chip; colors come from tokens.css via statusVars(). */
export function StatusChip({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  const v = statusVars(status);
  return (
    <span
      style={{ color: v.color, backgroundColor: v.background }}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
