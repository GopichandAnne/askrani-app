"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { computeTotals } from "@/lib/orders/totals";
import type { OrderItem, OrderStatus } from "@/lib/orders/types";
import {
  canApprove,
  canCancel,
  canConfirm,
  canEdit,
  canReject,
} from "@/lib/orders/status";

export type ActionResult =
  | { ok: true; status?: OrderStatus }
  | { ok: false; error: string };

type CurrentOrder = { status: OrderStatus; store_slug: string };

/** Fetch an order the caller is allowed to see (RLS). */
async function loadOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
): Promise<CurrentOrder | null> {
  const { data } = await supabase
    .from("orders")
    .select("status, store_slug")
    .eq("order_id", orderId)
    .maybeSingle();
  return data ?? null;
}

async function transition(
  orderId: string,
  guard: (s: OrderStatus) => boolean,
  next: OrderStatus,
  notAllowedMsg: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const current = await loadOrder(supabase, orderId);
  if (!current) return { ok: false, error: "Order not found." };
  if (!guard(current.status)) {
    return { ok: false, error: notAllowedMsg };
  }

  const { error } = await supabase
    .from("orders")
    .update({ status: next })
    .eq("order_id", orderId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/orders");
  return { ok: true, status: next };
}

/** Approve a placed/submitted/pending order → propose it back to the customer. */
export async function approveOrder(orderId: string): Promise<ActionResult> {
  return transition(
    orderId,
    canApprove,
    "proposed",
    "This order can no longer be approved.",
  );
}

/** Confirm a proposed order. */
export async function confirmOrder(orderId: string): Promise<ActionResult> {
  return transition(
    orderId,
    canConfirm,
    "confirmed",
    "Only a proposed order can be confirmed.",
  );
}

/** Reject an order (pre-confirmation). */
export async function rejectOrder(orderId: string): Promise<ActionResult> {
  return transition(
    orderId,
    canReject,
    "rejected",
    "This order can no longer be rejected.",
  );
}

/** Cancel an order (only before it is confirmed). */
export async function cancelOrder(orderId: string): Promise<ActionResult> {
  return transition(
    orderId,
    canCancel,
    "cancelled",
    "A confirmed order can't be cancelled here.",
  );
}

/**
 * Edit line items (notably: set prices on request items), then recompute
 * subtotal/tax/total using the store's tax_rate from agent_config. Allowed only
 * pre-confirmation. Mirrors editOrder in Orders.gs.
 */
export async function editOrder(
  orderId: string,
  items: OrderItem[],
): Promise<ActionResult> {
  if (!Array.isArray(items)) {
    return { ok: false, error: "Invalid items." };
  }

  const supabase = await createClient();
  const current = await loadOrder(supabase, orderId);
  if (!current) return { ok: false, error: "Order not found." };
  if (!canEdit(current.status)) {
    return { ok: false, error: "This order can no longer be edited." };
  }

  // Resolve the store's tax rate (server-side; never trust a client value).
  const { data: store } = await supabase
    .from("stores")
    .select("id")
    .eq("slug", current.store_slug)
    .maybeSingle();
  let taxRate = 0;
  if (store) {
    const { data: cfg } = await supabase
      .from("agent_config")
      .select("value")
      .eq("store_id", store.id)
      .eq("key", "tax_rate")
      .maybeSingle();
    taxRate = Number.parseFloat(cfg?.value ?? "0") || 0;
  }

  // Recompute line_total per item and the order totals.
  const normalized: OrderItem[] = items.map((item) => {
    const unit_price = item.unit_price == null ? null : Number(item.unit_price);
    const quantity = Number(item.quantity ?? 0);
    const line_total =
      unit_price == null
        ? null
        : Math.round((unit_price * quantity + Number.EPSILON) * 100) / 100;
    return { ...item, unit_price, quantity, line_total } as OrderItem;
  });
  const totals = computeTotals(normalized, taxRate);

  const { error } = await supabase
    .from("orders")
    .update({
      items_json: normalized,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
    })
    .eq("order_id", orderId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/orders");
  return { ok: true };
}
