"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { uploadProductImage } from "@/app/(app)/inventory/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImagePlus, Loader2, X } from "lucide-react";

/** Set/replace a product image: upload from device (stored in the public
 *  branding bucket) or paste a URL. Calls onChange with the resulting URL. */
export function ImagePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState("");

  async function upload(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await uploadProductImage(fd);
    setUploading(false);
    if (res.ok) onChange(res.url);
    else toast.error("Couldn't upload image", { description: res.error });
  }

  return (
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
        {value && (
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
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
        <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          Upload
        </Button>
        <div className="flex gap-1.5">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="or paste an image URL"
            className="h-8 text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!url.trim()}
            onClick={() => {
              onChange(url.trim());
              setUrl("");
            }}
          >
            Set
          </Button>
        </div>
      </div>
    </div>
  );
}
