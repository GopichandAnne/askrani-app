"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveIntegration } from "@/app/(app)/integrations/actions";
import {
  type Integration,
  type IntegrationParam,
  type ParamType,
  paramsToSchema,
  schemaToParams,
} from "@/lib/integrations/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2 } from "lucide-react";

export function IntegrationDialog({
  trigger,
  initial,
  onSaved,
}: {
  trigger: React.ReactNode;
  initial?: Integration | null;
  onSaved: () => void;
}) {
  const editing = !!initial;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [secret, setSecret] = useState("");
  const [sideEffect, setSideEffect] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [timeout, setTimeoutMs] = useState(4000);
  const [params, setParams] = useState<IntegrationParam[]>([]);
  const [pending, start] = useTransition();

  function reset() {
    setName(initial?.name ?? "");
    setDescription(initial?.description ?? "");
    setEndpoint(initial?.endpoint_url ?? "");
    setSecret("");
    setSideEffect(initial?.side_effect ?? false);
    setEnabled(initial?.enabled ?? true);
    setTimeoutMs(initial?.timeout_ms ?? 4000);
    setParams(schemaToParams(initial?.params_schema));
  }

  function onOpenChange(o: boolean) {
    if (o) reset();
    setOpen(o);
  }

  function setParam(i: number, patch: Partial<IntegrationParam>) {
    setParams((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  function save() {
    start(async () => {
      const res = await saveIntegration({
        name,
        description,
        endpoint_url: endpoint,
        params_schema: paramsToSchema(params),
        auth_secret: secret || undefined,
        side_effect: sideEffect,
        enabled,
        timeout_ms: timeout,
      });
      if (res.ok) {
        toast.success(editing ? "Integration updated" : "Integration added");
        onSaved();
        setOpen(false);
      } else {
        toast.error("Couldn't save", { description: res.error });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit integration" : "Add integration"}</DialogTitle>
          <DialogDescription>
            A tool Rani can call on its own. Rani decides <em>when</em> to use it from the
            description below — write it like you&apos;re telling a new employee when to reach for it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="int-name">Tool name</Label>
            <Input
              id="int-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={editing}
              placeholder="pos_price_lookup"
              className="font-mono"
            />
            <p className="text-muted-foreground text-xs">
              Lowercase letters, numbers, underscores. Can&apos;t change after creating.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="int-desc">When should Rani use it?</Label>
            <Textarea
              id="int-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Look up the live price and stock for a product by barcode, SKU, or name from our POS. Use it whenever a customer asks the price or availability of a specific item."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="int-url">Endpoint URL</Label>
            <Input
              id="int-url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://your-service.example.com/rani"
            />
            <p className="text-muted-foreground text-xs">
              Rani POSTs the tool call here and reads back the JSON. Requests are signed with the
              shared secret (header <code>X-Rani-Signature</code>).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="int-secret">Shared secret {editing && <span className="text-muted-foreground">(leave blank to keep)</span>}</Label>
            <Input
              id="int-secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={editing && initial?.has_secret ? "•••••••• (unchanged)" : "used to sign requests so your service can trust Rani"}
            />
          </div>

          {/* Parameters — the args Rani fills in when it calls the tool. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Parameters</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setParams((p) => [...p, { name: "", type: "string", description: "", required: false }])
                }
              >
                <Plus className="size-4" /> Add
              </Button>
            </div>
            {params.length === 0 && (
              <p className="text-muted-foreground text-xs">No parameters — Rani calls it with no arguments.</p>
            )}
            {params.map((p, i) => (
              <div key={i} className="bg-muted/40 space-y-2 rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={p.name}
                    onChange={(e) => setParam(i, { name: e.target.value })}
                    placeholder="barcode"
                    className="font-mono"
                  />
                  <Select value={p.type} onValueChange={(v) => setParam(i, { type: v as ParamType })}>
                    <SelectTrigger className="w-32 shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="string">string</SelectItem>
                      <SelectItem value="number">number</SelectItem>
                      <SelectItem value="integer">integer</SelectItem>
                      <SelectItem value="boolean">boolean</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive size-8 shrink-0"
                    onClick={() => setParams((prev) => prev.filter((_, idx) => idx !== i))}
                    aria-label="Remove parameter"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <Input
                  value={p.description}
                  onChange={(e) => setParam(i, { description: e.target.value })}
                  placeholder="what this value is (helps Rani fill it correctly)"
                />
                <label className="text-muted-foreground flex items-center gap-2 text-xs">
                  <Switch checked={p.required} onCheckedChange={(v) => setParam(i, { required: v })} />
                  Required
                </label>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="int-side">Performs an action</Label>
              <p className="text-muted-foreground text-xs">
                On = writes/charges. Rani only calls it after the customer clearly confirms.
              </p>
            </div>
            <Switch id="int-side" checked={sideEffect} onCheckedChange={setSideEffect} />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="int-enabled">Enabled</Label>
              <p className="text-muted-foreground text-xs">Off = Rani won&apos;t see or call it.</p>
            </div>
            <Switch id="int-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={save} disabled={pending || !name.trim() || !description.trim() || !endpoint.trim()}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {editing ? "Save changes" : "Add integration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
