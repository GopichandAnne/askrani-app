"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import { getProofs, runProofCheck, type ProofRow } from "@/app/(app)/link/proof-actions";

type Grouped = { question: string; before?: ProofRow; after?: ProofRow };

/** rows arrive newest-first; keep the newest before + newest after per question. */
function group(rows: ProofRow[]): Grouped[] {
  const map = new Map<string, Grouped>();
  for (const r of rows) {
    const g = map.get(r.question) ?? { question: r.question };
    if (r.phase === "before" && !g.before) g.before = r;
    if (r.phase === "after" && !g.after) g.after = r;
    map.set(r.question, g);
  }
  return [...map.values()];
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={on ? { color: "#0d9488", background: "#eafaf6" } : { color: "#8a8f98", background: "#f1efec" }}
    >
      {on ? "✓" : "—"} {label}
    </span>
  );
}

function Side({ title, row }: { title: string; row?: ProofRow }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="text-muted-foreground mb-1 text-[11px] font-medium uppercase tracking-wide">{title}</div>
      {row ? (
        <>
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            <Flag on={row.answered} label="answered" />
            <Flag on={row.cited} label="cited you" />
          </div>
          {row.answer_text && <p className="text-muted-foreground line-clamp-3 text-xs">{row.answer_text}</p>}
        </>
      ) : (
        <p className="text-muted-foreground text-xs italic">not checked yet</p>
      )}
    </div>
  );
}

export function ProofPanel({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<ProofRow[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "before" | "after">(null);

  useEffect(() => {
    let alive = true;
    getProofs(storeId).then((res) => {
      if (!alive) return;
      if (res.ok) {
        setRows(res.rows);
        setConfigured(res.configured);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [storeId]);

  async function run(phase: "before" | "after") {
    setBusy(phase);
    const res = await runProofCheck(storeId, phase);
    setBusy(null);
    if (res.ok) {
      setRows(res.rows);
      setConfigured(res.configured);
      if (!res.configured) toast.message("Connect an answer engine (PERPLEXITY_API_KEY) to run live proofs.");
      else toast.success(phase === "before" ? "Baseline captured" : "Re-checked the answer engines");
    } else {
      toast.error("Couldn't run the proof", { description: res.error });
    }
  }

  const gapGroups = group(rows.filter((r) => r.kind === "gap"));
  const ctxAll = rows.filter((r) => r.kind === "context");
  const ctxRows = ctxAll.slice(0, 4); // latest discovery check (newest-first)
  const competitors = [...new Set(ctxRows.flatMap((r) => r.competitors ?? []))].slice(0, 8);
  // Discovery-rate history: group context rows into checks (by minute).
  const checkMap = new Map<string, { total: number; hit: number; ts: string }>();
  for (const r of ctxAll) {
    const key = r.checked_at.slice(0, 16);
    const g = checkMap.get(key) ?? { total: 0, hit: 0, ts: r.checked_at };
    g.total++;
    if (r.answered) g.hit++;
    checkMap.set(key, g);
  }
  const checks = [...checkMap.values()].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 6);
  const hasBefore = rows.some((r) => r.phase === "before");

  return (
    <div className="border-t pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Prove it — what AI says about you</p>
          <p className="text-muted-foreground text-xs">
            We ask a live answer engine (Perplexity) your top questions and record the receipts. Capture a baseline
            before you publish, then re-check to watch it flip.
          </p>
        </div>
      </div>

      {!configured && (
        <p className="text-muted-foreground mt-3 rounded-lg border border-dashed p-3 text-xs">
          The proof engine isn&apos;t connected yet. Set <code className="bg-muted rounded px-1">PERPLEXITY_API_KEY</code> to run live before/after checks.
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant={hasBefore ? "outline" : "default"} onClick={() => run("before")} disabled={busy !== null}>
          {busy === "before" ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          {hasBefore ? "Re-capture baseline" : "Capture baseline"}
        </Button>
        <Button size="sm" onClick={() => run("after")} disabled={busy !== null || !hasBefore}>
          {busy === "after" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Re-check now
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground mt-3 text-xs">Loading…</p>
      ) : (
        <>
          {gapGroups.length > 0 && (
            <div className="mt-4 space-y-3">
              <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Answers about you (asked by name)</p>
              {gapGroups.map((g) => {
                const pickedUp = !!g.after?.answered && !!g.after?.cited && !(g.before?.answered && g.before?.cited);
                return (
                  <div
                    key={g.question}
                    className="rounded-lg border p-3"
                    style={pickedUp ? { borderColor: "#5eead4", background: "#f4fefb" } : undefined}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{g.question}</p>
                      {pickedUp && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: "#0d9488", background: "#d7f8f0" }}>
                          <Sparkles className="size-3" /> Picked up
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Side title="Before" row={g.before} />
                      <Side title="After" row={g.after} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {ctxRows.length > 0 && (
            <div className="mt-5 space-y-2">
              <div>
                <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">Discovery — found without your name</p>
                <p className="text-muted-foreground text-xs">
                  The hard, high-value test: does the engine recommend you when someone just describes their need?{" "}
                  <b>{ctxRows.filter((r) => r.answered).length} of {ctxRows.length}</b> mentioned you this check.
                </p>
                {checks.length >= 2 && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Trend: {checks.map((c) => `${c.hit}/${c.total}`).reverse().join(" → ")}
                  </p>
                )}
                {competitors.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground text-xs">Who&apos;s winning these intents:</span>
                    {competitors.map((c) => (
                      <span key={c} className="rounded-full px-2 py-0.5 text-[11px]" style={{ color: "#b06a2e", background: "#fff2e6" }}>
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {ctxRows.map((r, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm">{r.question}</p>
                    <Flag on={r.answered} label={r.answered ? "mentioned you" : "not mentioned"} />
                  </div>
                  {r.answer_text && <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{r.answer_text}</p>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
