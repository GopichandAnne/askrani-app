// Branded share-card composition for the give-and-get loop.
// Satori (VDOM -> SVG) + resvg-wasm (SVG -> PNG). Both run in Deno; `sharp` does
// not. Font + wasm are fetched once and cached in module scope. Everything here
// is best-effort — the caller falls back to a text+link handover if it throws.

import satori from "npm:satori@0.10.13";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const FONT_URL = "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.16/files/inter-latin-700-normal.woff";
const WASM_URL = "https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm";

let fontCache: ArrayBuffer | null = null;
let wasmReady: Promise<unknown> | null = null;

async function loadFont(): Promise<ArrayBuffer> {
  if (!fontCache) {
    const r = await fetch(FONT_URL);
    if (!r.ok) throw new Error(`font fetch ${r.status}`);
    fontCache = await r.arrayBuffer();
  }
  return fontCache;
}
async function ensureWasm(): Promise<void> {
  if (!wasmReady) wasmReady = initWasm(fetch(WASM_URL));
  await wasmReady;
}

export type CardSpec = { storeName: string; headline: string; sub: string; accent?: string };

// A plain-text div node (Satori consumes a React-like VDOM object; no JSX).
function textNode(text: string, style: Record<string, unknown>) {
  return { type: "div", props: { style, children: text } };
}

export async function composeCardPng(spec: CardSpec): Promise<Uint8Array> {
  const font = await loadFont();
  const accent = spec.accent ?? "#0a7d3c";
  const tree = {
    type: "div",
    props: {
      style: {
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        justifyContent: "space-between", backgroundColor: "#ffffff", padding: "72px",
        fontFamily: "Inter",
      },
      children: [
        textNode(spec.storeName, { fontSize: 40, color: accent }),
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column" },
            children: [
              textNode(spec.headline, { fontSize: 92, color: "#111111", lineHeight: 1.05 }),
              textNode(spec.sub, { fontSize: 44, color: "#555555", marginTop: "24px" }),
            ],
          },
        },
        textNode("Ask Rani", { fontSize: 30, color: "#aaaaaa" }),
      ],
    },
  };
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
    width: 900, height: 1120,
    fonts: [{ name: "Inter", data: font, weight: 700, style: "normal" }],
  });
  await ensureWasm();
  return new Resvg(svg, { fitTo: { mode: "width", value: 900 } }).render().asPng();
}

/** Compose + upload to the public branding bucket; cache the URL on the link so
 *  the same card is reused on every re-share. Returns a public image URL. */
export async function composeAndStoreCard(
  db: SupabaseClient,
  store: { id: string; slug: string },
  link: { id: string; code: string; card_image_ref?: string | null },
  spec: CardSpec,
): Promise<string> {
  if (link.card_image_ref) return link.card_image_ref;
  const png = await composeCardPng(spec);
  const path = `${store.slug}/reward-cards/${link.code}.png`;
  const up = await db.storage.from("branding").upload(path, png, {
    contentType: "image/png",
    upsert: true,
  });
  if (up.error) throw up.error;
  const url = db.storage.from("branding").getPublicUrl(path).data.publicUrl;
  await db.from("referral_links").update({ card_image_ref: url }).eq("id", link.id);
  return url;
}
