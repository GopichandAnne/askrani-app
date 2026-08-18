"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FlaskConical, Loader2, Trash2, Wand2 } from "lucide-react";

export type ApiTool = { id: string; name: string; description: string; method: string; side_effect: boolean };
type BuiltTool = ApiTool & { tested?: "ok" | "failed" | "skipped" };

/**
 * The builder brain, in the panel. The owner pastes an OpenAPI URL + what they
 * want; integration-build reads the spec, generates callable tools, and the bot
 * picks them up. Any API key is entered here and stored encrypted (never seen by
 * the model). This is the long-tail path — beyond the one-click OAuth providers.
 */
export function ApiBuilder({ storeSlug, isOwner, tools }: { storeSlug: string; isOwner: boolean; tools: ApiTool[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [goal, setGoal] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [testId, setTestId] = useState<string | null>(null);

  async function build() {
    if (!isOwner) { toast.error("Only the store owner can add tools."); return; }
    if (!url.trim()) { toast.error("Paste your API's OpenAPI URL."); return; }
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("integration-build", {
      body: { action: "build", storeSlug, openapiUrl: url.trim(), goal: goal.trim(), apiKey: apiKey.trim() || undefined },
    });
    setBusy(false);
    const err = (data as { error?: string } | null)?.error;
    if (error || err || !(data as { ok?: boolean })?.ok) {
      toast.error("Couldn't build tools", { description: err ?? "Check the URL is a JSON OpenAPI spec." });
      return;
    }
    const created = (data as { created?: BuiltTool[] }).created ?? [];
    const needKey = (data as { auth_needed?: boolean }).auth_needed;
    const passed = created.filter((t) => t.tested === "ok").length;
    const failed = created.filter((t) => t.tested === "failed").length;
    const label = (t: BuiltTool) => `${t.name}${t.tested === "ok" ? " ✓" : t.tested === "failed" ? " ⚠" : ""}`;

    if (needKey) {
      toast.warning(`Added ${created.length} tool${created.length === 1 ? "" : "s"} — needs a key`, {
        description: "This API needs a key to answer. Paste it above and rebuild so I can test the connection.",
      });
    } else if (failed > 0) {
      toast.warning(`Added ${created.length}, but ${failed} didn't answer`, {
        description: `${created.map(label).join(", ")}. ⚠ = the test call failed — check the URL or key. ✓ = live and working.`,
      });
    } else {
      toast.success(`Added ${created.length} tool${created.length === 1 ? "" : "s"}`, {
        description: passed > 0 ? `Tested live: ${created.map(label).join(", ")}` : created.map((t) => t.name).join(", "),
      });
    }
    setUrl(""); setGoal(""); setApiKey("");
    router.refresh();
  }

  async function test(id: string) {
    setTestId(id);
    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("integration-build", { body: { action: "test", storeSlug, toolId: id } });
    setTestId(null);
    if (error) { toast.error("Couldn't run the test"); return; }
    const r = data as { ok?: boolean; skipped?: boolean; note?: string; preview?: string };
    if (r.skipped) { toast.info("Not tested", { description: r.note }); return; }
    if (r.ok) { toast.success("Works — the API answered", { description: r.preview ? `Got: ${r.preview}` : undefined }); return; }
    toast.error("The test call failed", { description: r.preview ?? "Check the URL, the API key, or whether this call needs a value." });
  }

  async function remove(id: string) {
    setDelId(id);
    const supabase = createClient();
    const { error } = await supabase.functions.invoke("integration-build", { body: { action: "delete", storeSlug, toolId: id } });
    setDelId(null);
    if (error) { toast.error("Couldn't remove that tool"); return; }
    router.refresh();
  }

  return (
    <div className="mt-8">
      <h2 className="text-base font-semibold">Connect a custom API</h2>
      <p className="text-muted-foreground mb-3 text-sm">
        Have an API of your own? Paste its OpenAPI (Swagger) link and say what Rani should be able to do — it builds the tools for you.
      </p>

      <div className="space-y-2 rounded-xl border p-4">
        <Input placeholder="https://api.yourservice.com/openapi.json" value={url} onChange={(e) => setUrl(e.target.value)} disabled={!isOwner || busy} />
        <Input placeholder="What should Rani do with it? e.g. look up order status, check stock" value={goal} onChange={(e) => setGoal(e.target.value)} disabled={!isOwner || busy} />
        <Input placeholder="API key (only if the API needs one) — stored encrypted" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={!isOwner || busy} />
        <Button onClick={build} disabled={!isOwner || busy} className="w-full">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
          Build tools from my API
        </Button>
      </div>

      {tools.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Your custom tools</p>
          {tools.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-lg border p-3">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold">{t.method}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-sm">{t.name}</span>
                  {t.side_effect && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">writes</span>}
                </div>
                <p className="text-muted-foreground truncate text-xs">{t.description}</p>
              </div>
              {!t.side_effect && (
                <Button variant="ghost" size="icon" disabled={!isOwner || testId === t.id} onClick={() => test(t.id)} aria-label="Test tool" title="Make a real test call">
                  {testId === t.id ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
                </Button>
              )}
              <Button variant="ghost" size="icon" disabled={!isOwner || delId === t.id} onClick={() => remove(t.id)} aria-label="Remove tool">
                {delId === t.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
