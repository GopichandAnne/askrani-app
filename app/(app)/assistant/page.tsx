import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getActiveStore } from "@/lib/store/active-store";
import { AssistantChat } from "./assistant-chat";

export const metadata: Metadata = { title: "Ask Rani · help & setup" };
export const dynamic = "force-dynamic";

/**
 * The always-on Setup & Help Copilot inside the panel. The owner chats with Rani
 * to get help AND change their store by natural language (Rani executes the edits).
 */
export default async function AssistantPage() {
  const ctx = await getActiveStore();
  if (!ctx) redirect("/login");
  if (!ctx.active) redirect("/welcome");

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col p-4">
      <div className="mb-3">
        <h1 className="text-lg font-semibold">Ask Rani</h1>
        <p className="text-muted-foreground text-sm">
          Get help, or just tell me what to change — “make the greeting friendlier”, “we’re closed Sundays”, “we do delivery now”.
        </p>
      </div>
      <AssistantChat storeSlug={ctx.active.slug} storeName={ctx.active.name} />
    </div>
  );
}
