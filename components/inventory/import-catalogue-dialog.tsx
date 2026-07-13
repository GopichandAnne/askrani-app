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

type Row = ExtractedProduct & { include: boolean };

export function ImportCatalogueDialog() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"input" | "preview">("input");

  const [url, setUrl] = useState("");
  const [paste, setPaste] = useState("");
  const [file, setFile] = useState<{ name: string; mime: string; base64?: string; text?: string } | null>(null);

  const [extracting, setExtracting] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [importing, setImporting] = useState(false);

  function reset() {
    setStep("input");
    setUrl("");
    setPaste("");
    setFile(null);
    setRows([]);
    setMode("append");
  }

  function pickFile(f: File) {
    if (f.type.includes("pdf") || f.type.startsWith("image/")) {
      const r = new FileReader();
      r.onload = () => setFile({ name: f.name, mime: f.type, base64: String(r.result).split(",")[1] ?? "" });
      r.readAsDataURL(f);
    } else {
      const r = new FileReader();
      r.onload = () => setFile({ name: f.name, mime: f.type || "text/plain", text: String(r.result) });
      r.readAsText(f);
    }
  }

  async function extract() {
    const input: { url?: string; text?: string; file?: { mime: string; base64: string } } = {};
    if (file?.base64) input.file = { mime: file.mime, base64: file.base64 };
    else if (file?.text) input.text = file.text;
    else if (url.trim()) input.url = url.trim();
    else if (paste.trim()) input.text = paste.trim();
    else return;

    setExtracting(true);
    const res = await extractCatalogue(input);
    setExtracting(false);
    if (!res.ok) {
      toast.error("Couldn't read that", { description: res.error });
      return;
    }
    if (!res.products.length) {
      toast.error("No products found", { description: "Try a clearer file, a different URL, or paste the items." });
      return;
    }
    setRows(res.products.map((p) => ({ ...p, include: true })));
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
                Paste a menu/catalogue URL, upload a file (PDF, image, JSON, CSV), or paste the items.
                Rani extracts the products for you to review.
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
                <Label>Or a file</Label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.json,.csv,.txt,image/*,application/pdf"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) pickFile(f);
                    e.target.value = "";
                  }}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload className="size-4" /> {file ? file.name : "Choose file"}
                </Button>
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
              <Button onClick={extract} disabled={extracting || (!url.trim() && !paste.trim() && !file)}>
                {extracting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Extract products
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Review {rows.length} extracted product{rows.length === 1 ? "" : "s"}</DialogTitle>
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
