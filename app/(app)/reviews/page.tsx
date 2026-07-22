import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveStore } from "@/lib/store/active-store";
import { ReviewsClient } from "./reviews-client";
import { loadSubmissions } from "./actions";

export const metadata: Metadata = { title: "Post reviews · Ask Rani" };

export default async function ReviewsPage() {
  const ctx = await getActiveStore();
  if (!ctx || !ctx.active) redirect("/login");
  const subs = await loadSubmissions();

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <header>
        <h1 className="font-display text-2xl italic">Post reviews</h1>
        <p className="text-muted-foreground text-sm">
          {ctx.active.name} — customers who posted about you for credit. Open each post, confirm it&apos;s real,
          tags the store, and has the #ad/#gifted disclosure, then approve to credit them.
        </p>
      </header>
      <ReviewsClient initial={subs} />
    </div>
  );
}
