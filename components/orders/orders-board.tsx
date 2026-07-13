"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Order, OrderRow, OrderStatus } from "@/lib/orders/types";
import { toOrder } from "@/lib/orders/types";
import type { Charge } from "@/lib/orders/totals";
import { ORDER_STATUSES } from "@/lib/orders/status";
import { OrderFilters, type OrderFiltersValue } from "./order-filters";
import { OrderRow as OrderRowItem } from "./order-row";
import { OrderDetailSheet } from "./order-detail-sheet";
import { LiveDot } from "./live-dot";
import { Inbox } from "lucide-react";

export function OrdersBoard({
  initialOrders,
  storeSlug,
  storeName,
  charges,
}: {
  initialOrders: Order[];
  storeSlug: string;
  storeName: string;
  charges: Charge[];
}) {
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [filters, setFilters] = useState<OrderFiltersValue>({
    status: "all",
    mode: "all",
    query: "",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Reset when the active store changes (new initial data from the server).
  useEffect(() => {
    setOrders(initialOrders);
    setSelectedId(null);
  }, [storeSlug, initialOrders]);

  // Realtime: live INSERT/UPDATE/DELETE for this store's orders.
  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    (async () => {
      // Hand the user's access token to the realtime socket BEFORE subscribing.
      // `orders` is RLS-protected, so without this the subscription doesn't
      // authorize (the dot stays "offline" / no rows arrive). createBrowserClient
      // doesn't reliably set this before the first subscribe.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }

      channel = supabase
        .channel(`orders-${storeSlug}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "orders",
            filter: `store_slug=eq.${storeSlug}`,
          },
          (payload) => {
            if (payload.eventType === "DELETE") {
              const oldId = (payload.old as { id?: string })?.id;
              if (oldId)
                setOrders((prev) => prev.filter((o) => o.id !== oldId));
              return;
            }
            const row = toOrder(payload.new as OrderRow);
            flash(row.id);
            setOrders((prev) => {
              const idx = prev.findIndex((o) => o.id === row.id);
              if (idx === -1) return [row, ...prev];
              const copy = prev.slice();
              copy[idx] = row;
              return copy;
            });
          },
        )
        .subscribe((status) => setConnected(status === "SUBSCRIBED"));
    })();

    return () => {
      cancelled = true;
      setConnected(false);
      if (channel) supabase.removeChannel(channel);
    };
  }, [storeSlug]);

  // Clear all flash timers on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  function flash(id: string) {
    setHighlight((prev) => new Set(prev).add(id));
    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      setHighlight((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      timers.current.delete(id);
    }, 2200);
    timers.current.set(id, t);
  }

  // Optimistic local patch after a status/edit action.
  function applyLocal(orderId: string, patch: Partial<Order>) {
    setOrders((prev) =>
      prev.map((o) => (o.order_id === orderId ? { ...o, ...patch } : o)),
    );
  }

  const counts = useMemo(() => {
    const c = Object.fromEntries(
      ORDER_STATUSES.map((s) => [s, 0]),
    ) as Record<OrderStatus, number>;
    for (const o of orders) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [orders]);

  const filtered = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    return orders.filter((o) => {
      if (filters.status !== "all" && o.status !== filters.status) return false;
      if (filters.mode !== "all" && o.order_mode !== filters.mode) return false;
      if (q) {
        const hay =
          `${o.order_id} ${o.customer_name ?? ""} ${o.customer_phone ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [orders, filters]);

  const selected = orders.find((o) => o.order_id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl italic">Orders</h1>
          <p className="text-muted-foreground text-sm">{storeName}</p>
        </div>
        <LiveDot connected={connected} />
      </header>

      <OrderFilters
        value={filters}
        counts={counts}
        total={orders.length}
        onChange={setFilters}
      />

      {filtered.length === 0 ? (
        <div className="bg-card flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-20 text-center">
          <Inbox className="text-muted-foreground size-6" />
          <p className="text-sm font-medium">
            {orders.length === 0
              ? "No orders yet"
              : "No orders match these filters"}
          </p>
          <p className="text-muted-foreground max-w-sm text-sm">
            {orders.length === 0
              ? `New orders for ${storeName} appear here the moment they're placed.`
              : "Try clearing the search or switching the status tab."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((o) => (
            <OrderRowItem
              key={o.id}
              order={o}
              selected={o.order_id === selectedId}
              highlighted={highlight.has(o.id)}
              onSelect={(ord) => setSelectedId(ord.order_id)}
            />
          ))}
        </div>
      )}

      <OrderDetailSheet
        order={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        charges={charges}
        onApplied={applyLocal}
      />
    </div>
  );
}
