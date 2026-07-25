// Client-side auto-enhance for dish photos taken on a phone. Deliberately gentle:
// it corrects a colour cast and lifts flat lighting, but leaves an already-good
// photo essentially untouched (the contrast stretch is clamped, so a full-range
// image gets gain≈1). It never fabricates content — it only adjusts the owner's
// real photo. `enhancePixels` is pure (unit-testable); `enhanceImage` does the
// browser-only canvas work (square crop + resize + encode).

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/**
 * In-place tonal enhance of an RGBA pixel buffer:
 *   1. gray-world white balance (clamped so it can't overcorrect),
 *   2. luminance-percentile contrast stretch (clamped gain 1..2 → no-op if already
 *      full-range; preserves colour by applying one gain/offset to all channels),
 *   3. a small saturation lift for appetite.
 */
export function enhancePixels(px: Uint8ClampedArray): void {
  const n = px.length / 4;
  if (n === 0) return;

  // 1. gray-world white balance
  let sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < px.length; i += 4) {
    sr += px[i];
    sg += px[i + 1];
    sb += px[i + 2];
  }
  const ar = sr / n || 1, ag = sg / n || 1, ab = sb / n || 1;
  const gray = (ar + ag + ab) / 3;
  const kr = clamp(gray / ar, 0.85, 1.2);
  const kg = clamp(gray / ag, 0.85, 1.2);
  const kb = clamp(gray / ab, 0.85, 1.2);

  // apply WB and build a luminance histogram in one pass
  const hist = new Array(256).fill(0);
  for (let i = 0; i < px.length; i += 4) {
    const r = clamp(px[i] * kr, 0, 255);
    const g = clamp(px[i + 1] * kg, 0, 255);
    const b = clamp(px[i + 2] * kb, 0, 255);
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    hist[(0.299 * r + 0.587 * g + 0.114 * b) | 0]++;
  }

  // 2. contrast stretch between the 0.5th and 99.5th luminance percentiles
  const lowCut = n * 0.005, highCut = n * 0.995;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= lowCut) { lo = v; break; }
  }
  acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= highCut) { hi = v; break; }
  }
  const gain = hi > lo ? clamp(255 / (hi - lo), 1, 2) : 1;
  const off = -lo * gain;

  // 3. apply contrast + gentle saturation
  const sat = 1.12;
  for (let i = 0; i < px.length; i += 4) {
    const r = clamp(px[i] * gain + off, 0, 255);
    const g = clamp(px[i + 1] * gain + off, 0, 255);
    const b = clamp(px[i + 2] * gain + off, 0, 255);
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    px[i] = clamp(l + (r - l) * sat, 0, 255);
    px[i + 1] = clamp(l + (g - l) * sat, 0, 255);
    px[i + 2] = clamp(l + (b - l) * sat, 0, 255);
  }
}

/**
 * Center-crop to a square, downscale to `max`px, auto-enhance, and encode JPEG.
 * Returns the original file unchanged if the browser can't process it (so the
 * upload never fails just because enhancement did).
 */
export async function enhanceImage(file: File, max = 1000, quality = 0.88): Promise<Blob> {
  try {
    if (typeof document === "undefined") return file;
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    } catch {
      bmp = await createImageBitmap(file);
    }
    const side = Math.min(bmp.width, bmp.height);
    const sx = (bmp.width - side) / 2;
    const sy = (bmp.height - side) / 2;
    const size = Math.min(max, side);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, sx, sy, side, side, 0, 0, size, size);
    bmp.close?.();
    const img = ctx.getImageData(0, 0, size, size);
    enhancePixels(img.data);
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
    return blob ?? file;
  } catch {
    return file;
  }
}
