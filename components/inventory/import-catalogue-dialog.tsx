"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { extractCatalogue, importProducts, type ExtractedProduct } from "@/app/(app)/inventory/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles, Upload } from "lucide-react";

type Row = ExtractedProduct & { include: boolean; source?: string };
type PickedFile = { name: string; mime: string; base64?: string; text?: string };

export function ImportCatalogueDialog() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"input" | "preview">("input");

  const [url, setUrl] = useState("");
  const [paste, setPaste] = useState("");
  // Several files at once — a store's whole "menu" or a realtor's listing folder
  // is rarely one file.
  const [files, setFiles] = useState<PickedFile[]>([]);

  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [importing, setImporting] = useState(false);

  function reset() {
    setStep("input");
    setUrl("");
    setPaste("");
    setFiles([]);
    setRows([]);
    setProgress(null);
    setMode("append");
  }

  function addFiles(list: FileList) {
    Array.from(list).forEach((f) => {
      const binary = f.type.includes("pdf") || f.type.startsWith("image/");
      const r = new FileReader();
      r.onload = () => {
        const picked: PickedFile = binary
          ? { name: f.name, mime: f.type, base64: String(r.result).split(",")[1] ?? "" }
          : { name: f.name, mime: f.type || "text/plain", text: String(r.result) };
        setFiles((prev) => [...prev, picked]);
      };
      if (binary) r.readAsDataURL(f);
      else r.readAsText(f);
    });
  }

  async function extract() {
    // Every source becomes one extract call; results merge into a single review.
    const sources: { label: string; input: { url?: string; text?: string; file?: { mime: string; base64: string } } }[] = [];
    for (const f of files) {
      if (f.base64) sources.push({ label: f.name, input: { file: { mime: f.mime, base64: f.base64 } } });
      else if (f.text) sources.push({ label: f.name, input: { text: f.text } });
    }
    if (url.trim()) sources.push({ label: "URL", input: { url: url.trim() } });
    if (paste.trim()) sources.push({ label: "Pasted", input: { text: paste.trim() } });
    if (!sources.length) return;

    setExtracting(true);
    setProgress({ done: 0, total: sources.length });
    const merged: Row[] = [];
    const seen = new Set<string>(); // dedupe by name — the same item across files
    const failed: string[] = [];

    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      const res = await extractCatalogue(s.input);
      setProgress({ done: i + 1, total: sources.length });
      if (!res.ok || !res.products.length) {
        if (!res.ok) failed.push(s.label);
        continue;
      }
      for (const p of res.products) {
        const key = (p.name ?? "").trim().toLowerCase();
        if (!key || seen.has(key)) continue; // first file wins on a duplicate name
        seen.add(key);
        merged.push({ ...p, include: true, source: s.label });
      }
    }

    setExtracting(false);
    setProgress(null);
    if (failed.length) {
      toast.warning(`Couldn't read ${failed.length} source${failed.length === 1 ? "" : "s"}`, {
        description: failed.join(", "),
      });
    }
    if (!merged.length) {
      toast.error("No products found", { description: "Try clearer files, a different URL, or paste the items." });
      return;
    }
    setRows(merged);
    setStep("preview");
  }

  function edit(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function doImport() {
    const chosen = rows.filter((r) => r.include && r.name.trim());
    if (!chosen.length) return;
    setImporting(true);
    const res = await importProducts(
      chosen.map(({ include: _i, ...p }) => p),
      mode,
    );
    setImporting(false);
    if (res.ok) {
      toast.success(`Imported ${res.imported} product${res.imported === 1 ? "" : "s"}`);
      setOpen(false);
      reset();
      router.refresh();
    } else {
      toast.error("Import failed", { description: res.error });
    }
  }

  const chosenCount = rows.filter((r) => r.include && r.name.trim()).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Sparkles className="size-4" /> Import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {step === "input" ? (
          <>
            <DialogHeader>
              <DialogTitle>Import catalogue</DialogTitle>
              <DialogDescription>
                Paste a menu/catalogue URL, upload several files at once (PDFs, images, JSON, CSV —
                a whole listing folder is fine), or paste the items. Rani reads them all and merges
                the products for you to review.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="imp-url">From a URL</Label>
                <Input
                  id="imp-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://yoursite.com/menu"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Or files (add several)</Label>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.json,.csv,.txt,image/*,application/pdf"
                  hidden
                  onChange={(e) => {
                    if (e.target.files?.length) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload className="size-4" /> {files.length ? "Add more files" : "Choose files"}
                </Button>
                {files.length > 0 && (
                  <ul className="space-y-1 pt-1">
                    {files.map((f, i) => (
                      <li key={i} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
                        <span className="truncate">{f.name}</span>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive ml-2 shrink-0"
                          aria-label={`Remove ${f.name}`}
                          onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="imp-paste">Or paste items</Label>
                <textarea
                  id="imp-paste"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder="Paste your menu / product list here…"
                  className="border-input bg-background min-h-24 w-full rounded-md border p-2 text-sm"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={extract}
                disabled={extracting || (!url.trim() && !paste.trim() && files.length === 0)}
              >
                {extracting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {extracting && progress
                  ? `Reading ${progress.done}/${progress.total}…`
                  : "Extract products"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                Review {rows.length} product{rows.length === 1 ? "" : "s"}
                {(() => {
                  const n = new Set(rows.map((r) => r.source).filter(Boolean)).size;
                  return n > 1 ? ` from ${n} sources` : "";
                })()}
              </DialogTitle>
              <DialogDescription>Uncheck any you don&apos;t want, and fix names/prices before importing.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border p-2">
                  <input
                    type="checkbox"
                    className="accent-teal size-4"
                    checked={r.include}
                    onChange={(e) => edit(i, { include: e.target.checked })}
                  />
                  <Input
                    value={r.name}
                    onChange={(e) => edit(i, { name: e.target.value })}
                    className="h-8 flex-1"
                    placeholder="Name"
                  />
                  <Input
                    value={r.category ?? ""}
                    onChange={(e) => edit(i, { category: e.target.value })}
                    className="h-8 w-32"
                    placeholder="Category"
                  />
                  <Input
                    value={r.price == null ? "" : String(r.price)}
                    onChange={(e) => edit(i, { price: e.target.value === "" ? null : Number(e.target.value) })}
                    className="h-8 w-20"
                    inputMode="decimal"
                    placeholder="Price"
                  />
                  {r.source && (
                    <span className="text-muted-foreground w-24 shrink-0 truncate text-[11px]" title={r.source}>
                      {r.source}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Import as</span>
              <button
                className={`rounded-full border px-3 py-1 text-xs ${mode === "append" ? "bg-teal border-teal text-white" : "text-muted-foreground"}`}
                onClick={() => setMode("append")}
              >
                Add to catalogue
              </button>
              <button
                className={`rounded-full border px-3 py-1 text-xs ${mode === "replace" ? "bg-destructive border-destructive text-white" : "text-muted-foreground"}`}
                onClick={() => setMode("replace")}
              >
                Replace catalogue
              </button>
            </div>
            {mode === "replace" && (
              <p className="text-destructive text-xs">This deletes all current products first, then imports these.</p>
            )}
            <DialogFooter className="gap-2">
              <Button variant="ghost" onClick={() => setStep("input")}>Back</Button>
              <Button onClick={doImport} disabled={importing || chosenCount === 0}>
                {importing ? <Loader2 className="size-4 animate-spin" /> : null}
                Import {chosenCount} product{chosenCount === 1 ? "" : "s"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
