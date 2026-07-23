"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Copy, Download, Plus, Printer, QrCode, Utensils, X } from "lucide-react";

const SITE = "https://askrani.ai";

// Optional dine-in QR codes. Each opens the restaurant diner surface
// (Rani as your server) at /s/<slug>?t=<token>&table=<label>. Purely client-side
// and deterministic — the link is the store token plus a spot label, so there's
// nothing to persist server-side. A store that doesn't do table ordering just
// leaves this alone.
type Spot = { id: string; label: string; value: string }; // value = the &table= param

export function TableQrs({
  storeSlug,
  storeName,
  token,
}: {
  storeSlug: string;
  storeName: string;
  token: string;
}) {
  const KEY = `askrani_tableqrs_${storeSlug}`;
  const [tables, setTables] = useState(8);
  const [areas, setAreas] = useState<string[]>([]);
  const [newArea, setNewArea] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw) as { tables?: number; areas?: string[] };
        if (typeof s.tables === "number") setTables(Math.max(0, Math.min(200, s.tables)));
        if (Array.isArray(s.areas)) setAreas(s.areas.slice(0, 40));
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ tables, areas }));
    } catch {}
  }, [KEY, tables, areas]);

  const spots: Spot[] = useMemo(() => {
    const out: Spot[] = [];
    for (let i = 1; i <= tables; i++) out.push({ id: `t${i}`, label: `Table ${i}`, value: String(i) });
    for (const a of areas) out.push({ id: `a${a}`, label: a, value: a });
    return out;
  }, [tables, areas]);

  const link = (value: string) => `${SITE}/s/${storeSlug}?t=${token}&table=${encodeURIComponent(value)}`;

  function addArea() {
    const a = newArea.trim().slice(0, 24);
    if (!a) return;
    if (areas.some((x) => x.toLowerCase() === a.toLowerCase())) {
      toast.error("You've already added that spot.");
      return;
    }
    setAreas((x) => [...x, a]);
    setNewArea("");
  }

  function printSheet() {
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".tqr-card"));
    if (!cards.length) return;
    const cells = cards
      .map((c) => {
        const canvas = c.querySelector("canvas");
        const label = c.getAttribute("data-label") || "";
        return canvas
          ? `<div class="cell"><img src="${canvas.toDataURL("image/png")}"/><div class="lbl">${label}</div><div class="sub">Scan to order with Rani · ${storeName}</div></div>`
          : "";
      })
      .join("");
    const w = window.open("", "_blank");
    if (!w) {
      toast.error("Allow pop-ups to print the QR sheet.");
      return;
    }
    w.document.write(
      `<!doctype html><html><head><title>${storeName} — dine-in QR codes</title><style>` +
        `body{font-family:system-ui,-apple-system,sans-serif;margin:0;padding:24px;color:#0c1222}` +
        `.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}` +
        `.cell{border:1px solid #ccfbf1;border-radius:14px;padding:16px;text-align:center;page-break-inside:avoid}` +
        `.cell img{width:100%;max-width:190px;height:auto}` +
        `.lbl{font-weight:600;font-size:18px;margin-top:10px;color:#0f766e}` +
        `.sub{color:#6b7280;font-size:11px;margin-top:3px}` +
        `</style></head><body><div class="grid">${cells}</div></body></html>`,
    );
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 350);
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <Utensils className="text-teal-deep size-4" />
        <p className="text-sm font-medium">Dine-in QR codes</p>
        <span className="text-muted-foreground text-xs">· optional</span>
      </div>
      <p className="text-muted-foreground text-xs">
        For sit-down and counter service. Each QR opens Rani as the guest&apos;s <b>server</b> — a
        menu they&apos;re served, not one they scan — tagged to that spot. Add numbered tables and any
        common areas (bar, patio, takeaway). Nothing changes for your main chat QR; leave this blank
        if you don&apos;t do table ordering.
      </p>

      <div className="bg-muted/40 flex flex-wrap items-end gap-4 rounded-lg border p-3">
        <div className="space-y-1">
          <label className="text-muted-foreground text-xs">Numbered tables</label>
          <Input
            type="number"
            min={0}
            max={200}
            value={tables ? String(tables) : ""}
            onChange={(e) => setTables(Math.max(0, Math.min(200, Number(e.target.value.replace(/\D/g, "")) || 0)))}
            className="h-9 w-28 tabular-nums"
          />
        </div>
        <div className="min-w-[200px] flex-1 space-y-1">
          <label className="text-muted-foreground text-xs">Common areas</label>
          <div className="flex gap-2">
            <Input
              value={newArea}
              onChange={(e) => setNewArea(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addArea();
                }
              }}
              placeholder="e.g. Bar, Patio, Takeaway"
              className="h-9"
              maxLength={24}
            />
            <Button size="sm" variant="outline" onClick={addArea} disabled={!newArea.trim()}>
              <Plus className="size-4" /> Add
            </Button>
          </div>
        </div>
      </div>

      {areas.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {areas.map((a) => (
            <span key={a} className="bg-teal-mist text-teal-deep inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs">
              {a}
              <button onClick={() => setAreas((x) => x.filter((y) => y !== a))} aria-label={`Remove ${a}`} className="hover:text-destructive">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {spots.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-2 py-1 text-xs">
          <QrCode className="size-4" /> Add tables or common areas above to generate QR codes.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-xs">{spots.length} QR{spots.length === 1 ? "" : "s"} ready</p>
            <Button size="sm" variant="outline" onClick={printSheet}>
              <Printer className="size-4" /> Print sheet
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {spots.map((s) => (
              <SpotCard key={s.id} storeSlug={storeSlug} label={s.label} url={link(s.value)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SpotCard({ storeSlug, label, url }: { storeSlug: string; label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  function copy() {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }
  function download() {
    const canvas = ref.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `askrani-${storeSlug}-${label.replace(/\s+/g, "-").toLowerCase()}.png`;
    a.click();
  }

  return (
    <div className="tqr-card flex flex-col items-center gap-2 rounded-lg border p-3" data-label={label}>
      <div ref={ref} className="bg-card rounded-md border p-1.5">
        <QRCodeCanvas value={url} size={92} level="M" fgColor="#0f766e" />
      </div>
      <p className="text-center text-xs font-medium">{label}</p>
      <div className="flex gap-1">
        <Button size="icon" variant="ghost" className="size-7" onClick={copy} aria-label="Copy link">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
        <Button size="icon" variant="ghost" className="size-7" onClick={download} aria-label="Download QR">
          <Download className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
