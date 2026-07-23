import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { RedemptionsClient } from "./redemptions-client";
import { getRedemptionRules } from "./actions";

export const metadata: Metadata = { title: "Redemptions · Ask Rani" };

export default async function RedemptionsPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const store = ctx.active;
  const { rules, isOwner } = await getRedemptionRules();

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <header>
        <h1 className="font-display text-2xl italic">Redemptions</h1>
        <p className="text-muted-foreground text-sm">
          {store.name} — a customer taps “use my credit” in chat and gets a 4-digit code. Enter it here
          to confirm, then apply that amount as a discount on your own register.
        </p>
      </header>
      <RedemptionsClient rules={rules} isOwner={isOwner} />
    </div>
  );
}
