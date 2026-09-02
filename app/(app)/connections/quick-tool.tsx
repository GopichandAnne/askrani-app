"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Zap } from "lucide-react";
import { saveQuickTool } from "./actions";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/**
 * Quick-add a single endpoint as a tool — no OpenAPI spec needed. Mirrors the
 * Requests-view form pattern (server-action write + comma-separated fields).
 * The created tool lands in the tool list below with the usual Auto/Hold + delete.
 */
export function QuickTool({ isOwner }: { isOwner: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("");
  const [params, setParams] = useState("");
  const [auth, setAuth] = useState<"none" | "identity">("none");
  const [hold, setHold] = useState(false);
  const [busy, start] = useTransition();

  function reset() {
    setName(""); setDesc(""); setMethod("GET"); setUrl(""); setParams(""); setAuth("none"); setHold(false);
  }
  function save() {
    start(async () => {
      const res = await saveQuickTool({ name, description: desc, method, url, params, auth, hold });
      if (res.ok) {
        toast.success("Tool added");
        reset();
        setOpen(false);
        router.refresh();
      } else {
        toast.error("Couldn't add the tool", { description: res.error });
      }
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Zap className="text-teal-deep size-4" />
          <h2 className="text-lg font-semibold">Quick add — one endpoint</h2>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)} disabled={!isOwner}>
          {open ? "Close" : "Add an endpoint"}
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">
        Have a single API call and no OpenAPI spec? Describe it here and Rani builds the tool. For a full
        API, use <span className="font-medium">Connect a custom API</span> below.
      </p>

      {open && (
        <div className="bg-card space-y-3 rounded-lg border p-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Tool name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="check_order_status" disabled={!isOwner} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">
              When should Rani call it? (this becomes the tool&apos;s description)
            </label>
            <Input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Look up an order's status when a customer asks where their order is."
              disabled={!isOwner}
            />
          </div>
          <div className="flex gap-2">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              disabled={!isOwner}
              className="border-input bg-background h-9 w-28 shrink-0 rounded-md border px-2 text-sm"
              aria-label="HTTP method"
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com/orders/{id}"
              className="min-w-0 flex-1"
              disabled={!isOwner}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">
              Inputs Rani provides — comma separated, add * for required
            </label>
            <Input
              value={params}
              onChange={(e) => setParams(e.target.value)}
              placeholder="id*, status"
              disabled={!isOwner}
            />
            <p className="text-muted-foreground mt-1 text-xs">
              A <code className="font-mono">{"{id}"}</code> in the URL is filled from the path; others go in the query (GET) or body (writes).
            </p>
          </div>
          <div className="space-y-2 rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="qt-auth" className="accent-teal size-4" checked={auth === "none"} onChange={() => setAuth("none")} disabled={!isOwner} />
              Public endpoint (no sign-in)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="qt-auth" className="accent-teal size-4" checked={auth === "identity"} onChange={() => setAuth("identity")} disabled={!isOwner} />
              Act as the signed-in customer <span className="text-muted-foreground text-xs">(forwards their verified identity — needs embedded sign-in on)</span>
            </label>
            <p className="text-muted-foreground text-xs">
              Needs an API key? Use <span className="font-medium">Connect a custom API</span> below instead — keys are encrypted there.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-amber-500 size-4" checked={hold} onChange={(e) => setHold(e.target.checked)} disabled={!isOwner} />
            Hold for a person&apos;s approval (for high-impact actions)
          </label>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy || !isOwner || !name.trim() || !desc.trim() || !url.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Add tool
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { reset(); setOpen(false); }}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}
