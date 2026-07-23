"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  confirmByPhone,
  confirmPass,
  lookupByCode,
  lookupByPhone,
  saveRedemptionRules,
  type PassMatch,
  type PhoneMatch,
  type RedemptionRules,
} from "./actions";

const usd = (n: number) => `$${n.toFixed(2)}`;
const money = (s: string) => s.replace(/[^\d.]/g, "");

export function RedemptionsClient({ rules, isOwner }: { rules: RedemptionRules; isOwner: boolean }) {
  const hasGuardrails = rules.minBillUsd > 0 || rules.maxRedeemUsd > 0 || rules.exclusionNote.trim().length > 0;
  return (
    <div className="max-w-xl space-y-5">
      {hasGuardrails && (
        <div className="bg-secondary/60 text-secondary-foreground rounded-lg border p-3 text-sm">
          <p className="mb-1 font-medium">Redemption rules</p>
          <ul className="text-muted-foreground space-y-0.5 text-xs">
            {rules.minBillUsd > 0 && <li>• Minimum purchase: {usd(rules.minBillUsd)}</li>}
            {rules.maxRedeemUsd > 0 && <li>• Max credit per visit: {usd(rules.maxRedeemUsd)}</li>}
            {rules.exclusionNote.trim() && <li>• {rules.exclusionNote}</li>}
          </ul>
        </div>
      )}
      <Tabs defaultValue="code">
        <TabsList className="mb-4">
          <TabsTrigger value="code">Enter code</TabsTrigger>
          <TabsTrigger value="phone">By phone</TabsTrigger>
        </TabsList>
        <TabsContent value="code"><CodePanel minBillUsd={rules.minBillUsd} /></TabsContent>
        <TabsContent value="phone"><PhonePanel /></TabsContent>
      </Tabs>
      {isOwner && <RulesConfig initial={rules} />}
    </div>
  );
}

function CodePanel({ minBillUsd }: { minBillUsd: number }) {
  const [code, setCode] = useState("");
  const [match, setMatch] = useState<PassMatch | null>(null);
  const [bill, setBill] = useState("");
  const [pending, start] = useTransition();

  const look = () =>
    start(async () => {
      setMatch(null);
      const r = await lookupByCode(code);
      if (r.ok) setMatch(r.data);
      else toast.error(r.error);
    });

  const confirm = () =>
    start(async () => {
      if (!match) return;
      const billNum = bill.trim() ? Number(bill) : undefined;
      const r = await confirmPass(match.passId, billNum);
      if (r.ok) {
        toast.success(`Redeemed ${usd(r.redeemedUsd)}. ${r.remainingUsd > 0 ? `${usd(r.remainingUsd)} left on their account.` : "Balance now $0."}`);
        setMatch(null); setCode(""); setBill("");
      } else {
        toast.error(r.error);
        setMatch(null);
      }
    });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Confirm a redemption code</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="code">4-digit code</Label>
          <div className="flex gap-2">
            <Input
              id="code" inputMode="numeric" placeholder="1234" value={code} maxLength={4}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              onKeyDown={(e) => e.key === "Enter" && look()}
              className="w-32 text-lg tracking-widest tabular-nums"
            />
            <Button variant="secondary" onClick={look} disabled={pending || code.length !== 4}>Look up</Button>
          </div>
        </div>

        {match && (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="font-medium">{match.name ?? "Customer"}</span>
              <span className="text-2xl font-semibold tabular-nums">{usd(match.amountUsd)}</span>
            </div>
            <p className="text-sm text-muted-foreground">Balance on account: {usd(match.balanceUsd)}</p>
            <div className="space-y-2">
              <Label htmlFor="bill" className="text-xs text-muted-foreground">
                {minBillUsd > 0
                  ? `Bill total (minimum ${usd(minBillUsd)} to redeem)`
                  : "Bill smaller than the credit? Enter it to redeem only that (optional)"}
              </Label>
              <Input
                id="bill" inputMode="decimal" placeholder={match.amountUsd.toFixed(2)} value={bill}
                onChange={(e) => setBill(e.target.value.replace(/[^\d.]/g, ""))}
                className="w-32 tabular-nums"
              />
              {minBillUsd > 0 && bill.trim() && Number(bill) < minBillUsd && (
                <p className="text-destructive text-xs">Below the {usd(minBillUsd)} minimum.</p>
              )}
            </div>
            <Button
              onClick={confirm}
              disabled={pending || (minBillUsd > 0 && (!bill.trim() || Number(bill) < minBillUsd))}
              className="w-full"
            >
              Confirm &amp; apply {usd(bill.trim() ? Math.min(Number(bill) || 0, match.amountUsd) : match.amountUsd)} discount
            </Button>
            <p className="text-xs text-muted-foreground">Apply this as a discount on your register. Rani never charges the customer.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PhonePanel() {
  const [last4, setLast4] = useState("");
  const [matches, setMatches] = useState<PhoneMatch[] | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const look = () =>
    start(async () => {
      setMatches(null);
      const r = await lookupByPhone(last4);
      if (r.ok) setMatches(r.data);
      else toast.error(r.error);
    });

  const confirm = (m: PhoneMatch) =>
    start(async () => {
      const amt = Number(amounts[m.memberId] ?? m.balanceUsd);
      const r = await confirmByPhone(m.memberId, amt);
      if (r.ok) {
        toast.success(`Redeemed ${usd(r.redeemedUsd)} for ${m.name ?? "customer"}. ${r.remainingUsd > 0 ? `${usd(r.remainingUsd)} left.` : "Balance now $0."}`);
        setMatches(null); setLast4(""); setAmounts({});
      } else {
        toast.error(r.error);
      }
    });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Look up by phone</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Use when the customer has no code. Verify who they are before confirming.</p>
        <div className="space-y-2">
          <Label htmlFor="last4">Last 4 digits</Label>
          <div className="flex gap-2">
            <Input
              id="last4" inputMode="numeric" placeholder="4411" value={last4} maxLength={4}
              onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
              onKeyDown={(e) => e.key === "Enter" && look()}
              className="w-32 text-lg tracking-widest tabular-nums"
            />
            <Button variant="secondary" onClick={look} disabled={pending || last4.length !== 4}>Look up</Button>
          </div>
        </div>

        {matches?.map((m) => (
          <div key={m.memberId} className="rounded-lg border p-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="font-medium">{m.name ?? "Customer"} <span className="text-muted-foreground text-sm">{m.phoneMasked}</span></span>
              <span className="text-lg font-semibold tabular-nums">{usd(m.balanceUsd)} credit</span>
            </div>
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor={`amt-${m.memberId}`} className="text-xs text-muted-foreground">Amount to redeem</Label>
                <Input
                  id={`amt-${m.memberId}`} inputMode="decimal" placeholder={m.balanceUsd.toFixed(2)}
                  value={amounts[m.memberId] ?? ""}
                  onChange={(e) => setAmounts((a) => ({ ...a, [m.memberId]: e.target.value.replace(/[^\d.]/g, "") }))}
                  className="w-28 tabular-nums"
                />
              </div>
              <Button onClick={() => confirm(m)} disabled={pending}>Confirm</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function RulesConfig({ initial }: { initial: RedemptionRules }) {
  const [minBill, setMinBill] = useState(initial.minBillUsd ? String(initial.minBillUsd) : "");
  const [maxRedeem, setMaxRedeem] = useState(initial.maxRedeemUsd ? String(initial.maxRedeemUsd) : "");
  const [note, setNote] = useState(initial.exclusionNote);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const r = await saveRedemptionRules({
        minBillUsd: Number(minBill) || 0,
        maxRedeemUsd: Number(maxRedeem) || 0,
        exclusionNote: note,
      });
      if (r.ok) toast.success("Redemption rules saved.");
      else toast.error(r.error);
    });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Redemption rules (owner)</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Guardrails for cost control. Leave a field blank for no limit.
        </p>
        <div className="flex flex-wrap gap-4">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">Minimum purchase ($)</Label>
            <Input inputMode="decimal" value={minBill} onChange={(e) => setMinBill(money(e.target.value))} placeholder="none" className="w-32 tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground text-xs">Max credit per visit ($)</Label>
            <Input inputMode="decimal" value={maxRedeem} onChange={(e) => setMaxRedeem(money(e.target.value))} placeholder="no cap" className="w-32 tabular-nums" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-muted-foreground text-xs">Exclusion note (shown to staff)</Label>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 200))}
            placeholder="e.g. Credit not valid on alcohol, tobacco or gift cards"
          />
          <p className="text-muted-foreground text-xs">
            We can&apos;t block items automatically without your register data — this reminds staff to enter only the eligible subtotal.
          </p>
        </div>
        <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save rules"}</Button>
      </CardContent>
    </Card>
  );
}
