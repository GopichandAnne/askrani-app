"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { saveGiveGet, type GiveGetConfig } from "./actions";

const money = (s: string) => s.replace(/[^\d.]/g, "");

export function CampaignsClient({ initial }: { initial: GiveGetConfig }) {
  const [active, setActive] = useState(initial.active);
  const [recip, setRecip] = useState(String(initial.recipientAmountUsd));
  const [minOrder, setMinOrder] = useState(String(initial.recipientMinOrderUsd));
  const [initiator, setInitiator] = useState(String(initial.initiatorAmountUsd));
  const [budget, setBudget] = useState(initial.budgetCapUsd != null ? String(initial.budgetCapUsd) : "");
  const [pending, start] = useTransition();

  const recipN = Number(recip) || 0;
  const minN = Number(minOrder) || 0;
  const initN = Number(initiator) || 0;

  const save = () =>
    start(async () => {
      const r = await saveGiveGet({
        active,
        recipientAmountUsd: recipN,
        recipientMinOrderUsd: minN,
        initiatorAmountUsd: initN,
        budgetCapUsd: budget.trim() ? Number(budget) : null,
      });
      if (r.ok) toast.success(active ? "Share & Earn is live." : "Saved — offer is paused.");
      else toast.error(r.error);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>Share &amp; Earn</span>
          <span className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
            {active ? "Live" : "Paused"}
            <Switch checked={active} onCheckedChange={setActive} />
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Customers forward their card on WhatsApp. A friend orders through it — the friend gets a discount,
          your customer earns store credit they redeem in store. You only pay when it brings someone in.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Friend gets ($ off)" value={recip} onChange={(v) => setRecip(money(v))} prefix="$" />
          <Field label="On a first order of ($+)" value={minOrder} onChange={(v) => setMinOrder(money(v))} prefix="$" />
          <Field label="Customer earns ($ credit)" value={initiator} onChange={(v) => setInitiator(money(v))} prefix="$" />
          <Field label="Monthly budget cap ($)" value={budget} onChange={(v) => setBudget(money(v))} prefix="$" placeholder="uncapped" />
        </div>

        <div className="rounded-lg border bg-muted/30 p-4 text-sm">
          <span className="font-medium">Preview:</span> your customer shares → a friend gets{" "}
          <b>${recipN.toFixed(2)} off</b> a first order of <b>${minN.toFixed(2)}+</b> → your customer earns{" "}
          <b>${initN.toFixed(2)} credit</b> when the friend orders.
          {budget.trim() && <> Nothing pays out past <b>${(Number(budget) || 0).toFixed(2)}/month</b>.</>}
        </div>

        <Button onClick={save} disabled={pending} className="w-full">
          {pending ? "Saving…" : active ? "Save & make live" : "Save (paused)"}
        </Button>
      </CardContent>
    </Card>
  );
}

function Field({ label, value, onChange, prefix, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; prefix?: string; placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1">
        {prefix && <span className="text-muted-foreground">{prefix}</span>}
        <Input inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="tabular-nums" />
      </div>
    </div>
  );
}
