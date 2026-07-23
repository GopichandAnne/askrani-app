"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { savePostEarn, uploadShareMedia, type PostEarnConfig, type PlatformRule, type ShareMediaItem } from "./actions";
import { PLATFORM_FORMATS } from "./post-earn-shared";

const money = (s: string) => s.replace(/[^\d.]/g, "");
const digits = (s: string) => s.replace(/\D/g, "");
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// A quick hint for the platform-specific formats.
const FORMAT_HINT: Record<string, string> = {
  reel: "short video — highest reach",
  post: "feed photo / carousel",
  story: "24h — verify with a live screenshot",
  video: "long-form — permanent & searchable",
  short: "vertical short video",
  photo: "photo post",
};

type BandDraft = { minReach: string; maxReach: string; usd: string };
type Draft = {
  platform: string;
  enabled: boolean;
  model: "flat" | "tier" | "format";
  flat: string;
  base: string;
  bands: BandDraft[];
  formatUsd: Record<string, string>;
};

const toDraft = (p: PlatformRule): Draft => ({
  platform: p.platform,
  enabled: p.enabled,
  model: p.model,
  flat: p.flatUsd ? String(p.flatUsd) : "",
  base: p.baseUsd ? String(p.baseUsd) : "",
  bands: (p.bands.length ? p.bands : [{ minReach: 0, maxReach: 5000, usd: 10 }, { minReach: 5000, maxReach: 0, usd: 25 }])
    .map((b) => ({ minReach: b.minReach ? String(b.minReach) : "", maxReach: b.maxReach ? String(b.maxReach) : "", usd: b.usd ? String(b.usd) : "" })),
  formatUsd: Object.fromEntries(
    (PLATFORM_FORMATS[p.platform] ?? Object.keys(p.formatUsd)).map((k) => [k, p.formatUsd[k] ? String(p.formatUsd[k]) : ""]),
  ),
});

const fromDraft = (d: Draft): PlatformRule => ({
  platform: d.platform,
  enabled: d.enabled,
  model: d.model,
  flatUsd: Number(d.flat) || 0,
  baseUsd: Number(d.base) || 0,
  bands: d.bands.map((b) => ({ minReach: Number(b.minReach) || 0, maxReach: Number(b.maxReach) || 0, usd: Number(b.usd) || 0 })),
  formatUsd: Object.fromEntries(Object.entries(d.formatUsd).map(([k, v]) => [k, Number(v) || 0])),
});

export function PostEarnClient({ initial }: { initial: PostEarnConfig }) {
  const [active, setActive] = useState(initial.active);
  const [drafts, setDrafts] = useState<Draft[]>(initial.platforms.map(toDraft));
  const [promo, setPromo] = useState(initial.promoContext);
  const [media, setMedia] = useState<ShareMediaItem[]>(initial.shareMedia);
  const [budget, setBudget] = useState(initial.budgetUsd != null ? String(initial.budgetUsd) : "");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();

  const patch = (i: number, p: Partial<Draft>) => setDrafts((ds) => ds.map((d, idx) => (idx === i ? { ...d, ...p } : d)));
  const patchBand = (i: number, bi: number, p: Partial<BandDraft>) =>
    setDrafts((ds) => ds.map((d, idx) => (idx === i ? { ...d, bands: d.bands.map((b, j) => (j === bi ? { ...b, ...p } : b)) } : d)));

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const r = await uploadShareMedia(fd);
    setUploading(false);
    if (r.ok) setMedia((m) => [...m, { url: r.url, label: null }]);
    else toast.error(r.error);
  };

  const save = () =>
    start(async () => {
      const r = await savePostEarn({
        active,
        platforms: drafts.map(fromDraft),
        promoContext: promo,
        shareMedia: media,
        budgetUsd: budget.trim() ? Number(budget) : null,
      });
      if (r.ok) toast.success(active ? "Post & Earn is live." : "Saved — offer is paused.");
      else toast.error(r.error);
    });

  const pill = (on: boolean) =>
    `rounded-full border px-3 py-1 text-xs ${on ? "bg-teal border-teal text-white" : "text-muted-foreground"}`;

  const enabledCount = drafts.filter((d) => d.enabled).length;

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
          Set up each platform separately — a YouTube video can pay differently from an Instagram story.
          Verification is manual; you confirm each post before it pays.
        </p>

        <div className="space-y-1.5">
          <Label className="text-muted-foreground text-xs" htmlFor="promo">What should they post about? (optional)</Label>
          <textarea
            id="promo"
            value={promo}
            onChange={(e) => setPromo(e.target.value.slice(0, 500))}
            rows={2}
            placeholder="e.g. Our weekend biryani special, or the new mango season arrivals"
            className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1"
          />
          <p className="text-muted-foreground text-xs">Rani tells customers what to feature, and it shows in Post reviews so you can check the post is on-topic.</p>
        </div>

        <div className="space-y-3">
          <Label className="text-muted-foreground text-xs">Platforms {enabledCount > 0 ? `(${enabledCount} on)` : ""}</Label>
          {drafts.map((d, i) => {
            const formatKeys = Object.keys(d.formatUsd);
            return (
              <div key={d.platform} className="rounded-lg border">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="font-medium">{cap(d.platform)}</span>
                  <Switch checked={d.enabled} onCheckedChange={(v) => patch(i, { enabled: v })} />
                </div>

                {d.enabled && (
                  <div className="space-y-4 border-t px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => patch(i, { model: "flat" })} className={pill(d.model === "flat")}>Flat per post</button>
                      <button type="button" onClick={() => patch(i, { model: "format" })} className={pill(d.model === "format")}>By format</button>
                      <button type="button" onClick={() => patch(i, { model: "tier" })} className={pill(d.model === "tier")}>By reach</button>
                    </div>

                    {d.model === "flat" && (
                      <div className="max-w-[180px] space-y-1.5">
                        <Label className="text-muted-foreground text-xs">Credit per post ($)</Label>
                        <Input inputMode="decimal" value={d.flat} onChange={(e) => patch(i, { flat: money(e.target.value) })} className="tabular-nums" />
                      </div>
                    )}

                    {d.model !== "flat" && (
                      <div className="max-w-[260px] space-y-1.5">
                        <Label className="text-muted-foreground text-xs">Guaranteed base per post ($) — optional</Label>
                        <Input inputMode="decimal" value={d.base} onChange={(e) => patch(i, { base: money(e.target.value) })} placeholder="0" className="w-[120px] tabular-nums" />
                        <p className="text-muted-foreground text-xs">
                          Paid on every approved post, on top of the {d.model === "format" ? "format" : "reach"} bonus. Leave 0 to pay {d.model === "format" ? "by format" : "by reach"} only.
                        </p>
                      </div>
                    )}

                    {d.model === "format" && (
                      <div className="space-y-2">
                        <Label className="text-muted-foreground text-xs">Credit by format ($)</Label>
                        {formatKeys.map((k) => (
                          <div key={k} className="flex items-center gap-3">
                            <span className="w-14 text-sm font-medium capitalize">{k}</span>
                            <span className="text-muted-foreground text-xs">$</span>
                            <Input
                              inputMode="decimal"
                              value={d.formatUsd[k]}
                              onChange={(e) => patch(i, { formatUsd: { ...d.formatUsd, [k]: money(e.target.value) } })}
                              placeholder="0"
                              className="w-20 tabular-nums"
                            />
                            <span className="text-muted-foreground text-xs">{FORMAT_HINT[k] ?? ""}</span>
                          </div>
                        ))}
                        <p className="text-muted-foreground text-xs">Leave a format at 0 to not pay for it. You pick the format when you approve each post.</p>
                      </div>
                    )}

                    {d.model === "tier" && (
                      <div className="space-y-2">
                        <Label className="text-muted-foreground text-xs">Reach bands (views → credit)</Label>
                        {d.bands.map((b, bi) => (
                          <div key={bi} className="flex items-center gap-2">
                            <Input inputMode="numeric" value={b.minReach} onChange={(e) => patchBand(i, bi, { minReach: digits(e.target.value) })} placeholder="min" className="w-24 tabular-nums" />
                            <span className="text-muted-foreground text-xs">to</span>
                            <Input inputMode="numeric" value={b.maxReach} onChange={(e) => patchBand(i, bi, { maxReach: digits(e.target.value) })} placeholder="max (∞)" className="w-24 tabular-nums" />
                            <span className="text-muted-foreground text-xs">→ $</span>
                            <Input inputMode="decimal" value={b.usd} onChange={(e) => patchBand(i, bi, { usd: money(e.target.value) })} placeholder="0" className="w-20 tabular-nums" />
                            <button type="button" onClick={() => patch(i, { bands: d.bands.filter((_, j) => j !== bi) })} className="text-muted-foreground hover:text-destructive text-xs">✕</button>
                          </div>
                        ))}
                        <Button variant="outline" size="sm" onClick={() => patch(i, { bands: [...d.bands, { minReach: "", maxReach: "", usd: "" }] })}>+ Add band</Button>
                        <p className="text-muted-foreground text-xs">Leave a band&apos;s max blank for &ldquo;and up&rdquo;. You enter each post&apos;s reach when you approve it.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <Label className="text-muted-foreground text-xs">Ready-to-post media (optional)</Label>
          <p className="text-muted-foreground text-xs">
            Upload branded images customers can share. Rani sends them when someone asks to post — so they have
            content ready and your store gets tagged.
          </p>
          {media.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {media.map((m, i) => (
                <div key={m.url} className="group relative size-20 overflow-hidden rounded-md border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt="" className="size-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setMedia((ms) => ms.filter((_, idx) => idx !== i))}
                    className="absolute right-0.5 top-0.5 rounded-full bg-black/60 px-1.5 text-xs text-white opacity-0 group-hover:opacity-100"
                    aria-label="Remove image"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} className="hidden" />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? "Uploading…" : "+ Add image"}
          </Button>
        </div>

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
