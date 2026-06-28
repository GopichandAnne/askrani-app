"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { computeTotals } from "@/lib/orders/totals";
import { isRequestItem, parseItems } from "@/lib/orders/types";
import type { OrderItem, OrderStatus } from "@/lib/orders/types";
import {
  canApprove,
  canCancel,
  canConfirm,
  canEdit,
  canReject,
} from "@/lib/orders/status";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const fmtPrice = (p: number | null) => (p == null ? "—" : p.toFixed(2));
function priceEqual(a: number | null, b: number | null) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return round2(a) === round2(b);
}

type PriceChange = {
  label: string;
  oldP: number | null;
  newP: number | null;
  isCatalog: boolean;
};

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
 * Edit line item prices, then recompute subtotal/tax/total using the store's
 * tax_rate. Allowed only on submitted/pending_approval/proposed (canEdit).
 *
 * Access (enforced here AND mirrored in the UI):
 *   - Owners (and platform admins) may change ANY line's price, including
 *     catalog prices (which can drift from the pricing source).
 *   - Staff may only price/reprice REQUEST items; changing an existing catalog
 *     price is rejected.
 *
 * Traceability (mirrors Orders.gs): every save appends an inline audit tag to
 * `notes` (timestamp · actor · old→new per changed line) and emits a
 * `price_edited` event into thread_messages so it shows in the order timeline.
 */
export async function editOrder(
  orderId: string,
  items: OrderItem[],
): Promise<ActionResult> {
  if (!Array.isArray(items)) {
    return { ok: false, error: "Invalid items." };
  }

  const supabase = await createClient();

  // Load the full current order (need items for the diff, notes to append).
  const { data: currentRow } = await supabase
    .from("orders")
    .select(
      "status, store_slug, items_json, notes, customer_phone, customer_name",
    )
    .eq("order_id", orderId)
    .maybeSingle();
  if (!currentRow) return { ok: false, error: "Order not found." };
  if (!canEdit(currentRow.status)) {
    return { ok: false, error: "This order can no longer be edited." };
  }

  // Who is acting, and are they an owner of this store?
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const actor = user?.email ?? user?.id ?? "unknown";

  const { data: store } = await supabase
    .from("stores")
    .select("id")
    .eq("slug", currentRow.store_slug)
    .maybeSingle();
  if (!store) return { ok: false, error: "Store not found." };

  const { data: ownerFlag } = await supabase.rpc("user_is_owner", {
    p_store_id: store.id,
  });
  const isOwner = ownerFlag ?? false;

  const { data: cfg } = await supabase
    .from("agent_config")
    .select("value")
    .eq("store_id", store.id)
    .eq("key", "tax_rate")
    .maybeSingle();
  const taxRate = Number.parseFloat(cfg?.value ?? "0") || 0;

  // Normalize incoming items (recompute line_total).
  const normalized: OrderItem[] = items.map((item) => {
    const unit_price = item.unit_price == null ? null : Number(item.unit_price);
    const quantity = Number(item.quantity ?? 0);
    const line_total = unit_price == null ? null : round2(unit_price * quantity);
    return { ...item, unit_price, quantity, line_total } as OrderItem;
  });

  // Diff prices against the stored order (matched by index; the editor never
  // adds/removes lines).
  const currentItems = parseItems(currentRow.items_json);
  const changes: PriceChange[] = [];
  normalized.forEach((it, i) => {
    const prev = currentItems[i];
    const oldP = prev?.unit_price ?? null;
    const newP = it.unit_price ?? null;
    if (priceEqual(oldP, newP)) return;
    const isCatalog = prev ? !isRequestItem(prev) : !isRequestItem(it);
    const label =
      (it.name && it.name.trim()) ||
      (isRequestItem(it) ? it.description?.trim() : "") ||
      (prev?.name && prev.name.trim()) ||
      "Item";
    changes.push({ label, oldP, newP, isCatalog });
  });

  if (changes.length === 0) {
    return { ok: true }; // nothing actually changed
  }

  // Access gate: only owners may change a catalog price.
  if (!isOwner && changes.some((c) => c.isCatalog)) {
    return {
      ok: false,
      error:
        "Only owners can change catalog prices. Staff can price request items.",
    };
  }

  const totals = computeTotals(normalized, taxRate);

  // Inline audit tag appended to notes (append-only history).
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const tag = `[${stamp}Z ${actor} · price: ${changes
    .map((c) => `${c.label} ${fmtPrice(c.oldP)}→${fmtPrice(c.newP)}`)
    .join("; ")}]`;
  const notes = currentRow.notes ? `${currentRow.notes}\n${tag}` : tag;

  const { error } = await supabase
    .from("orders")
    .update({
      items_json: normalized,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      notes,
    })
    .eq("order_id", orderId);
  if (error) return { ok: false, error: error.message };

  // Emit a price_edited event so the change shows in the order timeline.
  // Best-effort: the edit is already saved and audited in `notes`.
  await emitPriceEditedEvent(supabase, {
    orderId,
    storeSlug: currentRow.store_slug,
    customerPhone: currentRow.customer_phone,
    customerName: currentRow.customer_name,
    actor,
    changes,
  });

  revalidatePath("/orders");
  return { ok: true };
}

/**
 * Append a `price_edited` event to thread_messages. thread_messages.thread_id
 * FKs threads, so we upsert a minimal thread first (ignore-duplicates, never
 * clobber a real one). Non-fatal — any failure leaves the notes audit intact.
 */
async function emitPriceEditedEvent(
  supabase: SupabaseServerClient,
  args: {
    orderId: string;
    storeSlug: string;
    customerPhone: string | null;
    customerName: string | null;
    actor: string;
    changes: PriceChange[];
  },
): Promise<void> {
  const { orderId, storeSlug, customerPhone, customerName, actor, changes } =
    args;
  if (!customerPhone) return; // can't form the thread id without a phone

  const threadId = `thr_${customerPhone}_${storeSlug}`;
  const summary = `${actor} updated prices: ${changes
    .map((c) => `${c.label} ${fmtPrice(c.oldP)}→${fmtPrice(c.newP)}`)
    .join("; ")}`;

  await supabase.from("threads").upsert(
    {
      thread_id: threadId,
      store_slug: storeSlug,
      customer_phone: customerPhone,
      customer_name: customerName,
    },
    { onConflict: "thread_id", ignoreDuplicates: true },
  );

  await supabase.from("thread_messages").insert({
    message_id: `evt_${randomUUID()}`,
    thread_id: threadId,
    store_slug: storeSlug,
    customer_phone: customerPhone,
    direction: "system",
    sender: actor,
    kind: "event",
    event_type: "price_edited",
    related_order_id: orderId,
    text: summary,
    event_payload_json: { by: actor, changes },
  });
}
