import type { Metadata } from "next";
import { getActiveStore } from "@/lib/store/active-store";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Orders · Ask Rani" };

export default async function OrdersPage() {
  const ctx = await getActiveStore();
  const store = ctx?.active;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl italic">Orders</h1>
          <p className="text-muted-foreground text-sm">
            {store ? store.name : "—"}
          </p>
        </div>
        <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
          <span className="bg-teal-light size-2 animate-live-pulse rounded-full" />
          live
        </span>
      </div>

      <div className="bg-card flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-20 text-center">
        <Badge variant="secondary">Next chunk</Badge>
        <p className="text-sm font-medium">The realtime order feed lands here.</p>
        <p className="text-muted-foreground max-w-sm text-sm">
          Live list by status with slide-in updates, filters (incl. order mode),
          the order detail with both item variants and the interleaved event
          timeline, and the status actions (approve → propose, confirm, reject,
          cancel, edit).
        </p>
      </div>
    </div>
  );
}
