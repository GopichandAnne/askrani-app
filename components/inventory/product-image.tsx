"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { importImageFromUrl, uploadProductImage } from "@/app/(app)/inventory/actions";
import { enhanceImage } from "@/lib/inventory/enhance-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, ImagePlus, Loader2, Sparkles, Undo2, X } from "lucide-react";

/** Set/replace a product image: snap it on a phone (camera), upload from device,
 *  or paste a URL. Photos from the camera/upload are auto-enhanced (square crop,
 *  white balance, contrast, a little saturation) before upload — the owner's real
 *  photo, just cleaned up — with a one-tap "use original". Calls onChange with the
 *  resulting URL. */
export function ImagePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const captureRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState("");
  const [lastOriginal, setLastOriginal] = useState<File | null>(null);
  const [wasEnhanced, setWasEnhanced] = useState(false);

  async function send(file: File | Blob, name: string) {
    setUploading(true);
    const fd = new FormData();
    if (file instanceof File) fd.append("file", file);
    else fd.append("file", file, name);
    const res = await uploadProductImage(fd);
    setUploading(false);
    if (res.ok) onChange(res.url);
    else toast.error("Couldn't upload image", { description: res.error });
    return res.ok;
  }

  async function handleFile(file: File, enhance: boolean) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image.");
      return;
    }
    const toSend = enhance ? await enhanceImage(file) : file;
    const ok = await send(toSend, "dish.jpg");
    if (ok) {
      setLastOriginal(enhance ? file : null);
      setWasEnhanced(enhance);
    }
  }

  // Paste a link the owner already has (IG post, Google Photos, their site): we
  // fetch it, re-host a durable copy (so a CDN link that expires can't break the
  // menu), enhance it, and set it. No fragile hotlinking.
  async function fetchUrl() {
    const link = url.trim();
    if (!link) return;
    setUploading(true);
    const res = await importImageFromUrl(link);
    setUploading(false);
    if (res.ok) {
      onChange(res.url);
      setUrl("");
      setLastOriginal(null);
      setWasEnhanced(false);
    } else {
      toast.error("Couldn't import that photo", { description: res.error });
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="bg-muted relative size-16 shrink-0 overflow-hidden rounded-md border">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="size-full object-cover" />
          ) : (
            <div className="text-muted-foreground flex size-full items-center justify-center">
              <ImagePlus className="size-5" />
            </div>
          )}
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <Loader2 className="size-5 animate-spin text-white" />
            </div>
          )}
          {value && !uploading && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
              aria-label="Remove image"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <input
            ref={captureRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f, true);
              e.target.value = "";
            }}
          />
          <input
            ref={uploadRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f, true);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" disabled={uploading} onClick={() => captureRef.current?.click()}>
              <Camera className="size-4" /> Take photo
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => uploadRef.current?.click()}>
              <ImagePlus className="size-4" /> Upload
            </Button>
          </div>
          <div className="flex gap-1.5">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && url.trim()) fetchUrl();
              }}
              placeholder="or paste a photo link (Instagram, Google, your site…)"
              className="h-8 text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!url.trim() || uploading}
              onClick={fetchUrl}
            >
              {uploading ? <Loader2 className="size-4 animate-spin" /> : "Fetch"}
            </Button>
          </div>
        </div>
      </div>
      {value && wasEnhanced && lastOriginal && !uploading && (
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <span className="text-teal-deep inline-flex items-center gap-1">
            <Sparkles className="size-3.5" /> Auto-enhanced
          </span>
          <button
            type="button"
            className="hover:text-foreground inline-flex items-center gap-1 underline underline-offset-2"
            onClick={() => handleFile(lastOriginal, false)}
          >
            <Undo2 className="size-3" /> use original
          </button>
        </div>
      )}
      <p className="text-muted-foreground text-[11px] leading-snug">
        Tip: fill the frame with the dish, shoot from straight above or a low 45°, in good light. We&apos;ll
        crop it square and clean it up.
      </p>
    </div>
  );
}
