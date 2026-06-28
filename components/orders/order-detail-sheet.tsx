"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { Order, OrderItem } from "@/lib/orders/types";
import { isRequestItem } from "@/lib/orders/types";
import {
  canApprove,
  canCancel,
  canConfirm,
  canEdit,
  canReject,
} from "@/lib/orders/status";
import { computeTotals, formatMoney, lineTotal } from "@/lib/orders/totals";
import { formatDateTime } from "@/lib/format";
import { eventLabel } from "@/lib/conversations/events";
import {
  approveOrder,
  cancelOrder,
  confirmOrder,
  editOrder,
  rejectOrder,
  type ActionResult,
} from "@/app/(app)/orders/actions";
import { useStore } from "@/components/store/store-provider";
import { StatusChip } from "./status-chip";
import { OrderModeBadge } from "./order-mode-badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Check, Loader2, Pencil } from "lucide-react";

type TimelineRow = {
  message_id: string;
  created_at: string;
  kind: "message" | "event";
  event_type: string | null;
  direction: "inbound" | "outbound" | "system" | null;
  sender: string | null;
  text: string | null;
};


export function OrderDetailSheet({
  order,
  open,
  onOpenChange,
  taxRate,
  onApplied,
}: {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taxRate: number;
  onApplied: (orderId: string, patch: Partial<Order>) => void;
}) {
  const { active, isPlatformAdmin } = useStore();
  const isOwner = isPlatformAdmin || active.role === "owner";
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<OrderItem[]>([]);
  const [timeline, setTimeline] = useState<TimelineRow[] | null>(null);

  // Reset editing state whenever a different order opens.
  useEffect(() => {
    setEditing(false);
    setDraft(order?.items_json ?? []);
  }, [order?.order_id, order?.items_json]);

  // Load the interleaved event timeline from thread_messages.
  const orderId = order?.order_id;
  useEffect(() => {
    if (!open || !orderId) return;
    let active = true;
    setTimeline(null);
    const supabase = createClient();
    supabase
      .from("thread_messages")
      .select("message_id, created_at, kind, event_type, direction, sender, text")
      .eq("related_order_id", orderId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (active) setTimeline((data as TimelineRow[]) ?? []);
      });
    return () => {
      active = false;
    };
  }, [open, orderId]);

  const currency = order?.currency ?? "USD";
  const previewTotals = useMemo(
    () => computeTotals(editing ? draft : (order?.items_json ?? []), taxRate),
    [editing, draft, order?.items_json, taxRate],
  );

  if (!order) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-lg" />
      </Sheet>
    );
  }

  function runAction(fn: () => Promise<ActionResult>, optimistic: Partial<Order>) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        onApplied(order!.order_id, optimistic);
        toast.success("Order updated");
        if ("status" in optimistic) onOpenChange(false);
      } else {
        toast.error("Couldn't update order", { description: res.error });
      }
    });
  }

  function saveEdit() {
    const totals = computeTotals(draft, taxRate);
    startTransition(async () => {
      const res = await editOrder(order!.order_id, draft);
      if (res.ok) {
        onApplied(order!.order_id, {
          items_json: draft,
          subtotal: totals.subtotal,
          tax: totals.tax,
          total: totals.total,
        });
        toast.success("Order saved");
        setEditing(false);
      } else {
        toast.error("Couldn't save order", { description: res.error });
      }
    });
  }

  function updateDraft(index: number, patch: Partial<OrderItem>) {
    setDraft((prev) =>
      prev.map((it, i) => (i === index ? ({ ...it, ...patch } as OrderItem) : it)),
    );
  }

  const status = order.status;
  const items = editing ? draft : order.items_json;
  const customer =
    order.customer_name?.trim() || order.customer_phone || "Unknown customer";
  // Owners can edit any line; staff can only price request items. Hide Edit
  // entirely when there's nothing the current role may change.
  const canEditAnyLine = isOwner || order.items_json.some(isRequestItem);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="space-y-0 border-b p-4">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="font-mono text-base">
              {order.order_id}
            </SheetTitle>
            <StatusChip status={status} />
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-sm">
            <OrderModeBadge mode={order.order_mode} />
            <span>{customer}</span>
            {order.fulfillment && (
              <>
                <span aria-hidden>·</span>
                <span className="capitalize">{order.fulfillment}</span>
              </>
            )}
            {order.timestamp && (
              <>
                <span aria-hidden>·</span>
                <span>{formatDateTime(order.timestamp)}</span>
              </>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {/* Items */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Items</h3>
              {canEdit(status) && !editing && canEditAnyLine && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="size-3.5" /> Edit
                </Button>
              )}
            </div>
            <div className="divide-y rounded-lg border">
              {items.map((item, i) => {
                const lt = lineTotal(item);
                const request = isRequestItem(item);
                const title =
                  item.name?.trim() ||
                  (request ? item.description?.trim() : "") ||
                  "Item";
                const meta = [item.brand, item.size, item.unit]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-3 p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{title}</p>
                      {meta && (
                        <p className="text-muted-foreground text-xs">{meta}</p>
                      )}
                      <p className="text-muted-foreground text-xs">
                        Qty {item.quantity}
                        {request && (
                          <span className="text-coral-dark dark:text-coral">
                            {" "}
                            · request
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {editing && (isOwner || request) ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground text-xs">
                              $
                            </span>
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              value={item.unit_price ?? ""}
                              placeholder="price"
                              onChange={(e) =>
                                updateDraft(i, {
                                  unit_price:
                                    e.target.value === ""
                                      ? null
                                      : Number(e.target.value),
                                } as Partial<OrderItem>)
                              }
                              className="h-8 w-24 text-right"
                            />
                          </div>
                          {lt != null && (
                            <span className="text-muted-foreground text-xs">
                              = {formatMoney(lt, currency)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <>
                          <p className="font-medium">
                            {lt == null ? (
                              <span className="text-coral-dark dark:text-coral">
                                Needs price
                              </span>
                            ) : (
                              formatMoney(lt, currency)
                            )}
                          </p>
                          {item.unit_price != null && (
                            <p className="text-muted-foreground text-xs">
                              {formatMoney(item.unit_price, currency)} ea
                            </p>
                          )}
                          {editing && !isOwner && !request && (
                            <p className="text-muted-foreground text-[10px]">
                              owner only
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Totals */}
          <section className="space-y-1.5 text-sm">
            <Row label="Subtotal" value={formatMoney(previewTotals.subtotal, currency)} />
            <Row label="Tax" value={formatMoney(previewTotals.tax, currency)} />
            <Separator className="my-1" />
            <Row
              label="Total"
              value={formatMoney(previewTotals.total, currency)}
              strong
            />
            {previewTotals.hasUnpriced && (
              <p className="text-coral-dark dark:text-coral text-xs">
                Some request items still need a price.
              </p>
            )}
          </section>

          {editing && (
            <div className="flex items-center gap-2">
              <Button onClick={saveEdit} disabled={pending} size="sm">
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                Save prices
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  setEditing(false);
                  setDraft(order.items_json);
                }}
              >
                Cancel
              </Button>
            </div>
          )}

          {order.notes && (
            <section className="space-y-1">
              <h3 className="text-sm font-semibold">Notes</h3>
              <p className="text-muted-foreground whitespace-pre-wrap text-sm">
                {order.notes}
              </p>
            </section>
          )}

          {/* Event timeline */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Timeline</h3>
            <Timeline rows={timeline} />
          </section>
        </div>

        {/* Status actions */}
        {!editing && (
          <div className="flex flex-wrap items-center gap-2 border-t p-4">
            {canApprove(status) && (
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  runAction(() => approveOrder(order.order_id), {
                    status: "proposed",
                  })
                }
              >
                Approve → propose
              </Button>
            )}
            {canConfirm(status) && (
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  runAction(() => confirmOrder(order.order_id), {
                    status: "confirmed",
                  })
                }
              >
                Confirm order
              </Button>
            )}
            {canReject(status) && (
              <ConfirmAction
                trigger={
                  <Button variant="outline" size="sm" disabled={pending}>
                    Reject
                  </Button>
                }
                title="Reject this order?"
                description="The customer's order will be marked rejected."
                confirmLabel="Reject order"
                onConfirm={() =>
                  runAction(() => rejectOrder(order.order_id), {
                    status: "rejected",
                  })
                }
              />
            )}
            {canCancel(status) && (
              <ConfirmAction
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    className="text-destructive hover:text-destructive"
                  >
                    Cancel order
                  </Button>
                }
                title="Cancel this order?"
                description="Only possible before the order is confirmed."
                confirmLabel="Cancel order"
                onConfirm={() =>
                  runAction(() => cancelOrder(order.order_id), {
                    status: "cancelled",
                  })
                }
              />
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? "font-semibold" : "text-muted-foreground"}>
        {label}
      </span>
      <span className={strong ? "font-semibold" : ""}>{value}</span>
    </div>
  );
}

function Timeline({ rows }: { rows: TimelineRow[] | null }) {
  if (rows == null) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-3/4" />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No messages or events recorded for this order yet.
      </p>
    );
  }
  return (
    <ol className="space-y-2">
      {rows.map((r) => {
        if (r.kind === "event") {
          const label = eventLabel(r.event_type);
          return (
            <li key={r.message_id} className="flex items-center gap-2 text-xs">
              <span className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 font-medium">
                {label}
              </span>
              <span className="text-muted-foreground">
                {formatDateTime(r.created_at)}
              </span>
            </li>
          );
        }
        const inbound = r.direction === "inbound";
        return (
          <li
            key={r.message_id}
            className={inbound ? "flex justify-start" : "flex justify-end"}
          >
            <div
              className={
                inbound
                  ? "bg-muted max-w-[80%] rounded-lg rounded-tl-sm px-3 py-1.5 text-sm"
                  : "bg-teal-mist dark:bg-secondary max-w-[80%] rounded-lg rounded-tr-sm px-3 py-1.5 text-sm"
              }
            >
              {r.text && <p className="whitespace-pre-wrap">{r.text}</p>}
              <p className="text-muted-foreground mt-0.5 text-[10px]">
                {r.sender ?? (inbound ? "customer" : "agent")} ·{" "}
                {formatDateTime(r.created_at)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep order</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
