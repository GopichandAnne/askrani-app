"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { savePostEarn, type PostEarnConfig, type ReachBand } from "./actions";

const PLATFORMS = ["any", "instagram", "youtube", "facebook"];
const money = (s: string) => s.replace(/[^\d.]/g, "");
const digits = (s: string) => s.replace(/\D/g, "");

export function PostEarnClient({ initial }: { initial: PostEarnConfig }) {
  const [active, setActive] = useState(initial.active);
  const [platform, setPlatform] = useState(initial.platform);
  const [model, setModel] = useState<"flat" | "tier">(initial.model);
  const [flat, setFlat] = useState(initial.flatUsd ? String(initial.flatUsd) : "");
  const [bands, setBands] = useState<ReachBand[]>(
    initial.bands.length ? initial.bands : [{ minReach: 0, maxReach: 5000, usd: 10 }, { minReach: 5000, maxReach: 0, usd: 25 }],
  );
  const [budget, setBudget] = useState(initial.budgetUsd != null ? String(initial.budgetUsd) : "");
  const [pending, start] = useTransition();

  const setBand = (i: number, patch: Partial<ReachBand>) =>
    setBands((bs) => bs.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));

  const save = () =>
    start(async () => {
      const r = await savePostEarn({
        active, platform, model,
        flatUsd: Number(flat) || 0,
        bands,
        budgetUsd: budget.trim() ? Number(budget) : null,
      });
      if (r.ok) toast.success(active ? "Post & Earn is live." : "Saved — offer is paused.");
      else toast.error(r.error);
    });

  const pill = (on: boolean) =>
    `rounded-full border px-3 py-1 text-xs ${on ? "bg-teal border-teal text-white" : "text-muted-foreground"}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>Post &amp; Earn</span>
          <span className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
            {active ? "Live" : "Paused"}
            <Switch checked={active} onCheckedChange={setActive} />
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Customers post about you on social media, paste the link to Rani, and you review it in Post reviews.
          Approved posts earn store credit. Verification is manual — you confirm each post (and its reach) before it pays.
        </p>

        <div className="space-y-2">
          <Label className="text-muted-foreground text-xs">Platform</Label>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button key={p} type="button" onClick={() => setPlatform(p)} className={`${pill(platform === p)} capitalize`}>{p}</button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-muted-foreground text-xs">How much they earn</Label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setModel("flat")} className={pill(model === "flat")}>Flat per post</button>
            <button type="button" onClick={() => setModel("tier")} className={pill(model === "tier")}>By reach</button>
          </div>
        </div>

        {model === "flat" ? (
          <div className="max-w-[180px] space-y-1.5">
            <Label className="text-muted-foreground text-xs">Credit per post ($)</Label>
            <Input inputMode="decimal" value={flat} onChange={(e) => setFlat(money(e.target.value))} className="tabular-nums" />
          </div>
        ) : (
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">Reach bands (views → credit)</Label>
            {bands.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input inputMode="numeric" value={b.minReach ? String(b.minReach) : ""} onChange={(e) => setBand(i, { minReach: Number(digits(e.target.value)) || 0 })} placeholder="min" className="w-24 tabular-nums" />
                <span className="text-muted-foreground text-xs">to</span>
                <Input inputMode="numeric" value={b.maxReach ? String(b.maxReach) : ""} onChange={(e) => setBand(i, { maxReach: Number(digits(e.target.value)) || 0 })} placeholder="max (∞)" className="w-24 tabular-nums" />
                <span className="text-muted-foreground text-xs">→ $</span>
                <Input inputMode="decimal" value={b.usd ? String(b.usd) : ""} onChange={(e) => setBand(i, { usd: Number(money(e.target.value)) || 0 })} placeholder="0" className="w-20 tabular-nums" />
                <button type="button" onClick={() => setBands((bs) => bs.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive text-xs">✕</button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setBands((bs) => [...bs, { minReach: 0, maxReach: 0, usd: 0 }])}>+ Add band</Button>
            <p className="text-muted-foreground text-xs">Leave a band&apos;s max blank for &ldquo;and up&rdquo;. You enter each post&apos;s actual reach when you approve it.</p>
          </div>
        )}

        <div className="max-w-[180px] space-y-1.5">
          <Label className="text-muted-foreground text-xs">Monthly budget cap ($)</Label>
          <Input inputMode="decimal" value={budget} onChange={(e) => setBudget(money(e.target.value))} placeholder="uncapped" className="tabular-nums" />
        </div>

        <Button onClick={save} disabled={pending} className="w-full">
          {pending ? "Saving…" : active ? "Save & make live" : "Save (paused)"}
        </Button>
      </CardContent>
    </Card>
  );
}
