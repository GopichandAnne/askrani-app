"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { saveAgentConfig, type Responder } from "@/app/(app)/agent/actions";
import { RespondersSection } from "./responders-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Bot, Loader2, Save } from "lucide-react";

type Section = { key: string; label: string; hint: string; ordersOnly?: boolean };

// Big prompt areas — each maps to an agent_config key (the bot's source of truth).
const SECTIONS: Section[] = [
  { key: "personality", label: "Personality & tone", hint: "Who Rani is and how she speaks — identity, warmth, style rules." },
  { key: "store_prompt", label: "Store info", hint: "Address, hours, what you sell, anything about the store." },
  { key: "language_handling", label: "Language handling", hint: "Which languages to mirror, regional product-name mappings, how to handle mixed languages." },
  { key: "engage_info", label: "Behavior & engagement", hint: "How Rani helps — navigation, escalation, feedback, interaction style, store layout." },
  { key: "off_topic_handling", label: "Off-topic handling", hint: "How to gracefully redirect non-shopping questions." },
  { key: "promotions", label: "Promotions & offers", hint: "What to promote and when — combos, specials, seasonal offers. Rani weaves these in naturally and sparingly, and can show a matching product or flyer image from your Knowledge Base. Leave blank for none." },
  { key: "order_prompt", label: "Ordering & checkout", hint: "How to take pre-orders: building the cart, confirmation, pickup, weight vs quantity, notes.", ordersOnly: true },
];

export function AgentView({
  initialConfig,
  initialResponders,
  storeName,
}: {
  initialConfig: Record<string, string>;
  initialResponders: Responder[];
  storeName: string;
}) {
  const [values, setValues] = useState<Record<string, string>>(initialConfig);
  const [saving, startSave] = useTransition();

  const dirty = useMemo(
    () => Object.keys(values).some((k) => (values[k] ?? "") !== (initialConfig[k] ?? "")),
    [values, initialConfig],
  );
  const ordersEnabled = (values.orders_enabled ?? "false") === "true";
  const catalogEnabled = (values.catalog_enabled ?? "false") === "true";

  function set(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function save() {
    startSave(async () => {
      const res = await saveAgentConfig(values);
      if (res.ok) toast.success("Agent settings saved");
      else toast.error("Couldn't save", { description: res.error });
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bot className="text-muted-foreground size-5" />
          <div>
            <h1 className="font-display text-2xl italic">Agent</h1>
            <p className="text-muted-foreground text-sm">{storeName}</p>
          </div>
        </div>
        <Button onClick={save} disabled={saving || !dirty} size="sm">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save changes
        </Button>
      </header>

      <p className="text-muted-foreground text-sm">
        This is Rani&apos;s setup for {storeName}. Everything here is the source of
        truth for how the bot behaves — no code changes needed. Core safety rules
        (never invent a price, always confirm before placing an order) are always
        enforced on top of what you write.
      </p>

      {/* Ordering toggle */}
      <div className="bg-card flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-0.5">
          <Label htmlFor="orders-toggle" className="text-sm font-medium">Enable ordering</Label>
          <p className="text-muted-foreground text-sm">
            When on, Rani can build a cart and take pre-orders. When off, she is an
            info, navigation, and Q&amp;A assistant only.
          </p>
        </div>
        <Switch
          id="orders-toggle"
          checked={ordersEnabled}
          onCheckedChange={(c) => set("orders_enabled", c ? "true" : "false")}
        />
      </div>

      {/* Catalogue / pricing mode */}
      <div className="bg-card flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-0.5">
          <Label htmlFor="catalog-toggle" className="text-sm font-medium">Structured catalogue (show prices)</Label>
          <p className="text-muted-foreground text-sm">
            On: Rani looks up products and shows prices. Off (request mode): the
            catalogue lives in your knowledge base, Rani never quotes a price, and
            every order is a request your team prices at confirmation.
          </p>
        </div>
        <Switch
          id="catalog-toggle"
          checked={catalogEnabled}
          onCheckedChange={(c) => set("catalog_enabled", c ? "true" : "false")}
        />
      </div>

      {/* Big prompt sections */}
      <div className="space-y-5">
        {SECTIONS.map((s) => {
          if (s.ordersOnly && !ordersEnabled) return null;
          return (
            <div key={s.key} className="space-y-1.5">
              <Label htmlFor={`sec-${s.key}`} className="text-sm font-medium">{s.label}</Label>
              <p className="text-muted-foreground text-xs">{s.hint}</p>
              <Textarea
                id={`sec-${s.key}`}
                value={values[s.key] ?? ""}
                onChange={(e) => set(s.key, e.target.value)}
                rows={10}
                className="font-mono text-sm"
                placeholder={`Write ${s.label.toLowerCase()} instructions…`}
              />
            </div>
          );
        })}
      </div>

      {/* Settings */}
      <div className="space-y-3">
        <h2 className="text-muted-foreground text-sm font-medium">Settings</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {ordersEnabled && (
            <div className="space-y-1.5">
              <Label htmlFor="tax_rate">Tax rate</Label>
              <Input
                id="tax_rate"
                value={values.tax_rate ?? ""}
                onChange={(e) => set("tax_rate", e.target.value)}
                placeholder="0.0825"
                inputMode="decimal"
              />
              <p className="text-muted-foreground text-xs">Decimal fraction, e.g. 0.0825 for 8.25 percent.</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="history_turns">History turns</Label>
            <Input
              id="history_turns"
              value={values.history_turns ?? ""}
              onChange={(e) => set("history_turns", e.target.value)}
              placeholder="10"
              inputMode="numeric"
            />
            <p className="text-muted-foreground text-xs">How many prior turns Rani remembers in a chat.</p>
          </div>
        </div>
      </div>

      <RespondersSection initial={initialResponders} />
    </div>
  );
}
