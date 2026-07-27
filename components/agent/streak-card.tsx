"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Flame, Loader2 } from "lucide-react";
import { saveAgentConfig } from "@/app/(app)/agent/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** Owner config for the share-streak bonus. Rewards a regular who earns N times
 *  in a month with a one-off bonus, capped by a monthly budget (money safety). */
export function StreakCard({
  initialGoal,
  initialBonusCents,
  initialCapCents,
}: {
  initialGoal: string;
  initialBonusCents: string;
  initialCapCents: string;
}) {
  const startGoal = Number(initialGoal) || 0;
  const startBonus = Number(initialBonusCents) || 0;
  const startCap = Number(initialCapCents) || 0;
  const [enabled, setEnabled] = useState(startGoal > 0 && startBonus > 0);
  const [goal, setGoal] = useState(startGoal > 0 ? String(startGoal) : "3");
  const [bonus, setBonus] = useState(startBonus > 0 ? (startBonus / 100).toFixed(2) : "5");
  const [cap, setCap] = useState(startCap > 0 ? (startCap / 100).toFixed(2) : "100");
  const [saving, setSaving] = useState(false);

  async function save() {
    const g = enabled ? Math.max(1, Math.floor(Number(goal) || 0)) : 0;
    const b = enabled ? Math.round((Number(bonus) || 0) * 100) : 0;
    const c = Math.round((Number(cap) || 0) * 100);
    if (enabled && (g < 1 || b < 1)) {
      toast.error("Set a goal and a bonus amount, or turn the bonus off.");
      return;
    }
    setSaving(true);
    const res = await saveAgentConfig({
      streak_goal: String(g),
      streak_bonus_cents: String(b),
      streak_cap_cents: String(c),
    });
    setSaving(false);
    if (res.ok) toast.success(enabled ? "Streak bonus saved" : "Streak bonus turned off");
    else toast.error("Couldn't save", { description: res.error });
  }

  return (
    <div className="bg-card space-y-4 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label className="flex items-center gap-1.5 text-sm font-medium">
            <Flame className="text-teal-deep size-4" /> Share streak bonus
          </Label>
          <p className="text-muted-foreground text-sm">
            Reward your regulars: a guest who earns credit a few times in a month gets a one-off bonus.
            Counts only <b>confirmed</b> earns (a referred friend actually orders, or a post is approved),
            and never spends past your monthly cap.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      {enabled && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-muted-foreground text-xs">Earns per month to unlock</Label>
            <Input type="number" min={1} step={1} value={goal} onChange={(e) => setGoal(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground text-xs">Bonus ($)</Label>
            <Input type="number" min={0} step="0.5" value={bonus} onChange={(e) => setBonus(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground text-xs">Monthly cap ($)</Label>
            <Input type="number" min={0} step={5} value={cap} onChange={(e) => setCap(e.target.value)} className="h-9" />
          </div>
        </div>
      )}

      {enabled && (
        <p className="text-muted-foreground text-xs">
          Example: {Math.max(1, Math.floor(Number(goal) || 0))} earns in a month → a ${(Number(bonus) || 0).toFixed(2)} bonus,
          up to ${(Number(cap) || 0).toFixed(2)} of bonuses across all guests that month.
        </p>
      )}

      <Button size="sm" onClick={save} disabled={saving}>
        {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save
      </Button>
    </div>
  );
}
