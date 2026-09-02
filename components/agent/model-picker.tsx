"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveModelChoice } from "@/app/(app)/agent/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles } from "lucide-react";

// Provider → the models we offer. Gemini keeps an empty value (the adapter default).
const MODELS: Record<string, { value: string; label: string }[]> = {
  gemini: [
    { value: "", label: "Gemini Flash — fast (default)" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro — most capable" },
  ],
  anthropic: [
    { value: "claude-sonnet-5", label: "Claude Sonnet 5 — balanced" },
    { value: "claude-opus-5", label: "Claude Opus 5 — most capable" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 — fastest" },
  ],
  openai: [
    { value: "gpt-4o-mini", label: "GPT-4o mini — fast & low cost" },
    { value: "gpt-4o", label: "GPT-4o — most capable" },
  ],
};
const PROVIDERS = [
  { value: "gemini", label: "Gemini (default)" },
  { value: "anthropic", label: "Anthropic — Claude" },
  { value: "openai", label: "OpenAI — GPT" },
];

export function ModelPicker({ initialProvider, initialModel }: { initialProvider: string; initialModel: string }) {
  const [provider, setProvider] = useState(initialProvider || "gemini");
  const [model, setModel] = useState(initialModel || "");
  const [saving, start] = useTransition();
  const models = MODELS[provider] ?? MODELS.gemini;

  function onProvider(p: string) {
    setProvider(p);
    setModel(MODELS[p]?.[0]?.value ?? ""); // default to the provider's first model
  }
  function save() {
    start(async () => {
      const res = await saveModelChoice(provider, model || null);
      if (res.ok) toast.success("Model updated");
      else toast.error("Couldn't update the model", { description: res.error });
    });
  }
  const dirty = provider !== (initialProvider || "gemini") || (model || "") !== (initialModel || "");

  return (
    <div className="bg-card space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="text-muted-foreground size-4" />
        <Label className="text-sm font-medium">Model</Label>
      </div>
      <p className="text-muted-foreground text-sm">
        Which AI answers your chat. Everything else — your tools, MCP, knowledge, and
        approvals — works the same whichever model you pick.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Provider</Label>
          <select
            value={provider}
            onChange={(e) => onProvider(e.target.value)}
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Model</Label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            {models.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={save} disabled={saving || !dirty} size="sm" variant="outline">
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Save model
        </Button>
      </div>
    </div>
  );
}
