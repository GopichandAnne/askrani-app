import Link from "next/link";
import { getActiveStore } from "@/lib/store/active-store";
import { createClient } from "@/lib/supabase/server";
import { CheckCircle2, Circle } from "lucide-react";

/** First-run "get your assistant ready" checklist. Owner-only; renders nothing
 *  once every step is done. Server component — computes live setup state. */
export async function SetupChecklist() {
  const ctx = await getActiveStore();
  if (!ctx?.active) return null;
  const store = ctx.active;

  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("user_is_owner", { p_store_id: store.id });
  if (!isOwner) return null;

  const [cfg, prod, know, tok, resp] = await Promise.all([
    supabase.from("agent_config").select("key,value").eq("store_id", store.id).in("key", ["personality", "store_prompt"]),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("store_id", store.id),
    supabase.from("knowledge_index").select("id", { count: "exact", head: true }).eq("store_id", store.id),
    supabase.from("store_tokens").select("id", { count: "exact", head: true }).eq("store_id", store.id),
    supabase.from("store_responders").select("id", { count: "exact", head: true }).eq("store_slug", store.slug),
  ]);

  const steps = [
    {
      done: (cfg.data ?? []).some((r) => (r.value ?? "").trim().length > 20),
      label: "Describe your business",
      desc: "Tell Rani who you are, what you sell, and how to sound.",
      href: "/agent",
    },
    {
      done: (prod.count ?? 0) > 0 || (know.count ?? 0) > 0,
      label: "Add your catalogue or knowledge",
      desc: "Import a menu, add products, or add a few Q&As.",
      href: "/inventory",
    },
    {
      done: (tok.count ?? 0) > 0,
      label: "Create your chat link",
      desc: "Generate the web link / QR code to share with customers.",
      href: "/link",
    },
    {
      done: (resp.count ?? 0) > 0,
      label: "Add a responder",
      desc: "So questions and new orders reach a real person.",
      href: "/agent",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <div className="mx-auto max-w-6xl px-6 pt-6">
      <div className="bg-card rounded-lg border p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg italic">Get {store.name} ready</h2>
          <span className="text-muted-foreground text-sm">{doneCount} of {steps.length} done</span>
        </div>
        <p className="text-muted-foreground mb-3 mt-0.5 text-sm">
          A few quick steps and Rani is ready for your customers.
        </p>
        <ul className="space-y-1">
          {steps.map((s) => (
            <li key={s.label}>
              <Link
                href={s.href}
                className={"flex items-center gap-3 rounded-md p-2 " + (s.done ? "opacity-60" : "hover:bg-muted")}
              >
                {s.done ? (
                  <CheckCircle2 className="text-teal size-5 shrink-0" />
                ) : (
                  <Circle className="text-muted-foreground size-5 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className={"text-sm font-medium" + (s.done ? " line-through" : "")}>{s.label}</p>
                  {!s.done && <p className="text-muted-foreground text-xs">{s.desc}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
